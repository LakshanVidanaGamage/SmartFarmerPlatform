
from flask import (
    Flask,
    render_template,
    render_template_string,
    request,
    redirect,
    url_for,
    jsonify,
    send_from_directory,
    session
)

from pathlib import Path
import logging
import os
import secrets
import hmac
import threading
import time
from services.email_outbox import log_duration
from services.email_outbox_worker import EmailOutboxWorkerLifecycle

from auth import authenticate_user
from db import get_db_connection
from config import Config

from routes.produce_routes import produce_bp
from routes.offer_routes import offer_bp
from routes.order_routes import order_bp
from routes.auth_routes import auth_bp
from routes.profile_routes import profile_bp
from routes.admin_routes import admin_bp


app = Flask(__name__)


def _runtime_security_settings(app_environment, debug_setting, development_explicit):
    environment = str(app_environment or "development").strip().lower()
    debug_opt_in = str(debug_setting or "").strip().lower() in {"1", "true", "yes", "on"}
    return {
        "DEBUG": environment == "development" and development_explicit and debug_opt_in,
        "SESSION_COOKIE_HTTPONLY": True,
        "SESSION_COOKIE_SECURE": environment != "development",
        "SESSION_COOKIE_SAMESITE": "Lax",
    }

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"


def render_auth_page(filename):
    csrf_token = session.get("auth_csrf_token")
    if not isinstance(csrf_token, str) or not csrf_token:
        csrf_token = secrets.token_urlsafe(32)
        session["auth_csrf_token"] = csrf_token

    language = session.get("language", "en")
    if language not in ["si", "en", "ta"]:
        language = "en"

    template = (FRONTEND_DIR / filename).read_text(encoding="utf-8")
    return render_template_string(
        template,
        csrf_token=csrf_token,
        language=language,
    )


# =========================================
# CONFIGURATION
# =========================================

app.config.from_object(Config)
configured_app_environment = os.getenv("APP_ENV")
app.config.update(_runtime_security_settings(
    app_environment=configured_app_environment or "development",
    debug_setting=os.getenv("FLASK_DEBUG", ""),
    development_explicit=configured_app_environment is not None,
))
app.config["TEMPLATES_AUTO_RELOAD"] = True
app.jinja_env.auto_reload = True


# =========================================
# FRONTEND FILES
# =========================================

@app.route("/frontend/<path:filename>")
def frontend_files(filename):
    if filename in {"login.html", "register.html"}:
        return render_auth_page(filename)
    return send_from_directory(FRONTEND_DIR, filename)


# =========================================
# LOGIN PAGE
# =========================================

@app.route("/login-page")
def login_page():
    return render_auth_page("login.html")


# =========================================
# REGISTER PAGE
# =========================================

@app.route("/register-page")
def register_page():
    return render_auth_page("register.html")


# =========================================
# REGISTER BLUEPRINTS
# =========================================

app.register_blueprint(produce_bp)
app.register_blueprint(offer_bp)
app.register_blueprint(order_bp)
app.register_blueprint(auth_bp)
app.register_blueprint(profile_bp)
app.register_blueprint(admin_bp)


def _market_price_initial_page():
    connection = cursor = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)
        cursor.execute("SELECT COUNT(*) AS total FROM market_prices")
        total = int(cursor.fetchone()["total"])
        pages = (total + 5) // 6
        cursor.execute(
            """
            SELECT produce_name, market_name, district, price_per_kg, price_date
            FROM market_prices
            ORDER BY price_date DESC, price_id DESC
            LIMIT 6
            """
        )
        return cursor.fetchall(), {"page": 1, "pages": pages, "total": total}
    except Exception:
        app.logger.exception("Could not load the initial market prices")
        return [], {"page": 1, "pages": 0, "total": 0}
    finally:
        if cursor:
            cursor.close()
        if connection:
            connection.close()


