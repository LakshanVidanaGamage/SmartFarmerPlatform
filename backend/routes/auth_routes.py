import re
import hmac
import secrets

from flask import Blueprint, request, jsonify, session, current_app


from auth import (
    create_pending_registration,
    verify_registration_otp,
    resend_registration_otp,
    check_registration_availability,
    authenticate_user,

    request_password_reset_otp,
    resend_password_reset_otp,
    verify_password_reset_otp,
    reset_user_password
)

auth_bp = Blueprint(
    "auth",
    __name__,
    url_prefix="/api/auth"
)


@auth_bp.before_request
def require_auth_csrf_token():
    if request.method != "POST" or request.endpoint == "auth.check_availability":
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


def valid_email(email):
    return bool(
        re.fullmatch(
            r"[^@\s]+@[^@\s]+\.[^@\s]+",
            email
        )
    )


@auth_bp.route("/check-availability", methods=["POST"])
def check_availability():
    data = request.get_json(silent=True) or {}

    email = data.get("email", "")
    phone = data.get("phone", "")

    if not isinstance(email, str) or not isinstance(phone, str):
        return jsonify({
            "success": False,
            "message": "Invalid input."
        }), 400

    email = email.strip().lower()
    phone = phone.strip()

    if email and not valid_email(email):
        return jsonify({
            "success": False,
            "message": "Please enter a valid email address."
        }), 400

    if phone and not re.fullmatch(r"[0-9+\-\s]{7,20}", phone):
        return jsonify({
            "success": False,
            "message": "Please enter a valid phone number."
        }), 400

    try:
        result = check_registration_availability(
            email or None,
            phone or None
        )

        return jsonify({
            "success": True,
            **result
        }), 200

    except Exception:
        return jsonify({
            "success": False,
            "message": "Unable to check details right now."
        }), 500


@auth_bp.route("/register", methods=["POST"])
def register():
    data = request.get_json(silent=True) or {}

    first_name = data.get("first_name")
    last_name = data.get("last_name")
    email = data.get("email")
    phone = data.get("phone")
    password = data.get("password")
    confirm_password = data.get("confirm_password")
    role = data.get("role")

    fields = [
        first_name,
        last_name,
        email,
        phone,
        password,
        confirm_password,
        role
    ]

    if not all(isinstance(value, str) for value in fields):
        return jsonify({
            "success": False,
            "message": "Please complete all required fields."
        }), 400

    first_name = first_name.strip()
    last_name = last_name.strip()
    email = email.strip().lower()
    phone = phone.strip()
    role = role.strip().lower()

    if not all([
        first_name,
        last_name,
        email,
        phone,
        password,
        confirm_password
    ]):
        return jsonify({
            "success": False,
            "message": "All fields are required."
        }), 400

    if not valid_email(email):
        return jsonify({
            "success": False,
            "message": "Please enter a valid email address."
        }), 400

    if not re.fullmatch(r"[0-9+\-\s]{7,20}", phone):
        return jsonify({
            "success": False,
            "message": "Please enter a valid phone number."
        }), 400

    if len(first_name) > 50 or len(last_name) > 100:
        return jsonify({
            "success": False,
            "message": "Name is too long."
        }), 400

    if role not in ["farmer", "buyer"]:
        return jsonify({
            "success": False,
            "message": "Invalid account type."
        }), 400

    if len(password) < 8:
        return jsonify({
            "success": False,
            "message": "Password must contain at least 8 characters."
        }), 400

    if password != confirm_password:
        return jsonify({
            "success": False,
            "message": "Passwords do not match."
        }), 400

    try:
        success, message = create_pending_registration(
            first_name,
            last_name,
            email,
            phone,
            password,
            role
        )

        if not success:
            return jsonify({
                "success": False,
                "message": message
            }), 409

        return jsonify({
            "success": True,
            "message": message,
            "email": email
        }), 200

    except Exception:
        current_app.logger.exception("Registration error")
        return jsonify({
            "success": False,
            "message": "Registration could not be completed. Please try again."
        }), 500


