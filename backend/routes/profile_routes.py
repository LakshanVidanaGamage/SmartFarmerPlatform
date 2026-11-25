import logging
import hmac
import re
import secrets

from flask import Blueprint, redirect, render_template, request, session, url_for

from db import get_db_connection


profile_bp = Blueprint("profile", __name__)
logger = logging.getLogger(__name__)

ALLOWED_ROLES = {"farmer", "buyer", "admin"}
PHONE_PATTERN = re.compile(r"[0-9+\-\s]{7,20}")


def _render_profile(profile, error=None, status=200, saved=False, csrf_token=None):
    return render_template(
        "profile.html",
        profile=profile,
        error=error,
        saved=saved,
        csrf_token=csrf_token,
    ), status


@profile_bp.route("/profile", methods=["GET", "POST"])
def profile_page():
    if "user_id" not in session:
        return redirect(url_for("login_page"))

    role = session.get("role")
    if role not in ALLOWED_ROLES:
        session.clear()
        return redirect(url_for("login_page"))

    csrf_token = session.get("profile_csrf_token")
    if not csrf_token:
        csrf_token = secrets.token_urlsafe(32)
        session["profile_csrf_token"] = csrf_token

    connection = None
    cursor = None

    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)
        if request.method == "POST":
            connection.start_transaction()
            cursor.execute(
                """
                SELECT first_name, last_name, full_name, email, phone, role
                FROM users
                WHERE user_id = %s
                FOR UPDATE
                """,
                (session["user_id"],),
            )
            profile = cursor.fetchone()
            if not profile or profile.get("role") not in ALLOWED_ROLES:
                connection.rollback()
                session.clear()
                return redirect(url_for("login_page"))
            role = profile["role"]
            session["role"] = role
        else:
            cursor.execute(
                """
                SELECT first_name, last_name, full_name, email, phone, role
                FROM users
                WHERE user_id = %s AND role = %s
                """,
                (session["user_id"], role),
            )
            profile = cursor.fetchone()

        if not profile:
            session.clear()
            return redirect(url_for("login_page"))

        if request.method == "POST":
            submitted_token = request.form.get("csrf_token", "")
            if not isinstance(submitted_token, str) or not hmac.compare_digest(
                csrf_token,
                submitted_token,
            ):
                return _render_profile(
                    profile,
                    "Your form session expired. Please review your profile and try again.",
                    400,
                    csrf_token=csrf_token,
                )

            first_name = request.form.get("first_name", "").strip()
            last_name = request.form.get("last_name", "").strip()
            phone = request.form.get("phone", "").strip()

            if not first_name or not last_name:
                profile.update(
                    first_name=first_name,
                    last_name=last_name,
                    phone=phone,
                )
                return _render_profile(
                    profile,
                    "Enter both your first and last name.",
                    400,
                    csrf_token=csrf_token,
                )

            if len(first_name) > 50 or len(last_name) > 100:
                profile.update(
                    first_name=first_name,
                    last_name=last_name,
                    phone=phone,
                )
                return _render_profile(
                    profile,
                    "Your name is longer than the supported account fields.",
                    400,
                    csrf_token=csrf_token,
                )

            if not PHONE_PATTERN.fullmatch(phone):
                profile.update(
                    first_name=first_name,
                    last_name=last_name,
                    phone=phone,
                )
                return _render_profile(
                    profile,
                    "Enter a phone number using 7 to 20 characters (digits, spaces, +, or -).",
                    400,
                    csrf_token=csrf_token,
                )

            cursor.execute(
                "SELECT user_id FROM users WHERE phone = %s AND user_id <> %s",
                (phone, session["user_id"]),
            )
            if cursor.fetchone():
                profile.update(
                    first_name=first_name,
                    last_name=last_name,
                    phone=phone,
                )
                return _render_profile(
                    profile,
                    "That phone number is already used by another account.",
                    409,
                    csrf_token=csrf_token,
                )

            full_name = f"{first_name} {last_name}"
            cursor.execute(
                """
                UPDATE users
                SET first_name = %s,
                    last_name = %s,
                    full_name = %s,
                    phone = %s
                WHERE user_id = %s AND role = %s
                """,
                (
                    first_name,
                    last_name,
                    full_name,
                    phone,
                    session["user_id"],
                    role,
                ),
            )
            connection.commit()
            session["full_name"] = full_name
            return redirect(url_for("profile.profile_page", saved="1"))

        return _render_profile(
            profile,
            saved=request.args.get("saved") == "1",
            csrf_token=csrf_token,
        )

    except Exception:
        if connection:
            connection.rollback()
        logger.exception("Unable to load or update the signed-in profile")
        return _render_profile(
            None,
            "Your profile is temporarily unavailable. Please try again.",
            500,
            csrf_token=csrf_token,
        )

    finally:
        if cursor:
            cursor.close()
        if connection:
            connection.close()
