"""Post-commit transactional email notifications for marketplace events."""

import hashlib
import logging
import smtplib
from decimal import Decimal, InvalidOperation
from email.message import EmailMessage

from flask import current_app, render_template

from config import Config


logger = logging.getLogger(__name__)


def _decimal_and_suffix(value, allow_currency=False):
    if value is None:
        return None, ""

    raw = str(value).strip()
    if not raw:
        return None, ""
    if allow_currency:
        while raw.lower().startswith("rs."):
            raw = raw[3:].strip()

    parts = raw.split(None, 1)
    try:
        number = Decimal(parts[0].replace(",", ""))
    except (InvalidOperation, ValueError):
        return None, ""
    if not number.is_finite():
        return None, ""
    return number, parts[1].strip() if len(parts) == 2 else ""


def format_quantity(value, unit=None):
    """Format a quantity in fixed-point notation and preserve its unit."""
    quantity, embedded_unit = _decimal_and_suffix(value)
    if quantity is None:
        return None
    formatted = format(quantity, ",f")
    if "." in formatted:
        formatted = formatted.rstrip("0").rstrip(".")
    actual_unit = str(unit).strip() if unit is not None else embedded_unit
    return f"{formatted} {actual_unit}" if actual_unit else formatted


def format_currency(value, unit=None):
    """Format an amount as Sri Lankan rupees with exactly two decimals."""
    amount, embedded_unit = _decimal_and_suffix(value, allow_currency=True)
    if amount is None:
        return None
    formatted = f"Rs. {format(amount, ',.2f')}"
    actual_unit = str(unit).strip() if unit is not None else ""
    if not actual_unit and embedded_unit.startswith("/"):
        actual_unit = embedded_unit[1:].strip()
    return f"{formatted} / {actual_unit}" if actual_unit else formatted


def unit_price_from_total(total, quantity):
    """Derive a display-only unit price from an order's stored total/quantity."""
    total_value, _ = _decimal_and_suffix(total, allow_currency=True)
    quantity_value, _ = _decimal_and_suffix(quantity)
    if total_value is None or quantity_value is None or quantity_value == 0:
        return None
    try:
        result = total_value / quantity_value
    except (ArithmeticError, InvalidOperation):
        return None
    return result if result.is_finite() else None


_COPY = {
    "en": {
        "brand": "Smart Farmer",
        "greeting": "Hello {name},",
        "events": {
            "offer_created": ("New offer received", "A buyer sent you an offer for your produce."),
            "offer_accepted": ("Your offer was accepted", "The farmer accepted your offer."),
            "order_created": ("A new order was created", "An order was created from an accepted offer."),
            "order_confirmed": ("Your order was confirmed", "The farmer confirmed your order."),
            "order_completed": ("Order completed", "Your order has been marked as completed."),
        },
        "labels": {
            "offer_id": "Offer ID", "order_id": "Order ID", "produce": "Produce",
            "quantity": "Quantity", "unit_price": "Unit price", "offered_price": "Unit price",
            "total": "Total price", "other_party": "Other party", "date": "Date",
        },
        "footer": "This is an automated Smart Farmer marketplace notification.",
    },
    "si": {
        "brand": "Smart Farmer",
        "greeting": "ආයුබෝවන් {name},",
        "events": {
            "offer_created": ("නව ඉල්ලීමක් ලැබී ඇත", "ඔබේ නිෂ්පාදනය සඳහා ගැනුම්කරුවෙකු මිල ඉල්ලීමක් එවා ඇත."),
            "offer_accepted": ("ඔබගේ ඉල්ලීම පිළිගෙන ඇත", "ගොවියා ඔබගේ මිල ඉල්ලීම පිළිගෙන ඇත."),
            "order_created": ("නව ඇණවුමක් සාදා ඇත", "පිළිගත් මිල ඉල්ලීමකින් ඇණවුමක් සාදා ඇත."),
            "order_confirmed": ("ඔබගේ ඇණවුම තහවුරු කර ඇත", "ගොවියා ඔබගේ ඇණවුම තහවුරු කර ඇත."),
            "order_completed": ("ඇණවුම සම්පූර්ණයි", "ඔබගේ ඇණවුම සම්පූර්ණ කළ බව සලකුණු කර ඇත."),
        },
        "labels": {
            "offer_id": "ඉල්ලීම් අංකය", "order_id": "ඇණවුම් අංකය", "produce": "නිෂ්පාදනය",
            "quantity": "ප්‍රමාණය", "unit_price": "ඒකක මිල", "offered_price": "ඒකක මිල",
            "total": "මුළු මිල", "other_party": "අනෙක් පාර්ශ්වය", "date": "දිනය",
        },
        "footer": "මෙය Smart Farmer වෙළඳපොළෙන් ස්වයංක්‍රීයව එවන ලද දැනුම්දීමකි.",
    },
    "ta": {
        "brand": "Smart Farmer",
        "greeting": "வணக்கம் {name},",
        "events": {
            "offer_created": ("புதிய சலுகை வந்துள்ளது", "உங்கள் விளைபொருளுக்கு வாங்குபவர் ஒருவர் சலுகை அனுப்பியுள்ளார்."),
            "offer_accepted": ("உங்கள் சலுகை ஏற்கப்பட்டது", "விவசாயி உங்கள் சலுகையை ஏற்றுக்கொண்டார்."),
            "order_created": ("புதிய ஆர்டர் உருவாக்கப்பட்டது", "ஏற்றுக்கொள்ளப்பட்ட சலுகையிலிருந்து ஆர்டர் உருவாக்கப்பட்டது."),
            "order_confirmed": ("உங்கள் ஆர்டர் உறுதிப்படுத்தப்பட்டது", "விவசாயி உங்கள் ஆர்டரை உறுதிப்படுத்தினார்."),
            "order_completed": ("ஆர்டர் நிறைவடைந்தது", "உங்கள் ஆர்டர் நிறைவடைந்ததாகக் குறிக்கப்பட்டுள்ளது."),
        },
        "labels": {
            "offer_id": "சலுகை எண்", "order_id": "ஆர்டர் எண்", "produce": "விளைபொருள்",
            "quantity": "அளவு", "unit_price": "அலகு விலை", "offered_price": "அலகு விலை",
            "total": "மொத்த விலை", "other_party": "மற்றவர்", "date": "தேதி",
        },
        "footer": "இது Smart Farmer சந்தையின் தானியங்கி அறிவிப்பு.",
    },
}