def _market_price_page(page):
    """Return one read-only page of market prices for Farmer or Buyer."""
    page = max(1, min(100000, page))
    per_page = 6
    connection = cursor = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)
        cursor.execute("SELECT COUNT(*) AS total FROM market_prices")
        total = int(cursor.fetchone()["total"])
        pages = (total + per_page - 1) // per_page
        page = min(page, max(1, pages))
        cursor.execute(
            """
            SELECT produce_name, market_name, district, price_per_kg, price_date
            FROM market_prices
            ORDER BY price_date DESC, price_id DESC
            LIMIT %s OFFSET %s
            """,
            (per_page, (page - 1) * per_page),
        )
        rows = cursor.fetchall()
        for row in rows:
            row["produce_name"] = row.get("produce_name") or "Produce"
            row["market_name"] = row.get("market_name") or "Local Market"
            row["district"] = row.get("district") or ""
            row["price_per_kg"] = float(row.get("price_per_kg") or 0)
            row["price_date"] = (
                row["price_date"].isoformat()
                if hasattr(row.get("price_date"), "isoformat")
                else row.get("price_date", "")
            )
        return jsonify({
            "success": True,
            "items": rows,
            "page": page,
            "per_page": per_page,
            "total": total,
            "pages": pages,
        })
    except Exception:
        app.logger.exception("Could not load a market price page")
        return jsonify({"success": False, "message": "Market prices could not be loaded."}), 500
    finally:
        if cursor:
            cursor.close()
        if connection:
            connection.close()


def _dashboard_market_price_page(role):
    if "user_id" not in session:
        return jsonify({"success": False, "message": "Please sign in to view market prices."}), 401
    if session.get("role") != role:
        return jsonify({"success": False, "message": "You do not have access to these market prices."}), 403
    try:
        page = int(request.args.get("page", "1"))
    except (TypeError, ValueError):
        return jsonify({"success": False, "message": "Page must be a whole number."}), 400
    return _market_price_page(page)


@app.route("/api/farmer/market-prices", methods=["GET"])
def farmer_market_price_page():
    return _dashboard_market_price_page("farmer")


@app.route("/api/buyer/market-prices", methods=["GET"])
def buyer_market_price_page():
    return _dashboard_market_price_page("buyer")


_ACCOUNT_VERIFIED_ENDPOINTS = {
    "dashboard",
    "farmer_dashboard",
    "buyer_dashboard",
    "farmer_market_price_page",
    "buyer_market_price_page",
    "profile.profile_page",
    "auth.current_user",
}


def _requires_database_account(endpoint):
    # Keep the public produce API public while validating protected account
    # existence and the authoritative database role.
    if endpoint == "produce.get_produce":
        return False
    return bool(
        endpoint
        and (
            endpoint in _ACCOUNT_VERIFIED_ENDPOINTS
            or endpoint.startswith(("produce.", "offers.", "orders.", "admin."))
        )
    )


@app.before_request
def verify_database_account_for_protected_requests():
    if not _requires_database_account(request.endpoint):
        return None

    user_id = session.get("user_id")
    if user_id is None:
        return None  # Existing route guards retain their response behavior.

    connection = None
    cursor = None
    database_started = time.perf_counter()
    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)
        cursor.execute(
            "SELECT role FROM users WHERE user_id = %s",
            (user_id,),
        )
        account = cursor.fetchone()
    except Exception:
        app.logger.exception("Unable to verify account for protected request")
        message = "Account verification is temporarily unavailable. Please try again."
        if request.path.startswith("/api/") or request.accept_mimetypes.best == "application/json":
            return jsonify({"success": False, "message": message}), 503
        return message, 503, {"Content-Type": "text/plain; charset=utf-8"}
    finally:
        if cursor:
            cursor.close()
        if connection:
            connection.close()
        log_duration("protected_request_account_verification", "database", database_started)

    if (
        not account
        or account.get("role") not in {"farmer", "buyer", "admin"}
    ):
        session.clear()
        if request.path.startswith("/api/") or request.accept_mimetypes.best == "application/json":
            return jsonify({
                "success": False,
                "message": "Please log in again.",
            }), 401
        return redirect(url_for("login_page"))

    # Downstream role checks use the authoritative database role, not the
    # possibly stale value captured in the session at login.
    session["role"] = account["role"]
    return None