@auth_bp.route("/verify-otp", methods=["POST"])
def verify_otp():
    data = request.get_json(silent=True) or {}

    email = data.get("email")
    otp = data.get("otp")

    if not isinstance(email, str) or not isinstance(otp, str):
        return jsonify({
            "success": False,
            "message": "Email and OTP are required."
        }), 400

    email = email.strip().lower()
    otp = otp.strip()

    if not valid_email(email) or not re.fullmatch(r"[0-9]{6}", otp):
        return jsonify({
            "success": False,
            "message": "Invalid email or OTP format."
        }), 400

    try:
        success, message = verify_registration_otp(email, otp)

        if not success:
            return jsonify({
                "success": False,
                "message": message
            }), 400

        return jsonify({
            "success": True,
            "message": message,
            "redirect": "/login-page"
        }), 200

    except Exception:
        return jsonify({
            "success": False,
            "message": "OTP verification failed. Please try again."
        }), 500


@auth_bp.route("/resend-otp", methods=["POST"])
def resend_otp():
    data = request.get_json(silent=True) or {}

    email = data.get("email")

    if not isinstance(email, str):
        return jsonify({
            "success": False,
            "message": "Email is required."
        }), 400

    email = email.strip().lower()

    if not valid_email(email):
        return jsonify({
            "success": False,
            "message": "Invalid email address."
        }), 400

    try:
        success, message = resend_registration_otp(email)

        if not success:
            return jsonify({
                "success": False,
                "message": message
            }), 400

        return jsonify({
            "success": True,
            "message": message
        }), 200

    except Exception:
        current_app.logger.exception("Resend OTP error")

        return jsonify({
            "success": False,
            "message": "Unable to send OTP. Please try again."
        }), 500


# =========================================
# FORGOT PASSWORD - SEND OTP
# =========================================

@auth_bp.route("/forgot-password", methods=["POST"])
def forgot_password():

    data = request.get_json(silent=True) or {}
    email = data.get("email")

    if not isinstance(email, str):
        return jsonify({
            "success": False,
            "message": "Please enter your email address."
        }), 400

    email = email.strip().lower()

    if not valid_email(email):
        return jsonify({
            "success": False,
            "message": "Please enter a valid email address."
        }), 400

    try:
        success, message = request_password_reset_otp(email)

        if not success:
            return jsonify({
                "success": False,
                "message": message
            }), 400

        return jsonify({
            "success": True,
            "message": message
        }), 200

    except Exception:
        current_app.logger.exception("Forgot password error")

        return jsonify({
            "success": False,
            "message": "Unable to process your request. Please try again."
        }), 500


# =========================================
# PASSWORD RESET - RESEND OTP
# =========================================

@auth_bp.route("/resend-reset-otp", methods=["POST"])
def resend_reset_otp():

    data = request.get_json(silent=True) or {}
    email = data.get("email")

    if not isinstance(email, str):
        return jsonify({
            "success": False,
            "message": "Email is required."
        }), 400

    email = email.strip().lower()

    if not valid_email(email):
        return jsonify({
            "success": False,
            "message": "Invalid email address."
        }), 400

    try:
        success, message = resend_password_reset_otp(email)

        if not success:
            return jsonify({
                "success": False,
                "message": message
            }), 400

        return jsonify({
            "success": True,
            "message": message
        }), 200

    except Exception:
        current_app.logger.exception("Password reset resend error")

        return jsonify({
            "success": False,
            "message": "Unable to resend verification code."
        }), 500


# =========================================
# PASSWORD RESET - VERIFY OTP
# =========================================

