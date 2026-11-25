
import hmac

from flask import Blueprint, request, jsonify, session
from db import get_db_connection
import logging
from datetime import datetime
from services.email_notifications import unit_price_from_total
from services.email_outbox import enqueue_notification, log_duration, measure_request_duration
import time

order_bp = Blueprint("orders", __name__)


@order_bp.before_request
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
# VIEW BUYER'S ORDERS
# -----------------------------------------

@order_bp.route("/api/my-orders", methods=["GET"])
def get_buyer_orders():

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
                o.order_id,
                o.produce_id,
                o.quantity,
                o.total_amount,
                o.status,
                o.created_at,
                p.produce_name,
                p.unit,
                p.district,
                u.full_name AS farmer_name
            FROM orders AS o
            JOIN produce AS p
                ON o.produce_id = p.produce_id
            JOIN users AS u
                ON o.farmer_id = u.user_id
            WHERE o.buyer_id = %s
            ORDER BY o.created_at DESC
            """,
            (session["user_id"],)
        )

        orders = cursor.fetchall()

        for order in orders:
            order["quantity"] = float(order["quantity"])
            order["total_amount"] = float(order["total_amount"])

            if order.get("created_at"):
                order["created_at"] = order["created_at"].isoformat()

        return jsonify({
            "success": True,
            "orders": orders
        })

    except Exception:
        logging.exception("Could not retrieve buyer orders")

        return jsonify({
            "success": False,
            "message": "Could not retrieve your orders."
        }), 500

    finally:
        if cursor:
            cursor.close()

        if connection:
            connection.close()


# -----------------------------------------
# VIEW FARMER'S RECEIVED ORDERS
# -----------------------------------------

@order_bp.route("/api/farmer/orders", methods=["GET"])
def get_farmer_orders():

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
                o.order_id,
                o.produce_id,
                o.buyer_id,
                o.quantity,
                o.total_amount,
                o.status,
                o.created_at,
                p.produce_name,
                p.unit,
                p.district,
                u.full_name AS buyer_name
            FROM orders AS o
            JOIN produce AS p
                ON o.produce_id = p.produce_id
            JOIN users AS u
                ON o.buyer_id = u.user_id
            WHERE o.farmer_id = %s
            ORDER BY o.created_at DESC
            """,
            (session["user_id"],)
        )

        orders = cursor.fetchall()

        for order in orders:
            order["quantity"] = float(order["quantity"])
            order["total_amount"] = float(order["total_amount"])

            if order.get("created_at"):
                order["created_at"] = order["created_at"].isoformat()

        return jsonify({
            "success": True,
            "orders": orders
        })

    except Exception:
        logging.exception("Could not retrieve farmer orders")

        return jsonify({
            "success": False,
            "message": "Could not retrieve received orders."
        }), 500

    finally:
        if cursor:
            cursor.close()

        if connection:
            connection.close()


# -----------------------------------------
# UPDATE ORDER STATUS
#
# FARMER:
# pending -> confirmed
# confirmed -> completed
# pending/confirmed -> cancelled
#
# BUYER:
# pending -> cancelled
# -----------------------------------------