# Avoid restoring stale session-dependent pages after a login-state change.
AUTH_STATE_ENDPOINTS = {
    "login_page",
    "register_page",
    "public_dashboard",
    "public_produce",
    "public_farmers",
    "public_farmer_profile",
    "public_buyers",
    "public_buyer_profile",
    "profile.profile_page",
    "dashboard",
    "farmer_dashboard",
    "buyer_dashboard",
    "logout",
    "auth.login",
    "auth.logout",
}


@app.after_request
def prevent_session_page_caching(response):
    if request.endpoint in AUTH_STATE_ENDPOINTS or (
        request.endpoint == "frontend_files"
        and request.view_args
        and request.view_args.get("filename") in {"login.html", "register.html"}
    ) or (
        request.endpoint and request.endpoint.startswith("admin.")
    ):
        response.headers["Cache-Control"] = "no-store"
    return response


# =========================================
# LANGUAGE SELECTION
# =========================================

@app.route("/")
def language_selection():
    return render_template("language.html")


@app.route("/set-language/<language>")
def set_language(language):

    if language in ["si", "en", "ta"]:
        session["language"] = language
        if request.accept_mimetypes.best == "application/json":
            return jsonify({"success": True}), 200
        return redirect(url_for("public_dashboard"))

    return redirect(url_for("language_selection"))


# =========================================
# PUBLIC APPLICATION DASHBOARD
# =========================================

@app.route("/home")
def public_dashboard():

    produce_list = []
    market_prices = []
    market_prices_page = {"page": 1, "pages": 0, "total": 0}

    connection = None
    cursor = None

    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)

        # AVAILABLE PRODUCE

        cursor.execute(
            """
            SELECT
                p.produce_id,
                p.produce_name,
                p.description,
                p.quantity,
                p.unit,
                p.price_per_unit,
                p.district,
                u.user_id AS farmer_id,
                u.full_name AS farmer_name
            FROM produce AS p
            JOIN users AS u ON p.farmer_id = u.user_id
            WHERE p.available = 1
            ORDER BY p.created_at DESC
            LIMIT 12
            """
        )

        produce_list = cursor.fetchall()

        # LATEST MARKET PRICES

        cursor.execute(
            """
            SELECT
                price_id,
                produce_name,
                market_name,
                district,
                price_per_kg,
                price_date
            FROM market_prices
            ORDER BY price_date DESC, price_id DESC
            LIMIT 8
            """
        )

        market_prices = cursor.fetchall()

    except Exception:
        app.logger.exception(
            "Could not load public dashboard data"
        )

    finally:
        if cursor:
            cursor.close()

        if connection:
            connection.close()

    return render_template(
        "index.html",
        produce_list=produce_list,
        market_prices=market_prices,
        language=session.get("language", "en")
    )


@app.route("/market-prices")
def public_market_prices():
    market_prices = []
    connection = cursor = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)
        cursor.execute(
            """
            SELECT produce_name, market_name, district, price_per_kg, price_date
            FROM market_prices
            ORDER BY price_date DESC, price_id DESC
            """
        )
        market_prices = cursor.fetchall()
        for price in market_prices:
            price["produce_name"] = price.get("produce_name") or "Produce"
            price["market_name"] = price.get("market_name") or "Local Market"
            price["district"] = price.get("district") or ""
            price["price_per_kg"] = float(price.get("price_per_kg") or 0)
            price["price_date"] = (
                price["price_date"].isoformat()
                if hasattr(price.get("price_date"), "isoformat")
                else price.get("price_date", "")
            )
    except Exception:
        app.logger.exception("Could not load public market prices")
    finally:
        if cursor:
            cursor.close()
        if connection:
            connection.close()
    return render_template(
        "public_market_prices.html",
        market_prices=market_prices,
        language=session.get("language", "en"),
    )


