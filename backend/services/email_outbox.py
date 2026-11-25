"""Transactional database outbox helpers for marketplace email events."""

from __future__ import annotations

import json
import logging
import time
from datetime import date, datetime
from decimal import Decimal
from functools import wraps

logger = logging.getLogger(__name__)


def _json_safe(value):
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def log_duration(event, stage, started_at):
    """Emit only event/stage labels and elapsed time; never include payload data."""
    logger.info(
        "email_notification_timing event=%s stage=%s duration_ms=%.2f",
        event,
        stage,
        max(0.0, (time.perf_counter() - started_at) * 1000),
    )


def measure_request_duration(event):
    """Measure transaction endpoint response time without logging request data."""
    def decorate(function):
        @wraps(function)
        def wrapped(*args, **kwargs):
            started_at = time.perf_counter()
            try:
                return function(*args, **kwargs)
            finally:
                log_duration(event, "http_request", started_at)
        return wrapped
    return decorate


def enqueue_notification(
    cursor,
    *,
    event,
    idempotency_key,
    recipient_user_id,
    other_party_user_id=None,
    details,
):
    """Insert a notification in the caller's open business transaction.

    A unique idempotency key prevents the same business event/recipient pair from
    being queued twice. Any insert error propagates so the caller rolls back both
    the business update and the outbox event.
    """
    started_at = time.perf_counter()
    payload_json = json.dumps(
        {"details": _json_safe(details)},
        ensure_ascii=False,
        separators=(",", ":"),
    )
    try:
        cursor.execute(
            """
            INSERT INTO email_notification_outbox (
                idempotency_key,
                event_name,
                recipient_user_id,
                other_party_user_id,
                payload_json,
                status,
                attempt_count,
                available_at
            )
            VALUES (%s, %s, %s, %s, %s, 'pending', 0, UTC_TIMESTAMP())
            ON DUPLICATE KEY UPDATE
                outbox_id = LAST_INSERT_ID(outbox_id)
            """,
            (
                str(idempotency_key),
                str(event),
                int(recipient_user_id),
                int(other_party_user_id) if other_party_user_id is not None else None,
                payload_json,
            ),
        )
    finally:
        log_duration(event, "outbox_insert", started_at)
