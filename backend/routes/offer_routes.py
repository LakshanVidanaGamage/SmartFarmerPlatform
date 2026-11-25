
import hmac

from flask import Blueprint, request, jsonify, session
from db import get_db_connection
from decimal import Decimal, InvalidOperation
import logging
from datetime import datetime
import time
from services.email_outbox import enqueue_notification, log_duration, measure_request_duration

offer_bp = Blueprint("offers", __name__)


@offer_bp.before_request
def require_business_csrf_token():
    if request.method in {"GET", "HEAD", "OPTIONS"}:
        return None

    expected_token = session.get("auth_csrf_token", "")
    submitted_token = request.headers.get("X-CSRFToken", "")
    if (
        not isinstance(expected_token, str)
        or not expected_token
        or not submitted_token
        or not hmac.compare_digest(expected_token, submitted_token)
    ):
        return jsonify({
            "success": False,
            "message": "Your request could not be verified. Refresh the page and try again.",
        }), 403


# -----------------------------------------
# SEND OFFER (BUYER)
# -----------------------------------------

@offer_bp.route("/api/offers", methods=["POST"])
@measure_request_duration("offer_created")
def send_offer():

    if "user_id" not in session:
        return jsonify({
            "success": False,
            "message": "Please log in first."
        }), 401

    if session.get("role") != "buyer":
        return jsonify({
            "success": False,
            "message": "Only buyers can send offers."
        }), 403

    data = request.get_json(silent=True) or {}

    try:
        produce_id = int(data.get("produce_id", 0))
        quantity = Decimal(str(data.get("quantity", "0")))
        offered_price = Decimal(str(data.get("offered_price", "0")))

    except (TypeError, ValueError, InvalidOperation):
        return jsonify({
            "success": False,
            "message": "Please enter valid offer details."
        }), 400

    if (
        produce_id <= 0
        or not quantity.is_finite()
        or not offered_price.is_finite()
        or quantity <= 0
        or offered_price <= 0
    ):
        return jsonify({
            "success": False,
            "message": "Produce, quantity and offer price must be valid."
        }), 400

    connection = None
    cursor = None
    database_started = None

    try:
        database_started = time.perf_counter()
        connection = get_db_connection()
        connection.start_transaction()
        cursor = connection.cursor(dictionary=True)

        cursor.execute(
            """
            SELECT produce_id, farmer_id, produce_name, quantity, unit
            FROM produce
            WHERE produce_id = %s AND available = 1
            """,
            (produce_id,)
        )

        produce = cursor.fetchone()

        if not produce:
            return jsonify({
                "success": False,
                "message": "This produce listing is no longer available."
            }), 404

        if quantity > Decimal(str(produce["quantity"])):
            return jsonify({
                "success": False,
                "message": (
                    "Requested quantity exceeds available quantity "
                    f"({produce['quantity']} {produce['unit']})."
                )
            }), 400

        if int(produce["farmer_id"]) == int(session["user_id"]):
            return jsonify({
                "success": False,
                "message": "You cannot send an offer for your own produce."
            }), 400

        cursor.execute(
            """
            INSERT INTO offers (
                produce_id,
                buyer_id,
                farmer_id,
                offered_price,
                quantity,
                status
            )
            VALUES (%s, %s, %s, %s, %s, 'pending')
            """,
            (
                produce_id,
                session["user_id"],
                produce["farmer_id"],
                str(offered_price),
                str(quantity)
            )
        )

        offer_id = cursor.lastrowid
        enqueue_notification(
            cursor,
            event="offer_created",
            idempotency_key=f"offer_created:offer:{offer_id}:recipient:{produce['farmer_id']}",
            recipient_user_id=produce["farmer_id"],
            other_party_user_id=session["user_id"],
            details={
                "offer_id": offer_id,
                "produce": produce["produce_name"],
                "quantity": quantity,
                "unit": produce["unit"],
                "unit_price": offered_price,
                "total": quantity * offered_price,
                "date": datetime.now().astimezone().isoformat(timespec="minutes"),
            },
        )
        connection.commit()

        return jsonify({
            "success": True,
            "message": "Offer sent successfully.",
            "offer_id": offer_id
        }), 201

    except Exception:
        if connection:
            connection.rollback()

        logging.error("offer_transaction_failed event=offer_created")

        return jsonify({
            "success": False,
            "message": "Could not send offer. Please try again."
        }), 500

    finally:
        if cursor:
            cursor.close()

        if connection:
            connection.close()
        if database_started is not None:
            log_duration("offer_created", "database_transaction", database_started)


# -----------------------------------------
# VIEW BUYER'S SENT OFFERS
# -----------------------------------------

