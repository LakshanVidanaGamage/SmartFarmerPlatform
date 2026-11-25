"""Admin-only overview and catalog management endpoints."""

from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from functools import wraps
import hmac
import re

from flask import Blueprint, jsonify, request, session
import mysql.connector

from db import get_db_connection


admin_bp = Blueprint("admin", __name__, url_prefix="/api/admin")

PAGE_SIZE_DEFAULT = 10
PAGE_SIZE_MAX = 100
PAGE_NUMBER_MAX = 100000
OFFER_STATUSES = ("pending", "accepted", "rejected", "cancelled")
ORDER_STATUSES = ("pending", "confirmed", "completed", "cancelled")


class AdminInputError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def _json_error(message, status):
    return jsonify({"success": False, "message": message}), status


@admin_bp.before_request
def require_admin_and_csrf():
    if "user_id" not in session:
        return _json_error("Please log in as an Admin.", 401)
    if session.get("role") != "admin":
        return _json_error("Admin access required.", 403)
    if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
        expected = session.get("admin_csrf_token", "")
        submitted = request.headers.get("X-CSRF-Token", "")
        if (
            not isinstance(expected, str)
            or not isinstance(submitted, str)
            or not expected
            or not hmac.compare_digest(expected, submitted)
        ):
            return _json_error("Your session token is invalid. Refresh and try again.", 400)


@admin_bp.after_request
def prevent_admin_data_caching(response):
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, private"
    response.headers["Pragma"] = "no-cache"
    return response


def _open_cursor():
    connection = get_db_connection()
    try:
        return connection, connection.cursor(dictionary=True)
    except Exception:
        connection.close()
        raise


def _close(connection, cursor):
    try:
        if cursor is not None:
            cursor.close()
    finally:
        if connection is not None:
            connection.close()