@app.route("/produce")
def public_produce():
    return render_template(
        "public_produce.html",
        language=session.get("language", "en"),
    )


# =========================================
# PUBLIC FARMERS LIST
# =========================================

@app.route("/farmers")
def public_farmers():

    search = request.args.get("q", "").strip()[:100]
    selected_district = request.args.get("district", "").strip()[:100]
    farmers = []
    districts = []

    connection = None
    cursor = None

    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)

        cursor.execute(
            """
            SELECT DISTINCT p.district
            FROM produce AS p
            JOIN users AS u ON p.farmer_id = u.user_id
            WHERE u.role = 'farmer'
              AND p.available = 1
              AND p.district IS NOT NULL
              AND p.district != ''
            ORDER BY p.district ASC
            """
        )

        districts = [row["district"] for row in cursor.fetchall()]

        cursor.execute(
            """
            SELECT u.user_id, u.full_name
            FROM users AS u
            WHERE u.role = 'farmer'
              AND (%s = '' OR u.full_name LIKE %s)
              AND (
                    %s = ''
                    OR EXISTS (
                        SELECT 1
                        FROM produce AS filter_produce
                        WHERE filter_produce.farmer_id = u.user_id
                          AND filter_produce.available = 1
                          AND filter_produce.district = %s
                    )
              )
            ORDER BY u.full_name ASC
            """,
            (
                search,
                f"%{search}%",
                selected_district,
                selected_district
            )
        )

        farmers = cursor.fetchall()

        farmer_ids = [farmer["user_id"] for farmer in farmers]

        if farmer_ids:
            placeholders = ", ".join(["%s"] * len(farmer_ids))
            cursor.execute(
                f"""
                SELECT
                    public_produce.farmer_id,
                    produce_id,
                    produce_name,
                    quantity,
                    unit,
                    price_per_unit,
                    district
                FROM produce AS public_produce
                JOIN users AS listing_farmer
                  ON listing_farmer.user_id = public_produce.farmer_id
                WHERE public_produce.available = 1
                  AND public_produce.farmer_id IN ({placeholders})
                ORDER BY public_produce.created_at DESC
                """,
                tuple(farmer_ids)
            )

            produce_by_farmer = {
                farmer_id: {"districts": set(), "produce": []}
                for farmer_id in farmer_ids
            }

            for item in cursor.fetchall():
                farmer_data = produce_by_farmer[item["farmer_id"]]

                if item.get("district"):
                    farmer_data["districts"].add(item["district"])

                farmer_data["produce"].append(item)

            for farmer in farmers:
                farmer_data = produce_by_farmer[farmer["user_id"]]
                farmer["districts"] = sorted(farmer_data["districts"])
                farmer["produce_count"] = len(farmer_data["produce"])
                farmer["produce_preview"] = farmer_data["produce"][:3]
                farmer["produce_more_count"] = max(
                    farmer["produce_count"] - 3,
                    0
                )
        else:
            for farmer in farmers:
                farmer["districts"] = []
                farmer["produce_count"] = 0
                farmer["produce_preview"] = []
                farmer["produce_more_count"] = 0

    except Exception:
        app.logger.exception(
            "Could not load public farmers"
        )

    finally:
        if cursor:
            cursor.close()

        if connection:
            connection.close()

    return render_template(
        "public_farmers.html",
        farmers=farmers,
        districts=districts,
        search=search,
        selected_district=selected_district
    )


# =========================================
# PUBLIC BUYERS LIST
# =========================================

