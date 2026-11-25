
import hashlib
import secrets
import smtplib
import base64

from datetime import datetime
from email.message import EmailMessage

from db import get_db_connection
from config import Config
from utils.security import hash_password, verify_password


# =========================================
# OTP CONFIGURATION
# =========================================

OTP_EXPIRY_MINUTES = 5
OTP_RESEND_SECONDS = 60
MAX_OTP_ATTEMPTS = 5

RESET_TOKEN_EXPIRY_MINUTES = 10


# =========================================
# SECURITY HELPERS
# =========================================

def _hash_otp(otp):
    return hashlib.sha256(
        otp.encode("utf-8")
    ).hexdigest()


def _generate_otp():
    return f"{secrets.randbelow(1_000_000):06d}"


def _hash_reset_token(token):
    return hashlib.sha256(
        token.encode("utf-8")
    ).hexdigest()


# =========================================
# GMAIL OTP EMAIL
# =========================================

def send_otp_email(email, otp, purpose="registration"):

    message = EmailMessage()

    if purpose == "registration":
        message["Subject"] = "Smart Farmer - Email Verification"
    else:
        message["Subject"] = "Smart Farmer - Password Reset"

    message["From"] = Config.MAIL_DEFAULT_SENDER or Config.MAIL_USERNAME
    message["To"] = email

    message.set_content(
        f"""Hello,

Your Smart Farmer verification code is:

{otp}

This code expires in {OTP_EXPIRY_MINUTES} minutes.

If you did not request this code, please ignore this email.

Smart Farmer Team
"""
    )

    username = base64.b64encode(
        Config.MAIL_USERNAME.encode("utf-8")
    ).decode("ascii")

    password = base64.b64encode(
        Config.MAIL_PASSWORD.encode("utf-8")
    ).decode("ascii")

    with smtplib.SMTP(
        Config.MAIL_SERVER,
        Config.MAIL_PORT,
        timeout=30
    ) as server:

        server.ehlo()
        server.starttls()
        server.ehlo()

        code, response = server.docmd("AUTH", "LOGIN")

        if code != 334:
            raise RuntimeError("Gmail LOGIN authentication failed.")

        code, response = server.docmd(username)

        if code != 334:
            raise RuntimeError("Gmail username authentication failed.")

        code, response = server.docmd(password)

        if code != 235:
            raise RuntimeError(
                f"Gmail authentication failed with SMTP code {code}"
            )

        server.send_message(message)


# =========================================
# REGISTRATION AVAILABILITY
# =========================================

def check_registration_availability(email=None, phone=None):

    connection = get_db_connection()

    try:
        cursor = connection.cursor(dictionary=True)

        result = {
            "email_available": True,
            "phone_available": True
        }

        if email:

            cursor.execute(
                "SELECT user_id FROM users WHERE email = %s",
                (email,)
            )

            if cursor.fetchone():
                result["email_available"] = False

            else:

                cursor.execute(
                    """
                    SELECT registration_id
                    FROM pending_registrations
                    WHERE email = %s
                      AND otp_expires_at >= NOW()
                    """,
                    (email,)
                )

                if cursor.fetchone():
                    result["email_available"] = False

        if phone:

            cursor.execute(
                "SELECT user_id FROM users WHERE phone = %s",
                (phone,)
            )

            if cursor.fetchone():
                result["phone_available"] = False

            else:

                cursor.execute(
                    """
                    SELECT registration_id
                    FROM pending_registrations
                    WHERE phone = %s
                      AND otp_expires_at >= NOW()
                    """,
                    (phone,)
                )

                if cursor.fetchone():
                    result["phone_available"] = False

        return result

    finally:
        connection.close()


# =========================================
# CREATE PENDING REGISTRATION
# =========================================

