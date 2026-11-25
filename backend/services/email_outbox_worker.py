"""Standalone worker for durable transactional email notifications.

Run from the backend directory with the project interpreter:
    python -m services.email_outbox_worker
"""

from __future__ import annotations

import argparse
import json
import logging
import threading
import time
import uuid

from services.email_notifications import (
    NotificationDeliveryError,
    load_notification_recipients,
    send_transaction_notification,
)
from services.email_outbox import log_duration

logger = logging.getLogger("email_notification_worker")


class EmailOutboxWorkerLifecycle:
    """Own one non-daemon polling thread for a Flask application's lifetime.

    Shutdown signals the polling loop and joins its thread. Since the worker
    processes each claimed batch synchronously, this lets an in-flight email
    finish before Flask's main process exits.
    """

    def __init__(self, app, *, poll_interval=5, batch_size=10, worker_runner=None):
        self.app = app
        self.poll_interval = float(poll_interval)
        self.batch_size = int(batch_size)
        self.worker_runner = worker_runner or run_worker
        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._thread = None
        self._stop_requested = False

    @property
    def is_stopped(self):
        with self._lock:
            return self._stop_requested and (
                self._thread is None or not self._thread.is_alive()
            )

    @property
    def thread(self):
        with self._lock:
            return self._thread

    def start(self):
        """Start once; repeated calls while running do not create threads."""
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                logger.info("email_outbox_worker lifecycle=duplicate_start_skipped")
                return False
            if self._stop_requested:
                logger.info("email_outbox_worker lifecycle=start_skipped_after_stop")
                return False

            self._stop_event = threading.Event()
            self._thread = threading.Thread(
                target=self._run,
                name="smart-farmer-email-outbox-worker",
                daemon=False,
            )
            try:
                self._thread.start()
            except Exception:
                self._thread = None
                raise

        logger.info(
            "email_outbox_worker lifecycle=started poll_interval=%s batch_size=%s",
            self.poll_interval,
            self.batch_size,
        )
        return True

    def _run(self):
        try:
            self.worker_runner(
                app=self.app,
                poll_interval=self.poll_interval,
                batch_size=self.batch_size,
                stop_event=self._stop_event,
            )
        except Exception:
            # Avoid logging connector details or other potentially sensitive
            # exception strings from a background thread.
            logger.error("email_outbox_worker lifecycle=thread_failed")

    def stop(self):
        """Request shutdown and wait for any current batch to finish."""
        with self._lock:
            thread = self._thread
            if thread is None:
                self._stop_requested = True
                return False
            should_log = not self._stop_requested
            self._stop_requested = True
            self._stop_event.set()

        if should_log:
            logger.info("email_outbox_worker lifecycle=stopping")
        if thread is threading.current_thread():
            return False

        thread.join()
        if should_log:
            logger.info("email_outbox_worker lifecycle=stopped")
        return True


def _connection_factory(connection_factory):
    if connection_factory is not None:
        return connection_factory
    from db import get_db_connection
    return get_db_connection


def _claim_batch(connection_factory, batch_size, lease_seconds):
    started_at = time.perf_counter()
    connection = None
    cursor = None
    worker_id = str(uuid.uuid4())
    try:
        connection = connection_factory()
        connection.start_transaction()
        cursor = connection.cursor(dictionary=True)
        cursor.execute(
            """
            UPDATE email_notification_outbox
            SET status = 'pending',
                locked_at = NULL,
                locked_by = NULL,
                available_at = UTC_TIMESTAMP(),
                updated_at = UTC_TIMESTAMP()
            WHERE status = 'processing'
              AND locked_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL %s SECOND)
            """,
            (int(lease_seconds),),
        )
        cursor.execute(
            """
            SELECT
                outbox_id,
                idempotency_key,
                event_name,
                recipient_user_id,
                other_party_user_id,
                payload_json,
                attempt_count
            FROM email_notification_outbox
            WHERE status = 'pending'
              AND available_at <= UTC_TIMESTAMP()
            ORDER BY outbox_id ASC
            LIMIT %s
            FOR UPDATE SKIP LOCKED
            """,
            (int(batch_size),),
        )
        rows = cursor.fetchall()
        for row in rows:
            cursor.execute(
                """
                UPDATE email_notification_outbox
                SET status = 'processing',
                    attempt_count = attempt_count + 1,
                    locked_at = UTC_TIMESTAMP(),
                    locked_by = %s,
                    updated_at = UTC_TIMESTAMP()
                WHERE outbox_id = %s
                  AND status = 'pending'
                """,
                (worker_id, row["outbox_id"]),
            )
            row["attempt_count"] = int(row.get("attempt_count") or 0) + 1
            row["locked_by"] = worker_id
        connection.commit()
        return rows
    except Exception:
        if connection:
            connection.rollback()
        raise
    finally:
        if cursor:
            cursor.close()
        if connection:
            connection.close()
        log_duration("worker_claim", "database", started_at)