@order_bp.route(
    "/api/orders/<int:order_id>/status",
    methods=["PATCH"]
)
@measure_request_duration("order_status")
def update_order_status(order_id):

    if "user_id" not in session:
        return jsonify({
            "success": False,
            "message": "Please log in first."
        }), 401

    role = session.get("role")

    if role not in ["buyer", "farmer"]:
        return jsonify({
            "success": False,
            "message": "You are not allowed to update orders."
        }), 403

    data = request.get_json(silent=True) or {}
    new_status = str(data.get("status", "")).strip().lower()

    if new_status not in ["confirmed", "completed", "cancelled"]:
        return jsonify({
            "success": False,
            "message": "Invalid order status."
        }), 400

    connection = None
    cursor = None
    database_started = None

    try:
        database_started = time.perf_counter()
        connection = get_db_connection()
        connection.start_transaction()

        cursor = connection.cursor(dictionary=True)

        # Lock the order and verify ownership.
        if role == "buyer":
            cursor.execute(
                """
                SELECT
                    order_id,
                    produce_id,
                    buyer_id,
                    farmer_id,
                    quantity,
                    total_amount,
                    status
                FROM orders
                WHERE order_id = %s
                  AND buyer_id = %s
                FOR UPDATE
                """,
                (order_id, session["user_id"])
            )

        else:
            cursor.execute(
                """
                SELECT
                    order_id,
                    produce_id,
                    buyer_id,
                    farmer_id,
                    quantity,
                    total_amount,
                    status
                FROM orders
                WHERE order_id = %s
                  AND farmer_id = %s
                FOR UPDATE
                """,
                (order_id, session["user_id"])
            )

        order = cursor.fetchone()

        if not order:
            connection.rollback()

            return jsonify({
                "success": False,
                "message": "Order not found or you do not own this order."
            }), 404

        current_status = order["status"]

        # Validate allowed status transitions.
        if role == "buyer":

            if not (
                current_status == "pending"
                and new_status == "cancelled"
            ):
                connection.rollback()

                return jsonify({
                    "success": False,
                    "message": "Buyers can only cancel pending orders."
                }), 409

        else:

            allowed_transitions = {
                "pending": ["confirmed", "cancelled"],
                "confirmed": ["completed", "cancelled"],
                "completed": [],
                "cancelled": []
            }

            if new_status not in allowed_transitions.get(
                current_status, []
            ):
                connection.rollback()

                return jsonify({
                    "success": False,
                    "message": (
                        f"Cannot change order from "
                        f"{current_status} to {new_status}."
                    )
                }), 409

        # If an order is cancelled, return its quantity to stock.
        if new_status == "cancelled":
            cursor.execute(
                """
                SELECT quantity, available
                FROM produce
                WHERE produce_id = %s
                  AND farmer_id = %s
                FOR UPDATE
                """,
                (
                    order["produce_id"],
                    order["farmer_id"]
                )
            )

            produce = cursor.fetchone()

            if not produce:
                connection.rollback()

                return jsonify({
                    "success": False,
                    "message": "Related produce listing was not found."
                }), 409

            restored_quantity = (
                float(produce["quantity"]) + float(order["quantity"])
            )

            # Restore quantity. Keep the existing availability flag;
            # a farmer may have intentionally deactivated the listing.
            cursor.execute(
                """
                UPDATE produce
                SET quantity = %s
                WHERE produce_id = %s
                  AND farmer_id = %s
                """,
                (
                    restored_quantity,
                    order["produce_id"],
                    order["farmer_id"]
                )
            )

        cursor.execute(
            """
            UPDATE orders
            SET status = %s
            WHERE order_id = %s
            """,
            (new_status, order_id)
        )

        produce_name = None
        produce_unit = None
        if new_status in {"confirmed", "completed"}:
            cursor.execute(
                "SELECT produce_name, unit FROM produce WHERE produce_id = %s",
                (order["produce_id"],),
            )
            produce_row = cursor.fetchone()
            produce_name = produce_row.get("produce_name") if produce_row else None
            produce_unit = produce_row.get("unit") if produce_row else None

            timestamp = datetime.now().astimezone().isoformat(timespec="minutes")
            base_details = {
                "order_id": order["order_id"],
                "produce": produce_name,
                "quantity": order.get("quantity"),
                "unit": produce_unit,
                "unit_price": unit_price_from_total(
                    order.get("total_amount"), order.get("quantity")
                ),
                "total": order.get("total_amount"),
                "date": timestamp,
            }
            if new_status == "confirmed":
                enqueue_notification(
                    cursor,
                    event="order_confirmed",
                    idempotency_key=f"order_confirmed:order:{order['order_id']}:recipient:{order['buyer_id']}",
                    recipient_user_id=order["buyer_id"],
                    other_party_user_id=order["farmer_id"],
                    details=base_details,
                )
            else:
                enqueue_notification(
                    cursor,
                    event="order_completed",
                    idempotency_key=f"order_completed:order:{order['order_id']}:recipient:{order['buyer_id']}",
                    recipient_user_id=order["buyer_id"],
                    other_party_user_id=order["farmer_id"],
                    details=base_details,
                )
                enqueue_notification(
                    cursor,
                    event="order_completed",
                    idempotency_key=f"order_completed:order:{order['order_id']}:recipient:{order['farmer_id']}",
                    recipient_user_id=order["farmer_id"],
                    other_party_user_id=order["buyer_id"],
                    details=base_details,
                )

        connection.commit()

        return jsonify({
            "success": True,
            "message": f"Order {new_status} successfully.",
            "order_id": order_id,
            "status": new_status
        })

    except Exception:
        if connection:
            connection.rollback()

        logging.error("order_transaction_failed event=order_status")

        return jsonify({
            "success": False,
            "message": "Could not update order. Check the Flask terminal."
        }), 500

    finally:
        if cursor:
            cursor.close()

        if connection:
            connection.close()
        if database_started is not None:
            log_duration("order_status", "database_transaction", database_started)