def create_pending_registration(
    first_name,
    last_name,
    email,
    phone,
    password,
    role
):

    connection = get_db_connection()

    try:
        cursor = connection.cursor(dictionary=True)

        cursor.execute(
            """
            DELETE FROM pending_registrations
            WHERE otp_expires_at < NOW()
            """
        )

        cursor.execute(
            "SELECT user_id FROM users WHERE email = %s",
            (email,)
        )

        if cursor.fetchone():
            return False, "This email is already registered."

        cursor.execute(
            "SELECT user_id FROM users WHERE phone = %s",
            (phone,)
        )

        if cursor.fetchone():
            return False, "This phone number is already registered."

        cursor.execute(
            """
            SELECT registration_id
            FROM pending_registrations
            WHERE email = %s
            """,
            (email,)
        )

        if cursor.fetchone():
            return False, (
                "A verification is already pending for this email. "
                "Please verify it or wait for the OTP to expire."
            )

        cursor.execute(
            """
            SELECT registration_id
            FROM pending_registrations
            WHERE phone = %s
            """,
            (phone,)
        )

        if cursor.fetchone():
            return False, (
                "This phone number is already used in a pending registration."
            )

        otp = _generate_otp()
        password_hash = hash_password(password)

        cursor.execute(
            """
            INSERT INTO pending_registrations
            (
                first_name,
                last_name,
                email,
                phone,
                password_hash,
                role,
                otp_hash,
                otp_expires_at,
                otp_attempts,
                last_otp_sent_at
            )
            VALUES (
                %s, %s, %s, %s, %s, %s, %s,
                DATE_ADD(NOW(), INTERVAL 5 MINUTE),
                0,
                NOW()
            )
            """,
            (
                first_name,
                last_name,
                email,
                phone,
                password_hash,
                role,
                _hash_otp(otp)
            )
        )

        connection.commit()

    except Exception:
        connection.rollback()
        raise

    finally:
        connection.close()

    send_otp_email(email, otp, "registration")

    return True, "Verification code sent to your email address."


# =========================================
# VERIFY REGISTRATION OTP
# =========================================