@offer_bp.route("/api/my-offers", methods=["GET"])
def get_my_offers():

    if "user_id" not in session:
        return jsonify({
            "success": False,
            "message": "Please log in first."
        }), 401

    if session.get("role") != "buyer":
        return jsonify({
            "success": False,
            "message": "Buyer access required."
        }), 403

    connection = None
    cursor = None

    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)

        cursor.execute(
            """
            SELECT
                o.offer_id,
                o.produce_id,
                o.offered_price,
                o.quantity,
                o.status,
                o.created_at,
                p.produce_name,
                p.unit,
                p.district,
                u.full_name AS farmer_name
            FROM offers AS o
            JOIN produce AS p
                ON o.produce_id = p.produce_id
            JOIN users AS u
                ON o.farmer_id = u.user_id
            WHERE o.buyer_id = %s
            ORDER BY o.created_at DESC
            """,
            (session["user_id"],)
        )

        offers = cursor.fetchall()

        for offer in offers:
            offer["offered_price"] = float(offer["offered_price"])
            offer["quantity"] = float(offer["quantity"])

            if offer.get("created_at"):
                offer["created_at"] = offer["created_at"].isoformat()

        return jsonify({
            "success": True,
            "offers": offers
        })

    except Exception:
        logging.exception("Failed to retrieve buyer offers")

        return jsonify({
            "success": False,
            "message": "Could not retrieve your offers."
        }), 500

    finally:
        if cursor:
            cursor.close()

        if connection:
            connection.close()


# -----------------------------------------
# VIEW OFFERS RECEIVED BY FARMER
# -----------------------------------------

@offer_bp.route("/api/received-offers", methods=["GET"])
def get_received_offers():

    if "user_id" not in session:
        return jsonify({
            "success": False,
            "message": "Please log in first."
        }), 401

    if session.get("role") != "farmer":
        return jsonify({
            "success": False,
            "message": "Farmer access required."
        }), 403

    connection = None
    cursor = None

    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)

        cursor.execute(
            """
            SELECT
                o.offer_id,
                o.produce_id,
                o.offered_price,
                o.quantity,
                o.status,
                o.created_at,
                p.produce_name,
                p.unit,
                p.district,
                u.full_name AS buyer_name
            FROM offers AS o
            JOIN produce AS p
                ON o.produce_id = p.produce_id
            JOIN users AS u
                ON o.buyer_id = u.user_id
            WHERE o.farmer_id = %s
            ORDER BY o.created_at DESC
            """,
            (session["user_id"],)
        )

        offers = cursor.fetchall()

        for offer in offers:
            offer["offered_price"] = float(offer["offered_price"])
            offer["quantity"] = float(offer["quantity"])

            if offer.get("created_at"):
                offer["created_at"] = offer["created_at"].isoformat()

        return jsonify({
            "success": True,
            "offers": offers
        })

    except Exception:
        logging.exception("Failed to retrieve received offers")

        return jsonify({
            "success": False,
            "message": "Could not retrieve received offers."
        }), 500

    finally:
        if cursor:
            cursor.close()

        if connection:
            connection.close()


# -----------------------------------------
# ACCEPT OR REJECT OFFER (FARMER)
# ACCEPTING AN OFFER AUTOMATICALLY CREATES
# AN ORDER AND REDUCES AVAILABLE STOCK.
# -----------------------------------------