def _serialize(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return value


def _serialize_rows(rows):
    return [{key: _serialize(value) for key, value in row.items()} for row in rows]


def _pagination():
    try:
        page = min(PAGE_NUMBER_MAX, max(1, int(request.args.get("page", "1"))))
        per_page = min(PAGE_SIZE_MAX, max(1, int(request.args.get("per_page", str(PAGE_SIZE_DEFAULT)))))
    except (TypeError, ValueError):
        raise AdminInputError("Page and page size must be whole numbers.") from None
    return page, per_page, (page - 1) * per_page


def _search_term():
    return request.args.get("q", "").strip()[:120]


def _like(value):
    return f"%{value}%"


def _page_result(cursor, count_sql, count_params, select_sql, select_params, page, per_page, offset):
    cursor.execute(count_sql, count_params)
    total = int(cursor.fetchone()["total"])
    cursor.execute(select_sql, (*select_params, per_page, offset))
    items = _serialize_rows(cursor.fetchall())
    return jsonify({
        "success": True,
        "items": items,
        "page": page,
        "per_page": per_page,
        "total": total,
        "pages": (total + per_page - 1) // per_page,
    })


def _sort(requested, allowed, default, direction):
    if direction.lower() not in {"asc", "desc"}:
        raise AdminInputError("Sort direction must be asc or desc.")
    column = allowed.get(requested, default)
    order = direction.upper()
    return f"{column} {order}"


def _json_payload():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        raise AdminInputError("Send a valid JSON object.")
    return payload


def _database_error(connection, message="Could not complete the Admin request."):
    if connection is not None:
        try:
            connection.rollback()
        except mysql.connector.Error:
            pass
    return _json_error(message, 500)


@admin_bp.errorhandler(AdminInputError)
def handle_admin_input_error(error):
    return _json_error(str(error), error.status)


@admin_bp.route("/filters", methods=["GET"])
def filter_options():
    connection = cursor = None
    try:
        connection, cursor = _open_cursor()
        cursor.execute("SELECT user_id, full_name FROM users WHERE role = 'farmer' ORDER BY full_name LIMIT 200")
        farmers = cursor.fetchall()
        cursor.execute("SELECT category_id, category_name FROM categories ORDER BY category_name LIMIT 200")
        categories = cursor.fetchall()
        cursor.execute(
            "SELECT DISTINCT district FROM produce WHERE available = 1 "
            "AND district IS NOT NULL AND TRIM(district) <> '' ORDER BY district LIMIT 200"
        )
        districts = [row["district"] for row in cursor.fetchall()]
        return jsonify({
            "success": True,
            "farmers": farmers,
            "categories": categories,
            "farmer_districts": districts,
        })
    except mysql.connector.Error:
        return _database_error(connection)
    finally:
        _close(connection, cursor)


@admin_bp.route("/overview", methods=["GET"])
def overview():
    connection = cursor = None
    try:
        connection, cursor = _open_cursor()
        metrics = {}
        cursor.execute("SELECT role, COUNT(*) AS total FROM users WHERE role IN ('farmer', 'buyer') GROUP BY role")
        role_counts = {row["role"]: int(row["total"]) for row in cursor.fetchall()}
        metrics["farmers"] = role_counts.get("farmer", 0)
        metrics["buyers"] = role_counts.get("buyer", 0)
        cursor.execute("SELECT COUNT(*) AS total FROM users")
        metrics["total_users"] = int(cursor.fetchone()["total"])

        cursor.execute(
            """
            SELECT COUNT(*) AS total,
                   COALESCE(SUM(CASE WHEN available = 1 THEN 1 ELSE 0 END), 0) AS available
            FROM produce
            """
        )
        produce_counts = cursor.fetchone()
        metrics["total_produce"] = int(produce_counts["total"])
        metrics["available_produce"] = int(produce_counts["available"])
        cursor.execute("SELECT COUNT(*) AS total FROM offers")
        metrics["total_offers"] = int(cursor.fetchone()["total"])
        cursor.execute("SELECT COUNT(*) AS total FROM orders")
        metrics["total_orders"] = int(cursor.fetchone()["total"])

        offer_counts = {status: 0 for status in OFFER_STATUSES}
        cursor.execute("SELECT status, COUNT(*) AS total FROM offers GROUP BY status")
        offer_counts.update({row["status"]: int(row["total"]) for row in cursor.fetchall() if row["status"] in offer_counts})
        order_counts = {status: 0 for status in ORDER_STATUSES}
        cursor.execute("SELECT status, COUNT(*) AS total FROM orders GROUP BY status")
        order_counts.update({row["status"]: int(row["total"]) for row in cursor.fetchall() if row["status"] in order_counts})
        return jsonify({
            "success": True,
            "metrics": metrics,
            "offers_by_status": offer_counts,
            "orders_by_status": order_counts,
        })
    except mysql.connector.Error:
        return _database_error(connection)
    finally:
        _close(connection, cursor)


@admin_bp.route("/farmers", methods=["GET"])
def farmers():
    page, per_page, offset = _pagination()
    query = _search_term()
    district = request.args.get("district", "").strip()[:100]
    where = ["u.role = 'farmer'"]
    params = []
    if query:
        where.append("(u.full_name LIKE %s OR u.email LIKE %s OR u.phone LIKE %s)")
        params.extend([_like(query)] * 3)
    if district:
        where.append("EXISTS (SELECT 1 FROM produce pf WHERE pf.farmer_id = u.user_id AND pf.available = 1 AND pf.district = %s)")
        params.append(district)
    clause = " AND ".join(where)
    allowed_sort = {
        "name": "u.full_name",
        "created_at": "u.created_at",
        "active_produce": "COALESCE(pd.active_produce_count, 0)",
    }
    order_by = _sort(request.args.get("sort", "name"), allowed_sort, "u.full_name", request.args.get("direction", "asc"))
    count_sql = f"SELECT COUNT(*) AS total FROM users u WHERE {clause}"
    select_sql = f"""
        SELECT u.user_id, u.first_name, u.last_name, u.full_name, u.email, u.phone,
               u.created_at, COALESCE(pd.districts, '') AS districts,
               COALESCE(pd.active_produce_count, 0) AS active_produce_count
        FROM users u
        LEFT JOIN (
            SELECT farmer_id,
                   GROUP_CONCAT(DISTINCT CASE WHEN available = 1 THEN district END ORDER BY district SEPARATOR ', ') AS districts,
                   SUM(CASE WHEN available = 1 THEN 1 ELSE 0 END) AS active_produce_count
            FROM produce GROUP BY farmer_id
        ) pd ON pd.farmer_id = u.user_id
        WHERE {clause}
        ORDER BY {order_by}
        LIMIT %s OFFSET %s
    """
    connection = cursor = None
    try:
        connection, cursor = _open_cursor()
        return _page_result(cursor, count_sql, params, select_sql, params, page, per_page, offset)
    except mysql.connector.Error:
        return _database_error(connection)
    finally:
        _close(connection, cursor)


@admin_bp.route("/buyers", methods=["GET"])
def buyers():
    page, per_page, offset = _pagination()
    query = _search_term()
    where = ["role = 'buyer'"]
    params = []
    if query:
        where.append("(full_name LIKE %s OR email LIKE %s OR phone LIKE %s)")
        params.extend([_like(query)] * 3)
    clause = " AND ".join(where)
    allowed_sort = {"name": "full_name", "created_at": "created_at"}
    order_by = _sort(request.args.get("sort", "name"), allowed_sort, "full_name", request.args.get("direction", "asc"))
    count_sql = f"SELECT COUNT(*) AS total FROM users WHERE {clause}"
    select_sql = f"""
        SELECT user_id, first_name, last_name, full_name, email, phone, created_at
        FROM users WHERE {clause}
        ORDER BY {order_by} LIMIT %s OFFSET %s
    """
    connection = cursor = None
    try:
        connection, cursor = _open_cursor()
        return _page_result(cursor, count_sql, params, select_sql, params, page, per_page, offset)
    except mysql.connector.Error:
        return _database_error(connection)
    finally:
        _close(connection, cursor)


@admin_bp.route("/produce", methods=["GET"])
def produce():
    page, per_page, offset = _pagination()
    query = _search_term()
    where = ["1 = 1"]
    params = []
    if query:
        where.append("(p.produce_name LIKE %s OR p.district LIKE %s OR u.full_name LIKE %s)")
        params.extend([_like(query)] * 3)
    availability = request.args.get("availability", "all")
    if availability not in {"all", "available", "unavailable"}:
        raise AdminInputError("Select a valid availability filter.")
    if availability in {"available", "unavailable"}:
        where.append("p.available = %s")
        params.append(1 if availability == "available" else 0)
    district = request.args.get("district", "").strip()[:100]
    if district:
        where.append("p.district = %s")
        params.append(district)
    farmer_id = request.args.get("farmer_id", "").strip()
    if farmer_id:
        try:
            parsed_farmer_id = int(farmer_id)
        except ValueError:
            raise AdminInputError("Farmer filter must be a user ID.") from None
        if parsed_farmer_id < 1:
            raise AdminInputError("Farmer filter must be a positive user ID.")
        params.append(parsed_farmer_id)
        where.append("p.farmer_id = %s")
    category_id = request.args.get("category_id", "").strip()
    if category_id:
        try:
            parsed_category_id = int(category_id)
        except ValueError:
            raise AdminInputError("Category filter must be a category ID.") from None
        if parsed_category_id < 1:
            raise AdminInputError("Category filter must be a positive category ID.")
        params.append(parsed_category_id)
        where.append("p.category_id = %s")
    clause = " AND ".join(where)
    joins = "FROM produce p JOIN users u ON u.user_id = p.farmer_id LEFT JOIN categories c ON c.category_id = p.category_id"
    allowed_sort = {
        "name": "p.produce_name",
        "quantity": "p.quantity",
        "price": "p.price_per_unit",
        "created_at": "p.created_at",
    }
    order_by = _sort(request.args.get("sort", "created_at"), allowed_sort, "p.created_at", request.args.get("direction", "desc"))
    count_sql = f"SELECT COUNT(*) AS total {joins} WHERE {clause}"
    select_sql = f"""
        SELECT p.produce_id, p.farmer_id, u.full_name AS farmer_name,
               p.category_id, c.category_name, p.produce_name, p.description,
               p.quantity, p.unit, p.price_per_unit, p.district, p.available, p.created_at
        {joins} WHERE {clause}
        ORDER BY {order_by} LIMIT %s OFFSET %s
    """
    connection = cursor = None
    try:
        connection, cursor = _open_cursor()
        return _page_result(cursor, count_sql, params, select_sql, params, page, per_page, offset)
    except mysql.connector.Error:
        return _database_error(connection)
    finally:
        _close(connection, cursor)


@admin_bp.route("/market-prices", methods=["GET"])
def market_prices():
    page, per_page, offset = _pagination()
    query = _search_term()
    district = request.args.get("district", "").strip()[:100]
    where = ["1 = 1"]
    params = []
    if query:
        where.append("(produce_name LIKE %s OR market_name LIKE %s OR district LIKE %s)")
        params.extend([_like(query)] * 3)
    if district:
        where.append("district = %s")
        params.append(district)
    clause = " AND ".join(where)
    allowed_sort = {"produce": "produce_name", "market": "market_name", "date": "price_date", "price": "price_per_kg"}
    order_by = _sort(request.args.get("sort", "date"), allowed_sort, "price_date", request.args.get("direction", "desc"))
    connection = cursor = None
    try:
        connection, cursor = _open_cursor()
        return _page_result(
            cursor,
            f"SELECT COUNT(*) AS total FROM market_prices WHERE {clause}",
            params,
            f"SELECT price_id, produce_name, market_name, district, price_per_kg, price_date FROM market_prices WHERE {clause} ORDER BY {order_by} LIMIT %s OFFSET %s",
            params,
            page,
            per_page,
            offset,
        )
    except mysql.connector.Error:
        return _database_error(connection)
    finally:
        _close(connection, cursor)


def _market_price_payload():
    payload = _json_payload()
    produce_name = str(payload.get("produce_name", "")).strip()
    market_name = str(payload.get("market_name", "")).strip()
    district = str(payload.get("district", "")).strip() or None
    if not produce_name or len(produce_name) > 100:
        raise AdminInputError("Produce name is required and must be at most 100 characters.")
    if not market_name or len(market_name) > 100:
        raise AdminInputError("Market name is required and must be at most 100 characters.")
    if district is not None and len(district) > 100:
        raise AdminInputError("District must be at most 100 characters.")
    try:
        price = Decimal(str(payload.get("price_per_kg", "")))
        if not price.is_finite() or price <= 0 or price > Decimal("99999999.99"):
            raise InvalidOperation
        if price != price.quantize(Decimal("0.01")):
            raise InvalidOperation
    except (InvalidOperation, ValueError):
        raise AdminInputError("Price must be positive and contain at most two decimal places.") from None
    date_text = str(payload.get("price_date", ""))
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date_text):
        raise AdminInputError("Enter a valid price date in YYYY-MM-DD format.")
    try:
        price_date = date.fromisoformat(date_text)
    except ValueError:
        raise AdminInputError("Enter a valid price date in YYYY-MM-DD format.") from None
    return produce_name, market_name, district, price, price_date


