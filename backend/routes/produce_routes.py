
import hmac
import math

from flask import Blueprint, request, jsonify, session
from db import get_db_connection
import logging

produce_bp = Blueprint("produce", __name__)


@produce_bp.before_request
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
# ADD PRODUCE
# -----------------------------------------

@produce_bp.route("/api/produce", methods=["POST"])
def add_produce():

    if "user_id" not in session:
        return jsonify({
            "success": False,
            "message": "Please log in first."
        }), 401

    if session.get("role") != "farmer":
        return jsonify({
            "success": False,
            "message": "Only farmers can add produce."
        }), 403

    data = request.get_json(silent=True) or {}

    produce_name = str(data.get("produce_name", "")).strip()
    description = str(data.get("description", "")).strip()
    district = str(data.get("district", "")).strip()
    unit = str(data.get("unit", "kg")).strip()

    try:
        quantity = float(data.get("quantity", 0))
        price_per_unit = float(data.get("price_per_unit", 0))

    except (TypeError, ValueError):
        return jsonify({
            "success": False,
            "message": "Please enter a valid quantity and price."
        }), 400

    if not produce_name or not district:
        return jsonify({
            "success": False,
            "message": "Produce name and district are required."
        }), 400

    if (
        not math.isfinite(quantity)
        or not math.isfinite(price_per_unit)
        or quantity <= 0
        or price_per_unit <= 0
    ):
        return jsonify({
            "success": False,
            "message": "Quantity and price must be greater than zero."
        }), 400

    if unit not in ["kg", "g", "pieces", "bundles"]:
        return jsonify({
            "success": False,
            "message": "Please select a valid unit."
        }), 400

    connection = None

    try:
        connection = get_db_connection()
        cursor = connection.cursor()

        cursor.execute(
            """
            INSERT INTO produce (
                farmer_id,
                category_id,
                produce_name,
                description,
                quantity,
                unit,
                price_per_unit,
                district,
                available
            )
            VALUES (%s, NULL, %s, %s, %s, %s, %s, %s, 1)
            """,
            (
                session["user_id"],
                produce_name,
                description,
                quantity,
                unit,
                price_per_unit,
                district
            )
        )

        produce_id = cursor.lastrowid
        connection.commit()

        return jsonify({
            "success": True,
            "message": "Produce added successfully.",
            "produce_id": produce_id
        }), 201

    except Exception:
        if connection:
            connection.rollback()

        logging.exception("Failed to add produce")

        return jsonify({
            "success": False,
            "message": "Could not save produce. Check the Flask terminal."
        }), 500

    finally:
        if connection:
            connection.close()


# -----------------------------------------
# VIEW PUBLIC PRODUCE
# -----------------------------------------

@produce_bp.route("/api/produce", methods=["GET"])
def get_produce():

    connection = None

    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)

        cursor.execute(
            """
            SELECT
                p.produce_id,
                p.category_id,
                c.category_name,
                p.produce_name,
                p.description,
                p.quantity,
                p.unit,
                p.price_per_unit,
                p.district,
                p.created_at,
                u.user_id AS farmer_id,
                u.full_name AS farmer_name
            FROM produce AS p
            JOIN users AS u
                ON p.farmer_id = u.user_id
            LEFT JOIN categories AS c
                ON p.category_id = c.category_id
            WHERE p.available = 1
            ORDER BY p.created_at DESC
            """
        )

        produce_list = cursor.fetchall()

        for item in produce_list:

            if item.get("created_at"):
                item["created_at"] = item["created_at"].isoformat()

            if item.get("quantity") is not None:
                item["quantity"] = float(item["quantity"])

            if item.get("price_per_unit") is not None:
                item["price_per_unit"] = float(item["price_per_unit"])

        return jsonify({
            "success": True,
            "produce": produce_list
        })

    except Exception:
        logging.exception("Failed to retrieve public produce")

        return jsonify({
            "success": False,
            "message": "Could not retrieve produce."
        }), 500

    finally:
        if connection:
            connection.close()


# -----------------------------------------
# VIEW FARMER'S OWN PRODUCE
# -----------------------------------------