@offer_bp.route(
    "/api/offers/<int:offer_id>/status",
    methods=["PATCH"]
)
@measure_request_duration("offer_status")
def update_offer_status(offer_id):

    if "user_id" not in session:
        return jsonify({
            "success": False,
            "message": "Please log in first."
        }), 401

    if session.get("role") != "farmer":
        return jsonify({
            "success": False,
            "message": "Only farmers can respond to offers."
        }), 403

    data = request.get_json(silent=True) or {}
    new_status = str(data.get("status", "")).strip().lower()

    if new_status not in ["accepted", "rejected"]:
        return jsonify({
            "success": False,
            "message": "Status must be accepted or rejected."
        }), 400

    connection = None
    cursor = None
    database_started = None

    try:
        database_started = time.perf_counter()
        connection = get_db_connection()
        connection.start_transaction()

        cursor = connection.cursor(dictionary=True)

        # Lock the offer so it cannot be processed twice.
        cursor.execute(
            """
            SELECT
                offer_id,
                produce_id,
                buyer_id,
                farmer_id,
                offered_price,
                quantity,
                status
            FROM offers
            WHERE offer_id = %s
              AND farmer_id = %s
            FOR UPDATE
            """,
            (offer_id, session["user_id"])
        )

        offer = cursor.fetchone()

        if not offer:
            connection.rollback()

            return jsonify({
                "success": False,
                "message": "Offer not found or it does not belong to you."
            }), 404

        if offer["status"] != "pending":
            connection.rollback()

            return jsonify({
                "success": False,
                "message": "This offer has already been processed."
            }), 409

        # REJECT OFFER
        if new_status == "rejected":

            cursor.execute(
                """
                UPDATE offers
                SET status = 'rejected'
                WHERE offer_id = %s
                  AND farmer_id = %s
                  AND status = 'pending'
                """,
                (offer_id, session["user_id"])
            )

            connection.commit()

            return jsonify({
                "success": True,
                "message": "Offer rejected successfully.",
                "status": "rejected"
            })

        # ACCEPT OFFER: lock the produce row and check stock.
        cursor.execute(
            """
            SELECT
                produce_id,
                produce_name,
                quantity,
                available,
                unit
            FROM produce
            WHERE produce_id = %s
              AND farmer_id = %s
            FOR UPDATE
            """,
            (
                offer["produce_id"],
                session["user_id"]
            )
        )

        produce = cursor.fetchone()

        if not produce or not produce["available"]:
            connection.rollback()

            return jsonify({
                "success": False,
                "message": "This produce listing is no longer available."
            }), 409

        available_quantity = Decimal(str(produce["quantity"]))
        requested_quantity = Decimal(str(offer["quantity"]))
        offered_price = Decimal(str(offer["offered_price"]))

        if requested_quantity <= 0 or offered_price <= 0:
            connection.rollback()

            return jsonify({
                "success": False,
                "message": "Invalid offer quantity or price."
            }), 400

        if requested_quantity > available_quantity:
            connection.rollback()

            return jsonify({
                "success": False,
                "message": (
                    "Not enough stock to accept this offer. "
                    f"Available quantity: {available_quantity} "
                    f"{produce['unit']}."
                )
            }), 409

        # Calculate order total.
        total_amount = requested_quantity * offered_price

        # Reduce available stock.
        remaining_quantity = available_quantity - requested_quantity

        cursor.execute(
            """
            UPDATE produce
            SET
                quantity = %s,
                available = %s
            WHERE produce_id = %s
              AND farmer_id = %s
            """,
            (
                str(remaining_quantity),
                1 if remaining_quantity > 0 else 0,
                offer["produce_id"],
                session["user_id"]
            )
        )

        # Create the order from the accepted offer.
        cursor.execute(
            """
            INSERT INTO orders (
                produce_id,
                buyer_id,
                farmer_id,
                quantity,
                total_amount,
                status
            )
            VALUES (%s, %s, %s, %s, %s, 'pending')
            """,
            (
                offer["produce_id"],
                offer["buyer_id"],
                offer["farmer_id"],
                str(requested_quantity),
                str(total_amount)
            )
        )

        order_id = cursor.lastrowid

        # Mark offer as accepted.
        cursor.execute(
            """
            UPDATE offers
            SET status = 'accepted'
            WHERE offer_id = %s
              AND farmer_id = %s
              AND status = 'pending'
            """,
            (offer_id, session["user_id"])
        )

        shared_details = {
            "offer_id": offer_id,
            "order_id": order_id,
            "produce": produce["produce_name"],
            "quantity": requested_quantity,
            "unit": produce["unit"],
            "unit_price": offered_price,
            "total": total_amount,
            "date": datetime.now().astimezone().isoformat(timespec="minutes"),
        }
        enqueue_notification(
            cursor,
            event="offer_accepted",
            idempotency_key=f"offer_accepted:offer:{offer_id}:recipient:{offer['buyer_id']}",
            recipient_user_id=offer["buyer_id"],
            other_party_user_id=offer["farmer_id"],
            details=shared_details,
        )
        enqueue_notification(
            cursor,
            event="order_created",
            idempotency_key=f"order_created:order:{order_id}:recipient:{offer['farmer_id']}",
            recipient_user_id=offer["farmer_id"],
            other_party_user_id=offer["buyer_id"],
            details=shared_details,
        )
        connection.commit()

        return jsonify({
            "success": True,
            "message": "Offer accepted and order created successfully.",
            "status": "accepted",
            "order_id": order_id,
            "total_amount": float(total_amount),
            "remaining_quantity": float(remaining_quantity)
        })

    except Exception:
        if connection:
            connection.rollback()

        logging.error("offer_transaction_failed event=offer_status")

        return jsonify({
            "success": False,
            "message": "Could not process offer. Please check the Flask terminal."
        }), 500

    finally:
        if cursor:
            cursor.close()

        if connection:
            connection.close()
        if database_started is not None:
            log_duration("offer_status", "database_transaction", database_started)