@admin_bp.route("/market-prices", methods=["POST"])
def create_market_price():
    values = _market_price_payload()
    connection = cursor = None
    try:
        connection, cursor = _open_cursor()
        cursor.execute(
            "INSERT INTO market_prices (produce_name, market_name, district, price_per_kg, price_date) VALUES (%s, %s, %s, %s, %s)",
            values,
        )
        price_id = cursor.lastrowid
        connection.commit()
        return jsonify({"success": True, "price_id": price_id, "message": "Market price added."}), 201
    except mysql.connector.Error:
        return _database_error(connection)
    finally:
        _close(connection, cursor)


@admin_bp.route("/market-prices/<int:price_id>", methods=["PUT"])
def update_market_price(price_id):
    values = _market_price_payload()
    connection = cursor = None
    try:
        connection, cursor = _open_cursor()
        cursor.execute("SELECT price_id FROM market_prices WHERE price_id = %s FOR UPDATE", (price_id,))
        if not cursor.fetchone():
            connection.rollback()
            return _json_error("Market price entry was not found.", 404)
        cursor.execute(
            "UPDATE market_prices SET produce_name = %s, market_name = %s, district = %s, price_per_kg = %s, price_date = %s WHERE price_id = %s",
            (*values, price_id),
        )
        connection.commit()
        return jsonify({"success": True, "message": "Market price updated."})
    except mysql.connector.Error:
        return _database_error(connection)
    finally:
        _close(connection, cursor)