@app.route("/buyers")
def public_buyers():

    search = request.args.get("q", "").strip()[:100]
    buyers = []

    connection = None
    cursor = None

    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)

        cursor.execute(
            """
            SELECT
                user_id,
                full_name
            FROM users
            WHERE role = 'buyer'
              AND (%s = '' OR full_name LIKE %s)
            ORDER BY full_name ASC
            """,
            (search, f"%{search}%")
        )

        buyers = cursor.fetchall()

    except Exception:
        app.logger.exception(
            "Could not load public buyers"
        )

    finally:
        if cursor:
            cursor.close()

        if connection:
            connection.close()

    return render_template(
        "public_buyers.html",
        buyers=buyers,
        search=search
    )


# =========================================
# PUBLIC FARMER PROFILE
# =========================================

@app.route("/farmers/<int:farmer_id>")
def public_farmer_profile(farmer_id):

    connection = None
    cursor = None

    farmer = None
    produce_list = []
    farmer_districts = []

    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)

        cursor.execute(
            """
            SELECT
                user_id,
                full_name,
                role
            FROM users
            WHERE user_id = %s
              AND role = 'farmer'
            """,
            (farmer_id,)
        )

        farmer = cursor.fetchone()

        if farmer:

            cursor.execute(
                """
                SELECT
                    produce_id,
                    produce_name,
                    description,
                    quantity,
                    unit,
                    price_per_unit,
                    district
                FROM produce AS public_produce
                JOIN users AS listing_farmer
                  ON listing_farmer.user_id = public_produce.farmer_id
                WHERE public_produce.farmer_id = %s
                  AND public_produce.available = 1
                ORDER BY public_produce.created_at DESC
                """,
                (farmer_id,)
            )

            produce_list = cursor.fetchall()
            farmer_districts = sorted({
                item["district"]
                for item in produce_list
                if item.get("district")
            })

    except Exception:
        app.logger.exception(
            "Could not load public farmer profile"
        )

    finally:
        if cursor:
            cursor.close()

        if connection:
            connection.close()

    if not farmer:
        return render_template(
            "public_profile.html",
            farmer=None,
            produce_list=[],
            farmer_districts=[]
        ), 404

    return render_template(
        "public_profile.html",
        farmer=farmer,
        produce_list=produce_list,
        farmer_districts=farmer_districts
    )


# =========================================
# PUBLIC BUYER PROFILE
# =========================================

@app.route("/buyers/<int:buyer_id>")
def public_buyer_profile(buyer_id):

    connection = None
    cursor = None

    buyer = None

    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)

        cursor.execute(
            """
            SELECT
                user_id,
                full_name,
                role
            FROM users
            WHERE user_id = %s
              AND role = 'buyer'
            """,
            (buyer_id,)
        )

        buyer = cursor.fetchone()

    except Exception:
        app.logger.exception(
            "Could not load public buyer profile"
        )

    finally:
        if cursor:
            cursor.close()

        if connection:
            connection.close()

    if not buyer:
        return render_template(
            "public_buyer_profile.html",
            buyer=None
        ), 404

    return render_template(
        "public_buyer_profile.html",
        buyer=buyer
    )


# =========================================
# REGISTRATION
# =========================================

@app.route("/register", methods=["GET", "POST"])
def register():

    # All new registrations use email OTP.

    return redirect(
        url_for("register_page"),
        code=303
    )


# =========================================
# LOGIN
# =========================================

@app.route("/login", methods=["GET", "POST"])
def login():

    # GET: Open new frontend login page.

    if request.method == "GET":
        return redirect(url_for("login_page"))

    expected_csrf = session.get("auth_csrf_token", "")
    submitted_csrf = request.headers.get("X-CSRFToken", "")
    if (
        not isinstance(expected_csrf, str)
        or not expected_csrf
        or not submitted_csrf
        or not hmac.compare_digest(expected_csrf, submitted_csrf)
    ):
        return jsonify({
            "success": False,
            "message": "Your request could not be verified. Refresh the page and try again.",
        }), 403

    # POST: Compatibility with old HTML login forms.

    email = request.form.get(
        "email", ""
    ).strip().lower()

    password = request.form.get("password", "")

    if not email or not password:
        return redirect(url_for("login_page"))

    try:
        user = authenticate_user(email, password)

        if user:

            session.clear()

            session["user_id"] = user["user_id"]
            session["full_name"] = user["full_name"]
            session["role"] = user["role"]
            session["auth_csrf_token"] = secrets.token_urlsafe(32)

            return redirect(url_for("dashboard"))

        return redirect(url_for("login_page"))

    except Exception:
        app.logger.exception("Login failed")

        return redirect(url_for("login_page"))