def load_notification_recipients(cursor, user_ids):
    """Load only the contact fields needed for event recipients."""
    unique_ids = list(dict.fromkeys(int(user_id) for user_id in user_ids if user_id))
    if not unique_ids:
        return {}

    placeholders = ", ".join(["%s"] * len(unique_ids))
    cursor.execute(
        "SELECT user_id, full_name, email FROM users WHERE user_id IN ("
        + placeholders
        + ")",
        tuple(unique_ids),
    )
    return {int(row["user_id"]): row for row in cursor.fetchall()}


class NotificationDeliveryError(Exception):
    """Safe delivery failure code with retry classification."""

    def __init__(self, error_code, *, retryable):
        super().__init__(str(error_code))
        self.error_code = str(error_code)
        self.retryable = bool(retryable)


def send_transaction_notification(event, recipient, details):
    """Render and send one email; errors are classified for outbox retry logic."""
    import time
    from services.email_outbox import log_duration

    smtp_started = None
    try:
        if not (
            isinstance(recipient, dict)
            and isinstance(recipient.get("email"), str)
            and recipient.get("email").strip()
        ):
            raise NotificationDeliveryError("recipient_missing", retryable=False)

        language = str(
            recipient.get("language") or recipient.get("preferred_language") or "en"
        ).strip().lower()
        copy = _COPY.get(language, _COPY["en"])
        event_copy = copy["events"].get(event)
        if not event_copy:
            raise NotificationDeliveryError("unsupported_event", retryable=False)

        if not Config.MAIL_USERNAME or not Config.MAIL_PASSWORD:
            raise NotificationDeliveryError("smtp_configuration_missing", retryable=True)

        subject, summary = event_copy
        name = str(recipient.get("full_name") or "Smart Farmer member")
        translated_details = []
        for key, value in details.items():
            if key in {"unit", "_idempotency_key"}:
                continue
            if key == "quantity":
                display_value = format_quantity(value, details.get("unit"))
            elif key in {"unit_price", "offered_price"}:
                display_value = format_currency(value, details.get("unit"))
            elif key == "total":
                display_value = format_currency(value)
            else:
                display_value = str(value) if value is not None else None
            if display_value is None or not str(display_value).strip():
                continue
            translated_details.append({
                "label": copy["labels"].get(key, key.replace("_", " ").title()),
                "value": display_value,
            })
        greeting = copy["greeting"].format(name=name)

        with current_app.app_context():
            html_body = render_template(
                "emails/transaction_notification.html",
                brand=copy["brand"],
                title=subject,
                summary=summary,
                greeting=greeting,
                details=translated_details,
                footer=copy["footer"],
                language=language if language in _COPY else "en",
            )

        text_lines = [copy["brand"], "", greeting, summary, ""]
        text_lines.extend(f"{item['label']}: {item['value']}" for item in translated_details)
        text_lines.extend(["", copy["footer"]])

        message = EmailMessage()
        message["Subject"] = f"{copy['brand']} - {subject}"
        message["From"] = Config.MAIL_DEFAULT_SENDER or Config.MAIL_USERNAME
        message["To"] = recipient["email"]
        idempotency_key = details.get("_idempotency_key")
        if idempotency_key:
            message_hash = hashlib.sha256(str(idempotency_key).encode("utf-8")).hexdigest()
            message["Message-ID"] = f"<{message_hash}@smartfarmer.local>"
        message.set_content("\n".join(text_lines))
        message.add_alternative(html_body, subtype="html")

        smtp_started = time.perf_counter()
        try:
            with smtplib.SMTP(Config.MAIL_SERVER, Config.MAIL_PORT, timeout=30) as server:
                if Config.MAIL_USE_TLS:
                    server.ehlo()
                    server.starttls()
                    server.ehlo()
                server.login(Config.MAIL_USERNAME, Config.MAIL_PASSWORD)
                server.send_message(message)
        except smtplib.SMTPAuthenticationError:
            raise NotificationDeliveryError("smtp_authentication_failed", retryable=False) from None
        except smtplib.SMTPResponseException as exc:
            temporary = 400 <= int(getattr(exc, "smtp_code", 0) or 0) < 500
            code = "smtp_temporary_response" if temporary else "smtp_permanent_response"
            raise NotificationDeliveryError(code, retryable=temporary) from None
        except (smtplib.SMTPException, OSError, TimeoutError):
            raise NotificationDeliveryError("smtp_transport_failure", retryable=True) from None
        finally:
            log_duration(event, "smtp_delivery", smtp_started)
        return True
    except NotificationDeliveryError:
        raise
    except Exception:
        # Do not expose message content, addresses, driver details, or credentials.
        raise NotificationDeliveryError("notification_processing_failure", retryable=False) from None


def notify_transaction(event, recipient, details):
    """Compatibility wrapper for direct callers; route handlers use the outbox."""
    try:
        return send_transaction_notification(event, recipient, details)
    except NotificationDeliveryError:
        return False