@admin_bp.route("/market-prices/<int:price_id>", methods=["DELETE"])
def delete_market_price(price_id):
    connection = cursor = None
    try:
        connection, cursor = _open_cursor()
        cursor.execute("DELETE FROM market_prices WHERE price_id = %s", (price_id,))
        if cursor.rowcount != 1:
            connection.rollback()
            return _json_error("Market price entry was not found.", 404)
        connection.commit()
        return jsonify({"success": True, "message": "Market price deleted."})
    except mysql.connector.Error:
        return _database_error(connection)
    finally:
        _close(connection, cursor)


@admin_bp.route("/offers", methods=["GET"])
def offers():
    return _transaction_list("offers")


@admin_bp.route("/orders", methods=["GET"])
def orders():
    return _transaction_list("orders")


def _transaction_list(kind):
    page, per_page, offset = _pagination()
    query = _search_term()
    is_offer = kind == "offers"
    table = "offers" if is_offer else "orders"
    primary_key = "offer_id" if is_offer else "order_id"
    allowed_status = OFFER_STATUSES if is_offer else ORDER_STATUSES
    status = request.args.get("status", "all")
    where = ["1 = 1"]
    params = []
    if status != "all":
        if status not in allowed_status:
            raise AdminInputError("Select a valid transaction status.")
        where.append(f"o.status = %s")
        params.append(status)
    if query:
        where.append("(p.produce_name LIKE %s OR farmer.full_name LIKE %s OR buyer.full_name LIKE %s)")
        params.extend([_like(query)] * 3)
    clause = " AND ".join(where)
    joins = f"""
        FROM {table} o
        JOIN produce p ON p.produce_id = o.produce_id
        JOIN users farmer ON farmer.user_id = o.farmer_id
        JOIN users buyer ON buyer.user_id = o.buyer_id
    """
    allowed_sort = {
        "created_at": "o.created_at",
        "status": "o.status",
        "produce": "p.produce_name",
    }
    order_by = _sort(request.args.get("sort", "created_at"), allowed_sort, "o.created_at", request.args.get("direction", "desc"))
    if is_offer:
        projection = "o.offer_id, o.produce_id, p.produce_name, o.farmer_id, farmer.full_name AS farmer_name, o.buyer_id, buyer.full_name AS buyer_name, o.offered_price, o.quantity, o.status, o.created_at"
    else:
        projection = "o.order_id, o.produce_id, p.produce_name, o.farmer_id, farmer.full_name AS farmer_name, o.buyer_id, buyer.full_name AS buyer_name, o.quantity, o.total_amount, o.status, o.created_at"
    connection = cursor = None
    try:
        connection, cursor = _open_cursor()
        return _page_result(
            cursor,
            f"SELECT COUNT(*) AS total {joins} WHERE {clause}",
            params,
            f"SELECT {projection} {joins} WHERE {clause} ORDER BY {order_by}, o.{primary_key} DESC LIMIT %s OFFSET %s",
            params,
            page,
            per_page,
            offset,
        )
    except mysql.connector.Error:
        return _database_error(connection)
    finally:
        _close(connection, cursor)