# =========================================
# BUYER DASHBOARD DATA
# =========================================

def get_buyer_dashboard_data(buyer_id):

    data = {
        "districts": [],
        "total_produce": 0,
        "total_offers": 0,
        "pending_offers": 0,
        "total_orders": 0,
        "produce_list": [],
        "market_prices": [],
        "market_prices_page": {"page": 1, "pages": 0, "total": 0},
        "offer_list": [],
        "order_list": []
    }

    connection = None
    cursor = None

    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)

        crop = request.args.get(
            "crop", ""
        ).strip()

        district = request.args.get(
            "district", ""
        ).strip()

        # AVAILABLE PRODUCE

        cursor.execute(
            """
            SELECT
                p.produce_id,
                p.farmer_id,
                p.category_id,
                c.category_name,
                p.produce_name,
                p.description,
                p.quantity,
                p.unit,
                p.price_per_unit,
                p.district,
                p.created_at,
                u.full_name AS farmer_name
            FROM produce AS p
            JOIN users AS u ON p.farmer_id = u.user_id
            LEFT JOIN categories AS c ON p.category_id = c.category_id
            WHERE p.available = 1
              AND (%s = '' OR p.produce_name LIKE %s)
              AND (%s = '' OR p.district = %s)
            ORDER BY p.created_at DESC
            """,
            (
                crop,
                "%" + crop + "%",
                district,
                district
            )
        )

        produce_list = cursor.fetchall()

        for item in produce_list:

            if item.get("quantity") is not None:
                item["quantity"] = float(item["quantity"])

            if item.get("price_per_unit") is not None:
                item["price_per_unit"] = float(
                    item["price_per_unit"]
                )

            item["unit"] = item.get("unit") or "kg"
            item["description"] = item.get("description") or ""

            if item.get("created_at"):
                item["created_at"] = (
                    item["created_at"].isoformat()
                )

        data["produce_list"] = produce_list
        data["total_produce"] = len(produce_list)

        # DISTRICTS

        cursor.execute(
            """
            SELECT DISTINCT p.district
            FROM produce AS p
            JOIN users AS u ON u.user_id = p.farmer_id
            WHERE p.available = 1
              AND u.role = 'farmer'
              AND p.district IS NOT NULL
              AND p.district != ''
            ORDER BY p.district ASC
            """
        )

        district_rows = cursor.fetchall()

        data["districts"] = [
            row["district"] for row in district_rows
        ]

        # MARKET PRICES

        cursor.execute("SELECT COUNT(*) AS total FROM market_prices")
        price_total = int(cursor.fetchone()["total"])
        data["market_prices_page"] = {
            "page": 1,
            "pages": (price_total + 5) // 6,
            "total": price_total,
        }
        cursor.execute(
            """
            SELECT produce_name, market_name, district, price_per_kg, price_date
            FROM market_prices
            ORDER BY price_date DESC, price_id DESC
            LIMIT 6
            """
        )

        prices = cursor.fetchall()

        for price in prices:

            price["produce_name"] = (
                price.get("produce_name") or "Produce"
            )

            price["price_per_kg"] = float(
                price.get("price_per_kg") or 0
            )

            price["market_name"] = (
                price.get("market_name") or "Local Market"
            )

            price["district"] = (
                price.get("district") or ""
            )

        data["market_prices"] = prices

        # BUYER OFFERS

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
            JOIN produce AS p ON o.produce_id = p.produce_id
            JOIN users AS u ON o.farmer_id = u.user_id
            WHERE o.buyer_id = %s
            ORDER BY o.created_at DESC
            """,
            (buyer_id,)
        )

        offers = cursor.fetchall()

        for offer in offers:

            offer["offered_price"] = float(
                offer["offered_price"]
            )

            offer["quantity"] = float(
                offer["quantity"]
            )

            if offer.get("created_at"):
                offer["created_at"] = (
                    offer["created_at"].isoformat()
                )

        data["offer_list"] = offers
        data["total_offers"] = len(offers)
        data["pending_offers"] = sum(
            1 for offer in offers if str(offer.get("status", "")).lower() == "pending"
        )

        # BUYER ORDERS

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
            JOIN produce AS p ON o.produce_id = p.produce_id
            JOIN users AS u ON o.farmer_id = u.user_id
            WHERE o.buyer_id = %s
            ORDER BY o.created_at DESC
            """,
            (buyer_id,)
        )

        orders = cursor.fetchall()

        for order in orders:

            order["quantity"] = float(
                order["quantity"]
            )

            order["total_amount"] = float(
                order["total_amount"]
            )

            if order.get("created_at"):
                order["created_at"] = (
                    order["created_at"].isoformat()
                )

        data["order_list"] = orders
        data["total_orders"] = len(orders)

    except Exception:
        app.logger.exception(
            "Could not load buyer dashboard data"
        )

    finally:
        if cursor:
            cursor.close()

        if connection:
            connection.close()

    return data