def _load_event_recipients(connection_factory, row):
    started_at = time.perf_counter()
    connection = None
    cursor = None
    event = str(row.get("event_name") or "unknown")
    try:
        connection = connection_factory()
        cursor = connection.cursor(dictionary=True)
        ids = [row.get("recipient_user_id"), row.get("other_party_user_id")]
        recipients = load_notification_recipients(cursor, ids)
        recipient_id = int(row["recipient_user_id"])
        recipient = recipients.get(recipient_id)
        if not recipient:
            raise NotificationDeliveryError("recipient_missing", retryable=False)
        other_id = row.get("other_party_user_id")
        details = _decode_payload(row.get("payload_json"))
        if other_id is not None:
            other = recipients.get(int(other_id))
            details["other_party"] = (other or {}).get("full_name")
        details["_idempotency_key"] = row.get("idempotency_key")
        return recipient, details
    except NotificationDeliveryError:
        raise
    except (TypeError, ValueError, json.JSONDecodeError):
        raise NotificationDeliveryError("invalid_payload", retryable=False) from None
    except Exception:
        raise NotificationDeliveryError("recipient_lookup_failed", retryable=True) from None
    finally:
        if cursor:
            cursor.close()
        if connection:
            connection.close()
        log_duration(event, "recipient_lookup", started_at)


def _decode_payload(payload):
    if isinstance(payload, dict):
        decoded = payload
    elif isinstance(payload, (str, bytes, bytearray)):
        decoded = json.loads(payload)
    else:
        raise ValueError("Invalid outbox payload")
    details = decoded.get("details")
    if not isinstance(details, dict):
        raise ValueError("Invalid outbox details")
    return details


def _finish_delivery(connection_factory, row, *, delivered, retryable=False, max_attempts=8, retry_base_seconds=30):
    event = str(row.get("event_name") or "unknown")
    started_at = time.perf_counter()
    connection = None
    cursor = None
    attempt_count = int(row.get("attempt_count") or 1)
    if delivered:
        status = "delivered"
        error_code = None
        available_sql = "available_at"
        retry_parameters = ()
    elif retryable and attempt_count < int(max_attempts):
        status = "pending"
        error_code = "temporary_delivery_failure"
        delay_seconds = min(
            int(retry_base_seconds) * (2 ** max(0, attempt_count - 1)),
            21600,
        )
        available_sql = "DATE_ADD(UTC_TIMESTAMP(), INTERVAL %s SECOND)"
        retry_parameters = (delay_seconds,)
    else:
        status = "failed"
        error_code = "delivery_failed"
        available_sql = "available_at"
        retry_parameters = ()
    try:
        connection = connection_factory()
        cursor = connection.cursor()
        cursor.execute(
            f"""
            UPDATE email_notification_outbox
            SET status = %s,
                delivered_at = {"UTC_TIMESTAMP()" if delivered else "NULL"},
                available_at = {available_sql if not delivered and status == "pending" else "available_at"},
                locked_at = NULL,
                locked_by = NULL,
                last_error_code = %s,
                updated_at = UTC_TIMESTAMP()
            WHERE outbox_id = %s
              AND status = 'processing'
              AND locked_by = %s
            """,
            (status, *retry_parameters, error_code, row["outbox_id"], row["locked_by"]),
        )
        connection.commit()
    except Exception:
        if connection:
            connection.rollback()
        raise
    finally:
        if cursor:
            cursor.close()
        if connection:
            connection.close()
        log_duration(event, "delivery_state_update", started_at)


def process_pending_batch(
    *,
    connection_factory=None,
    sender=None,
    app=None,
    batch_size=10,
    lease_seconds=900,
    max_attempts=8,
    retry_base_seconds=30,
):
    """Claim and deliver one batch. All database access is injectable for tests."""
    connection_factory = _connection_factory(connection_factory)
    sender = sender or send_transaction_notification
    rows = _claim_batch(connection_factory, batch_size, lease_seconds)
    for row in rows:
        event = str(row.get("event_name") or "unknown")
        delivery_started = time.perf_counter()
        try:
            recipient, details = _load_event_recipients(connection_factory, row)
            if app is None:
                sender(event, recipient, details)
            else:
                with app.app_context():
                    sender(event, recipient, details)
        except NotificationDeliveryError as exc:
            _finish_delivery(
                connection_factory,
                row,
                delivered=False,
                retryable=exc.retryable,
                max_attempts=max_attempts,
                retry_base_seconds=retry_base_seconds,
            )
        except Exception:
            _finish_delivery(
                connection_factory,
                row,
                delivered=False,
                retryable=True,
                max_attempts=max_attempts,
                retry_base_seconds=retry_base_seconds,
            )
        else:
            _finish_delivery(connection_factory, row, delivered=True)
        finally:
            log_duration(event, "worker_delivery", delivery_started)
    return len(rows)


def run_worker(*, app, poll_interval=5, batch_size=10, stop_event=None):
    """Poll forever; pending and expired-lease rows survive process restarts."""
    stop_event = stop_event or threading.Event()
    while not stop_event.is_set():
        poll_started = time.perf_counter()
        try:
            processed = process_pending_batch(
                app=app,
                batch_size=batch_size,
            )
        except Exception:
            # Do not print exception text: driver errors may contain connection
            # metadata. Timing logs remain safe and useful.
            log_duration("worker_poll", "failed", poll_started)
            processed = 0
        if not processed:
            stop_event.wait(max(0.1, float(poll_interval)))


def main():
    parser = argparse.ArgumentParser(description="Smart Farmer email outbox worker")
    parser.add_argument("--poll-interval", type=float, default=5.0)
    parser.add_argument("--batch-size", type=int, default=10)
    parser.add_argument("--once", action="store_true", help="Process one batch and exit")
    args = parser.parse_args()

    from app import app

    logging.basicConfig(level=logging.INFO)
    if args.once:
        process_pending_batch(app=app, batch_size=args.batch_size)
        return
    run_worker(app=app, poll_interval=args.poll_interval, batch_size=args.batch_size)


if __name__ == "__main__":
    main()