@admin_bp.route("/categories", methods=["GET"])
def categories():
    page, per_page, offset = _pagination()
    query = _search_term()
    where = "WHERE category_name LIKE %s" if query else ""
    params = [_like(query)] if query else []
    connection = cursor = None
    try:
        connection, cursor = _open_cursor()
        return _page_result(
            cursor,
            f"SELECT COUNT(*) AS total FROM categories {where}",
            params,
            f"SELECT category_id, category_name FROM categories {where} ORDER BY category_name ASC LIMIT %s OFFSET %s",
            params,
            page,
            per_page,
            offset,
        )
    except mysql.connector.Error:
        return _database_error(connection)
    finally:
        _close(connection, cursor)


def _category_name():
    payload = _json_payload()
    name = str(payload.get("category_name", "")).strip()
    if not name or len(name) > 100:
        raise AdminInputError("Category name is required and must be at most 100 characters.")
    return name


@admin_bp.route("/categories", methods=["POST"])
def create_category():
    name = _category_name()
    connection = cursor = None
    try:
        connection, cursor = _open_cursor()
        cursor.execute("INSERT INTO categories (category_name) VALUES (%s)", (name,))
        category_id = cursor.lastrowid
        connection.commit()
        return jsonify({"success": True, "category_id": category_id, "message": "Category added."}), 201
    except mysql.connector.IntegrityError:
        if connection:
            connection.rollback()
        return _json_error("That category name already exists.", 409)
    except mysql.connector.Error:
        return _database_error(connection)
    finally:
        _close(connection, cursor)