@produce_bp.route("/api/my-produce", methods=["GET"])
def get_my_produce():

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

    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)

        cursor.execute(
            """
            SELECT COUNT(*) AS total_count,
                   COALESCE(SUM(CASE WHEN available = 1 THEN 1 ELSE 0 END), 0) AS active_count
            FROM produce
            WHERE farmer_id = %s
            """,
            (session["user_id"],)
        )
        listing_counts = cursor.fetchone() or {}

        include_unavailable = request.args.get("include_unavailable") == "1"

        cursor.execute(
            """
            SELECT
                produce_id,
                produce.category_id,
                categories.category_name,
                produce_name,
                description,
                quantity,
                unit,
                price_per_unit,
                district,
                available,
                created_at
            FROM produce
            LEFT JOIN categories
                ON produce.category_id = categories.category_id
            WHERE farmer_id = %s
              AND (%s = 1 OR available = 1)
            ORDER BY created_at DESC
            """,
            (session["user_id"], int(include_unavailable))
        )

        produce_list = cursor.fetchall()

        for item in produce_list:

            if item.get("created_at"):
                item["created_at"] = item["created_at"].isoformat()

            if item.get("quantity") is not None:
                item["quantity"] = float(item["quantity"])

            if item.get("price_per_unit") is not None:
                item["price_per_unit"] = float(item["price_per_unit"])

        return jsonify({
            "success": True,
            "produce": produce_list,
            "total_count": int(listing_counts.get("total_count") or 0),
            "active_count": int(listing_counts.get("active_count") or 0),
        })

    except Exception:
        logging.exception("Failed to retrieve farmer produce")

        return jsonify({
            "success": False,
            "message": "Could not retrieve your produce."
        }), 500

    finally:
        if connection:
            connection.close()


# -----------------------------------------
# EDIT PRODUCE
# -----------------------------------------

@produce_bp.route("/api/produce/<int:produce_id>", methods=["PUT"])
def update_produce(produce_id):

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

    data = request.get_json(silent=True) or {}

    produce_name = str(data.get("produce_name", "")).strip()
    description = str(data.get("description", "")).strip()
    district = str(data.get("district", "")).strip()
    unit = str(data.get("unit", "kg")).strip()

    try:
        quantity = float(data.get("quantity", 0))
        price = float(data.get("price_per_unit", 0))

    except (TypeError, ValueError):
        return jsonify({
            "success": False,
            "message": "Invalid quantity or price."
        }), 400

    if not produce_name or not district:
        return jsonify({
            "success": False,
            "message": "Name and district are required."
        }), 400

    if (
        not math.isfinite(quantity)
        or not math.isfinite(price)
        or quantity <= 0
        or price <= 0
    ):
        return jsonify({
            "success": False,
            "message": "Quantity and price must be positive."
        }), 400

    if unit not in ["kg", "g", "pieces", "bundles"]:
        return jsonify({
            "success": False,
            "message": "Invalid unit."
        }), 400

    connection = None

    try:
        connection = get_db_connection()
        cursor = connection.cursor()

        cursor.execute(
            """
            UPDATE produce
            SET
                produce_name = %s,
                description = %s,
                quantity = %s,
                unit = %s,
                price_per_unit = %s,
                district = %s
            WHERE produce_id = %s
              AND farmer_id = %s
              AND available = 1
            """,
            (
                produce_name,
                description,
                quantity,
                unit,
                price,
                district,
                produce_id,
                session["user_id"]
            )
        )

        if cursor.rowcount == 0:
            connection.rollback()

            return jsonify({
                "success": False,
                "message": "Produce not found or you do not own it."
            }), 404

        connection.commit()

        return jsonify({
            "success": True,
            "message": "Produce updated successfully."
        })

    except Exception:
        if connection:
            connection.rollback()

        logging.exception("Failed to update produce")

        return jsonify({
            "success": False,
            "message": "Could not update produce."
        }), 500

    finally:
        if connection:
            connection.close()


# -----------------------------------------
# DELETE PRODUCE (SOFT DELETE)
# -----------------------------------------

@produce_bp.route("/api/produce/<int:produce_id>", methods=["DELETE"])
def delete_produce(produce_id):

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

    try:
        connection = get_db_connection()
        cursor = connection.cursor()

        cursor.execute(
            """
            UPDATE produce
            SET available = 0
            WHERE produce_id = %s
              AND farmer_id = %s
              AND available = 1
            """,
            (
                produce_id,
                session["user_id"]
            )
        )

        if cursor.rowcount == 0:
            connection.rollback()

            return jsonify({
                "success": False,
                "message": "Produce not found or you do not own it."
            }), 404

        connection.commit()

        return jsonify({
            "success": True,
            "message": "Produce deleted successfully."
        })

    except Exception:
        if connection:
            connection.rollback()

        logging.exception("Failed to delete produce")

        return jsonify({
            "success": False,
            "message": "Could not delete produce."
        }), 500

    finally:
        if connection:
            connection.close()