@auth_bp.route("/verify-reset-otp", methods=["POST"])
def verify_reset_otp():

    data = request.get_json(silent=True) or {}

    email = data.get("email")
    otp = data.get("otp")

    if not isinstance(email, str) or not isinstance(otp, str):
        return jsonify({
            "success": False,
            "message": "Email and OTP are required."
        }), 400

    email = email.strip().lower()
    otp = otp.strip()

    if not valid_email(email) or not re.fullmatch(r"[0-9]{6}", otp):
        return jsonify({
            "success": False,
            "message": "Invalid email or OTP format."
        }), 400

    try:
        success, reset_token, message = verify_password_reset_otp(
            email,
            otp
        )

        if not success:
            return jsonify({
                "success": False,
                "message": message
            }), 400

        return jsonify({
            "success": True,
            "message": message,
            "reset_token": reset_token
        }), 200

    except Exception:
        current_app.logger.exception("Password reset OTP verification error")

        return jsonify({
            "success": False,
            "message": "OTP verification failed. Please try again."
        }), 500


# =========================================
# PASSWORD RESET - SAVE NEW PASSWORD
# =========================================

@auth_bp.route("/reset-password", methods=["POST"])
def reset_password():

    data = request.get_json(silent=True) or {}

    reset_token = data.get("reset_token")
    password = data.get("password")
    confirm_password = data.get("confirm_password")

    if not all(
        isinstance(value, str)
        for value in [reset_token, password, confirm_password]
    ):
        return jsonify({
            "success": False,
            "message": "Please complete all required fields."
        }), 400

    if not reset_token or not password or not confirm_password:
        return jsonify({
            "success": False,
            "message": "All fields are required."
        }), 400

    if len(password) < 8:
        return jsonify({
            "success": False,
            "message": "Password must contain at least 8 characters."
        }), 400

    if password != confirm_password:
        return jsonify({
            "success": False,
            "message": "Passwords do not match."
        }), 400

    try:
        success, message = reset_user_password(
            reset_token,
            password
        )

        if not success:
            return jsonify({
                "success": False,
                "message": message
            }), 400

        return jsonify({
            "success": True,
            "message": message,
            "redirect": "/login-page?password_reset=1"
        }), 200

    except Exception:
        current_app.logger.exception("Password reset error")

        return jsonify({
            "success": False,
            "message": "Unable to reset password. Please try again."
        }), 500

@auth_bp.route("/login", methods=["POST"])
def login():
    data = request.get_json(silent=True) or {}

    email = data.get("email")
    password = data.get("password")

    if not isinstance(email, str) or not isinstance(password, str):
        return jsonify({
            "success": False,
            "message": "Email and password are required."
        }), 400

    email = email.strip().lower()

    if not email or not password:
        return jsonify({
            "success": False,
            "message": "Email and password are required."
        }), 400

    try:
        user = authenticate_user(email, password)

        if not user:
            return jsonify({
                "success": False,
                "message": "Invalid email or password."
            }), 401

        session.clear()
        session["user_id"] = user["user_id"]
        session["full_name"] = user["full_name"]
        session["role"] = user["role"]
        session["auth_csrf_token"] = secrets.token_urlsafe(32)

        return jsonify({
            "success": True,
            "message": "Login successful.",
            "user": user,
            "redirect": (
                "/dashboard"
                if user["role"] == "admin"
                else f"/{user['role']}/dashboard"
            )
        }), 200

    except Exception:
        return jsonify({
            "success": False,
            "message": "Login failed. Please try again."
        }), 500


@auth_bp.route("/logout", methods=["POST"])
def logout():
    # Keep the legacy API path working while centralizing session clearing in
    # the CSRF-protected application logout route.
    from flask import redirect, url_for

    return redirect(url_for("logout"), code=307)


@auth_bp.route("/me", methods=["GET"])
def current_user():
    if "user_id" not in session:
        return jsonify({
            "success": False,
            "message": "User is not logged in."
        }), 401

    return jsonify({
        "success": True,
        "user": {
            "user_id": session["user_id"],
            "full_name": session["full_name"],
            "role": session["role"]
        }
    }), 200