@admin_bp.route("/categories/<int:category_id>", methods=["PUT"])
def update_category(category_id):
    name = _category_name()
    connection = cursor = None
    try:
        connection, cursor = _open_cursor()
        cursor.execute("SELECT category_id FROM categories WHERE category_id = %s FOR UPDATE", (category_id,))
        if not cursor.fetchone():
            connection.rollback()
            return _json_error("Category was not found.", 404)
        cursor.execute(
            "UPDATE categories SET category_name = %s WHERE category_id = %s",
            (name, category_id),
        )
        connection.commit()
        return jsonify({"success": True, "message": "Category updated."})
    except mysql.connector.IntegrityError:
        if connection:
            connection.rollback()
        return _json_error("That category name already exists.", 409)
    except mysql.connector.Error:
        return _database_error(connection)
    finally:
        _close(connection, cursor)


@admin_bp.route("/categories/<int:category_id>", methods=["DELETE"])
def delete_category(category_id):
    connection = cursor = None
    try:
        connection, cursor = _open_cursor()
        connection.start_transaction()
        cursor.execute("SELECT category_id FROM categories WHERE category_id = %s FOR UPDATE", (category_id,))
        if not cursor.fetchone():
            connection.rollback()
            return _json_error("Category was not found.", 404)
        cursor.execute("SELECT produce_id FROM produce WHERE category_id = %s FOR UPDATE", (category_id,))
        if cursor.fetchall():
            connection.rollback()
            return _json_error("This category is assigned to produce and cannot be deleted.", 409)
        cursor.execute("DELETE FROM categories WHERE category_id = %s", (category_id,))
        connection.commit()
        return jsonify({"success": True, "message": "Category deleted."})
    except mysql.connector.Error:
        return _database_error(connection)
    finally:
        _close(connection, cursor)