# =========================================
# BUYER DASHBOARD
# =========================================

@app.route("/buyer/dashboard")
def buyer_dashboard():

    if "user_id" not in session:
        return redirect(url_for("login"))

    if session.get("role") != "buyer":
        return redirect(url_for("dashboard"))

    dashboard_data = get_buyer_dashboard_data(
        session["user_id"]
    )

    return render_template(
        "buyer_dashboard.html",
        page_view="dashboard",
        **dashboard_data
    )


def _render_buyer_list_page(page_view):

    if "user_id" not in session:
        return redirect(url_for("login"))

    if session.get("role") != "buyer":
        return redirect(url_for("dashboard"))

    dashboard_data = get_buyer_dashboard_data(session["user_id"])
    dashboard_data["page_view"] = page_view
    return render_template("buyer_dashboard.html", **dashboard_data)


@app.route("/buyer/produce")
def buyer_produce_page():
    return _render_buyer_list_page("produce")


@app.route("/buyer/offers")
def buyer_offers_page():
    return _render_buyer_list_page("offers")


@app.route("/buyer/orders")
def buyer_orders_page():
    return _render_buyer_list_page("orders")


# =========================================
# ROLE-BASED DASHBOARD
# =========================================

@app.route("/dashboard")
def dashboard():

    if "user_id" not in session:
        return redirect(url_for("login"))

    role = session.get("role")

    if role not in ["farmer", "buyer", "admin"]:
        session.clear()
        return redirect(url_for("login"))

    if role == "farmer":
        return redirect(url_for("farmer_dashboard"))

    if role == "buyer":
        return redirect(url_for("buyer_dashboard"))

    csrf_token = session.get("admin_csrf_token")
    if not csrf_token:
        csrf_token = secrets.token_urlsafe(32)
        session["admin_csrf_token"] = csrf_token

    return render_template(
        "admin_dashboard.html",
        full_name=session.get("full_name", "Admin"),
        csrf_token=csrf_token,
    )


# =========================================
# FARMER DASHBOARD
# =========================================

@app.route("/farmer/dashboard")
def farmer_dashboard():

    if "user_id" not in session:
        return redirect(url_for("login"))

    if session.get("role") != "farmer":
        return redirect(url_for("dashboard"))

    market_prices, market_prices_page = _market_price_initial_page()

    return render_template(
        "farmer_dashboard.html",
        farmer_name=session.get("full_name", "Farmer"),
        market_prices=market_prices,
        market_prices_page=market_prices_page,
        page_view="dashboard",
    )