def verify_registration_otp(email, otp):

    connection = get_db_connection()

    try:
        cursor = connection.cursor(dictionary=True)

        cursor.execute(
            """
            SELECT *
            FROM pending_registrations
            WHERE email = %s
            FOR UPDATE
            """,
            (email,)
        )

        pending = cursor.fetchone()

        if not pending:
            return False, (
                "No pending registration was found. Please register again."
            )

        if pending["otp_expires_at"] < datetime.now():

            cursor.execute(
                """
                DELETE FROM pending_registrations
                WHERE registration_id = %s
                """,
                (pending["registration_id"],)
            )

            connection.commit()

            return False, "OTP has expired. Please register again."

        if pending["otp_attempts"] >= MAX_OTP_ATTEMPTS:
            return False, (
                "Maximum OTP attempts reached. Please request a new registration."
            )

        if not secrets.compare_digest(
            pending["otp_hash"],
            _hash_otp(otp)
        ):

            cursor.execute(
                """
                UPDATE pending_registrations
                SET otp_attempts = otp_attempts + 1
                WHERE registration_id = %s
                """,
                (pending["registration_id"],)
            )

            connection.commit()

            return False, "Incorrect OTP. Please try again."

        full_name = (
            f"{pending['first_name']} {pending['last_name']}"
        ).strip()

        cursor.execute(
            """
            INSERT INTO users
            (
                first_name,
                last_name,
                full_name,
                email,
                phone,
                password_hash,
                role
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (
                pending["first_name"],
                pending["last_name"],
                full_name,
                pending["email"],
                pending["phone"],
                pending["password_hash"],
                pending["role"]
            )
        )

        cursor.execute(
            """
            DELETE FROM pending_registrations
            WHERE registration_id = %s
            """,
            (pending["registration_id"],)
        )

        connection.commit()

        return True, (
            "Email verified. Your account has been created successfully."
        )

    except Exception:
        connection.rollback()
        raise

    finally:
        connection.close()


# =========================================
# RESEND REGISTRATION OTP
# =========================================

def resend_registration_otp(email):

    connection = get_db_connection()

    try:
        cursor = connection.cursor(dictionary=True)

        cursor.execute(
            """
            SELECT registration_id, last_otp_sent_at
            FROM pending_registrations
            WHERE email = %s
            """,
            (email,)
        )

        pending = cursor.fetchone()

        if not pending:
            return False, "No pending registration was found."

        elapsed = (
            datetime.now() - pending["last_otp_sent_at"]
        ).total_seconds()

        if elapsed < OTP_RESEND_SECONDS:
            remaining = OTP_RESEND_SECONDS - int(elapsed)

            return False, (
                f"Please wait {remaining} seconds before requesting another OTP."
            )

        otp = _generate_otp()

        cursor.execute(
            """
            UPDATE pending_registrations
            SET otp_hash = %s,
                otp_expires_at = DATE_ADD(NOW(), INTERVAL 5 MINUTE),
                otp_attempts = 0,
                last_otp_sent_at = NOW()
            WHERE registration_id = %s
            """,
            (
                _hash_otp(otp),
                pending["registration_id"]
            )
        )

        connection.commit()

    except Exception:
        connection.rollback()
        raise

    finally:
        connection.close()

    send_otp_email(email, otp, "registration")

    return True, "A new verification code has been sent."


# =========================================
# PASSWORD RESET - REQUEST OTP
# =========================================

def request_password_reset_otp(email):
    """
    Request a password reset OTP.

    Always returns a generic response for unknown email addresses
    to reduce account enumeration.
    """

    connection = get_db_connection()
    otp = None

    try:
        cursor = connection.cursor(dictionary=True)

        cursor.execute(
            """
            SELECT user_id
            FROM users
            WHERE email = %s
            """,
            (email,)
        )

        user = cursor.fetchone()

        if not user:
            return True, (
                "If an account exists for this email, "
                "a verification code will be sent."
            )

        user_id = user["user_id"]

        cursor.execute(
            """
            SELECT last_otp_sent_at
            FROM password_reset_otps
            WHERE user_id = %s
            FOR UPDATE
            """,
            (user_id,)
        )

        existing = cursor.fetchone()

        if existing:

            elapsed = (
                datetime.now() - existing["last_otp_sent_at"]
            ).total_seconds()

            if elapsed < OTP_RESEND_SECONDS:
                return True, (
                    "If an account exists for this email, "
                    "a verification code will be sent."
                )

        otp = _generate_otp()

        cursor.execute(
            """
            INSERT INTO password_reset_otps
            (
                user_id,
                otp_hash,
                otp_expires_at,
                otp_attempts,
                last_otp_sent_at,
                reset_token_hash,
                reset_token_expires_at
            )
            VALUES (
                %s,
                %s,
                DATE_ADD(NOW(), INTERVAL 5 MINUTE),
                0,
                NOW(),
                NULL,
                NULL
            )
            ON DUPLICATE KEY UPDATE
                otp_hash = VALUES(otp_hash),
                otp_expires_at = DATE_ADD(NOW(), INTERVAL 5 MINUTE),
                otp_attempts = 0,
                last_otp_sent_at = NOW(),
                reset_token_hash = NULL,
                reset_token_expires_at = NULL
            """,
            (user_id, _hash_otp(otp))
        )

        connection.commit()

    except Exception:
        connection.rollback()
        raise

    finally:
        connection.close()

    try:
        send_otp_email(email, otp, "password_reset")

    except Exception:
        # Allow the user to retry immediately if email sending failed.
        retry_connection = get_db_connection()

        try:
            retry_cursor = retry_connection.cursor()

            retry_cursor.execute(
                """
                UPDATE password_reset_otps
                SET last_otp_sent_at = DATE_SUB(
                    NOW(),
                    INTERVAL 60 SECOND
                )
                WHERE user_id = %s
                """,
                (user_id,)
            )

            retry_connection.commit()

        finally:
            retry_connection.close()

        raise

    return True, (
        "If an account exists for this email, "
        "a verification code will be sent."
    )


# =========================================
# PASSWORD RESET - RESEND OTP
# =========================================

def resend_password_reset_otp(email):
    """
    Resend a password reset OTP.

    Uses the same cooldown and generic response.
    """

    return request_password_reset_otp(email)


# =========================================
# PASSWORD RESET - VERIFY OTP
# =========================================

def verify_password_reset_otp(email, otp):

    connection = get_db_connection()

    try:
        cursor = connection.cursor(dictionary=True)

        cursor.execute(
            """
            SELECT
                u.user_id,
                r.reset_id,
                r.otp_hash,
                r.otp_expires_at,
                r.otp_attempts
            FROM users AS u
            JOIN password_reset_otps AS r
                ON u.user_id = r.user_id
            WHERE u.email = %s
            FOR UPDATE
            """,
            (email,)
        )

        record = cursor.fetchone()

        if not record:
            return False, None, "Invalid or expired verification code."

        if record["otp_expires_at"] < datetime.now():
            cursor.execute(
                """
                DELETE FROM password_reset_otps
                WHERE reset_id = %s
                """,
                (record["reset_id"],)
            )

            connection.commit()

            return False, None, "OTP has expired. Please request a new one."

        if record["otp_attempts"] >= MAX_OTP_ATTEMPTS:
            return False, None, (
                "Maximum OTP attempts reached. Please request a new code."
            )

        if not secrets.compare_digest(
            record["otp_hash"],
            _hash_otp(otp)
        ):

            cursor.execute(
                """
                UPDATE password_reset_otps
                SET otp_attempts = otp_attempts + 1
                WHERE reset_id = %s
                """,
                (record["reset_id"],)
            )

            connection.commit()

            return False, None, "Incorrect OTP. Please try again."

        reset_token = secrets.token_urlsafe(32)

        cursor.execute(
            """
            UPDATE password_reset_otps
            SET reset_token_hash = %s,
                reset_token_expires_at =
                    DATE_ADD(NOW(), INTERVAL 10 MINUTE),
                otp_expires_at = NOW()
            WHERE reset_id = %s
            """,
            (
                _hash_reset_token(reset_token),
                record["reset_id"]
            )
        )

        connection.commit()

        return True, reset_token, "OTP verified successfully."

    except Exception:
        connection.rollback()
        raise

    finally:
        connection.close()


# =========================================
# PASSWORD RESET - SAVE NEW PASSWORD
# =========================================

def reset_user_password(reset_token, new_password):

    connection = get_db_connection()

    try:
        cursor = connection.cursor(dictionary=True)

        token_hash = _hash_reset_token(reset_token)

        cursor.execute(
            """
            SELECT reset_id, user_id
            FROM password_reset_otps
            WHERE reset_token_hash = %s
              AND reset_token_expires_at > NOW()
            FOR UPDATE
            """,
            (token_hash,)
        )

        record = cursor.fetchone()

        if not record:
            return False, (
                "Invalid or expired password reset session. "
                "Please verify your email again."
            )

        new_password_hash = hash_password(new_password)

        cursor.execute(
            """
            UPDATE users
            SET password_hash = %s
            WHERE user_id = %s
            """,
            (
                new_password_hash,
                record["user_id"]
            )
        )

        # Delete the reset token so it cannot be reused.
        cursor.execute(
            """
            DELETE FROM password_reset_otps
            WHERE reset_id = %s
            """,
            (record["reset_id"],)
        )

        connection.commit()

        return True, "Your password has been reset successfully."

    except Exception:
        connection.rollback()
        raise

    finally:
        connection.close()


# =========================================
# LOGIN AUTHENTICATION
# =========================================

def authenticate_user(email, password):

    connection = get_db_connection()

    try:
        cursor = connection.cursor(dictionary=True)

        cursor.execute(
            """
            SELECT
                user_id,
                first_name,
                last_name,
                full_name,
                email,
                phone,
                password_hash,
                role
            FROM users
            WHERE email = %s
            """,
            (email,)
        )

        user = cursor.fetchone()

        if user and verify_password(
            password,
            user["password_hash"]
        ):

            user.pop("password_hash", None)
            return user

        return None

    finally:
        connection.close()


# =========================================
# LEGACY REGISTRATION BLOCK
# =========================================

def register_user(full_name, email, phone, password, role):

    return False, (
        "Please register through the email verification process."
    )