def _render_farmer_list_page(page_view):

    if "user_id" not in session:
        return redirect(url_for("login"))

    if session.get("role") != "farmer":
        return redirect(url_for("dashboard"))

    market_prices, market_prices_page = _market_price_initial_page()
    return render_template(
        "farmer_dashboard.html",
        farmer_name=session.get("full_name", "Farmer"),
        market_prices=market_prices,
        market_prices_page=market_prices_page,
        page_view=page_view,
    )


@app.route("/farmer/produce")
def farmer_produce_page():
    return _render_farmer_list_page("produce")


@app.route("/farmer/offers")
def farmer_offers_page():
    return _render_farmer_list_page("offers")


@app.route("/farmer/orders")
def farmer_orders_page():
    return _render_farmer_list_page("orders")


# =========================================
# LOGOUT
# =========================================

@app.route("/logout", methods=["POST"])
def logout():

    api_style_request = (
        request.is_json
        or bool(request.headers.get("X-CSRFToken"))
        or request.headers.get("X-Requested-With") == "XMLHttpRequest"
        or request.accept_mimetypes.best == "application/json"
    )
    expected_csrf = session.get("auth_csrf_token", "")
    submitted_csrf = (
        request.headers.get("X-CSRFToken", "")
        or request.form.get("csrf_token", "")
    )
    if (
        not isinstance(expected_csrf, str)
        or not expected_csrf
        or not submitted_csrf
        or not hmac.compare_digest(expected_csrf, submitted_csrf)
    ):
        message = "Your request could not be verified. Refresh the page and try again."
        if api_style_request:
            return jsonify({"success": False, "message": message}), 403

        return (
            "<!doctype html><html lang='en'><meta charset='utf-8'>"
            "<meta name='viewport' content='width=device-width, initial-scale=1'>"
            "<title>Logout could not be verified</title>"
            "<main><h1>Logout could not be verified</h1>"
            "<p>Your request could not be verified. Please return to the platform and try again.</p>"
            f"<p><a href='{url_for('login_page')}'>Return to sign in</a></p></main></html>",
            403,
            {"Content-Type": "text/html; charset=utf-8"},
        )

    session.clear()

    if api_style_request:
        return jsonify({
            "success": True,
            "message": "Logout successful.",
            "redirect": url_for("login"),
        }), 200

    return redirect(url_for("login"))


# =========================================
# RUN APPLICATION
# =========================================

_EMAIL_OUTBOX_LIFECYCLE_KEY = "smart_farmer_email_outbox_lifecycle"
_EMAIL_OUTBOX_LIFECYCLE_LOCK = threading.Lock()


def _get_email_outbox_lifecycle(application, lifecycle_factory=None):
    factory = lifecycle_factory or EmailOutboxWorkerLifecycle
    with _EMAIL_OUTBOX_LIFECYCLE_LOCK:
        lifecycle = application.extensions.get(_EMAIL_OUTBOX_LIFECYCLE_KEY)
        if lifecycle is None or lifecycle.is_stopped:
            lifecycle = factory(application, poll_interval=5, batch_size=10)
            application.extensions[_EMAIL_OUTBOX_LIFECYCLE_KEY] = lifecycle
        return lifecycle


def run_application(application=None, *, lifecycle_factory=None):
    """Run Flask with one outbox worker thread and a graceful shutdown hook.

    The Werkzeug reloader is disabled here so a debug launch cannot create a
    second worker in its supervisor/child process pair. VS Code's launch config
    runs this module directly, which enters this lifecycle exactly once.
    """
    application = application or app
    logging.basicConfig(level=logging.INFO)
    lifecycle = _get_email_outbox_lifecycle(application, lifecycle_factory)
    try:
        lifecycle.start()
        application.run(
            debug=application.config["DEBUG"],
            use_reloader=False,
        )
    finally:
        lifecycle.stop()


if __name__ == "__main__":
    run_application(app)


