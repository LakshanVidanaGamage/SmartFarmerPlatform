"""Synthetic route and SMTP tests; never open .env or contact MySQL/SMTP."""

from __future__ import annotations

import copy
import json
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


PROJECT_ROOT = Path(__file__).resolve().parents[1]
os.environ["PYTHON_DOTENV_DISABLED"] = "1"
os.environ["SECRET_KEY"] = "synthetic-email-test-secret"
os.environ["DB_HOST"] = "127.0.0.1"
os.environ["DB_PORT"] = "1"
os.environ["DB_USER"] = "synthetic-only"
os.environ["DB_PASSWORD"] = ""
os.environ["DB_NAME"] = "synthetic_only"
os.environ["MAIL_USERNAME"] = ""
os.environ["MAIL_PASSWORD"] = ""
os.environ["MAIL_DEFAULT_SENDER"] = ""
sys.path.insert(0, str(PROJECT_ROOT / "backend"))

from flask import Flask  # noqa: E402
from config import Config  # noqa: E402
import auth as auth_helpers  # noqa: E402
from routes import offer_routes, order_routes  # noqa: E402
from services import email_notifications, email_outbox, email_outbox_worker  # noqa: E402


class SyntheticStore:
    def __init__(self):
        self.users = {
            11: {"user_id": 11, "full_name": "Synthetic Farmer", "email": "farmer@example.test"},
            22: {"user_id": 22, "full_name": "Synthetic Buyer", "email": "buyer@example.test"},
        }
        self.produce = {
            101: {"produce_id": 101, "farmer_id": 11, "produce_name": "Tomato", "quantity": 20.0, "unit": "kg", "available": 1},
        }
        self.offers = {
            201: {"offer_id": 201, "produce_id": 101, "buyer_id": 22, "farmer_id": 11, "offered_price": 250.0, "quantity": 3.0, "status": "pending"},
        }
        self.orders = {
            301: {"order_id": 301, "produce_id": 101, "buyer_id": 22, "farmer_id": 11, "quantity": 2.0, "total_amount": 500.0, "status": "pending"},
        }
        self.next_offer = 202
        self.next_order = 302
        self.outbox = []
        self.next_outbox = 1
        self.commits = 0
        self.fail_on = None

    def connect(self):
        return SyntheticConnection(self)


class SyntheticConnection:
    def __init__(self, store):
        self.store = store
        self.snapshot = copy.deepcopy((store.produce, store.offers, store.orders, store.outbox))
        self.committed = False

    def cursor(self, dictionary=True, **kwargs):
        return SyntheticCursor(self.store)

    def start_transaction(self):
        self.snapshot = copy.deepcopy((self.store.produce, self.store.offers, self.store.orders, self.store.outbox))

    def commit(self):
        if self.store.fail_on == "commit":
            raise RuntimeError("synthetic commit failure")
        self.committed = True
        self.store.commits += 1

    def rollback(self):
        self.store.produce, self.store.offers, self.store.orders, self.store.outbox = copy.deepcopy(self.snapshot)

    def close(self):
        pass


class SyntheticCursor:
    def __init__(self, store):
        self.store = store
        self.one = None
        self.rows = []
        self.lastrowid = None

    def execute(self, query, params=None):
        sql = " ".join(str(query).lower().split())
        values = tuple(params or ())
        self.one = None
        self.rows = []
        self.lastrowid = None
        if self.store.fail_on == "execute":
            raise RuntimeError("synthetic database failure")

        if sql.startswith("select produce_id, farmer_id, produce_name, quantity, unit from produce"):
            row = self.store.produce.get(int(values[0]))
            self.one = copy.deepcopy(row) if row and row["available"] else None
        elif sql.startswith("select user_id, full_name, email from users where user_id in"):
            self.rows = [copy.deepcopy(self.store.users[user_id]) for user_id in values if user_id in self.store.users]
        elif sql.startswith("insert into offers"):
            if self.store.fail_on == "insert_offer":
                raise RuntimeError("synthetic offer insert failure")
            new_id = self.store.next_offer
            self.store.next_offer += 1
            self.store.offers[new_id] = {
                "offer_id": new_id, "produce_id": int(values[0]), "buyer_id": int(values[1]),
                "farmer_id": int(values[2]), "offered_price": float(values[3]),
                "quantity": float(values[4]), "status": "pending",
            }
            self.lastrowid = new_id
        elif "from offers where offer_id = %s" in sql and "for update" in sql:
            row = self.store.offers.get(int(values[0]))
            self.one = copy.deepcopy(row) if row and row["farmer_id"] == int(values[1]) else None
        elif sql.startswith("select produce_id, produce_name, quantity, available, unit from produce"):
            row = self.store.produce.get(int(values[0]))
            self.one = copy.deepcopy(row) if row and row["farmer_id"] == int(values[1]) else None
        elif sql.startswith("update produce set quantity = %s, available = %s"):
            row = self.store.produce[int(values[2])]
            row["quantity"], row["available"] = float(values[0]), int(values[1])
        elif sql.startswith("insert into orders"):
            new_id = self.store.next_order
            self.store.next_order += 1
            self.store.orders[new_id] = {
                "order_id": new_id, "produce_id": int(values[0]), "buyer_id": int(values[1]),
                "farmer_id": int(values[2]), "quantity": float(values[3]),
                "total_amount": float(values[4]), "status": "pending",
            }
            self.lastrowid = new_id
        elif sql.startswith("update offers set status = 'accepted'"):
            self.store.offers[int(values[0])]["status"] = "accepted"
        elif sql.startswith("select order_id, produce_id, buyer_id, farmer_id, quantity, total_amount, status from orders"):
            row = self.store.orders.get(int(values[0]))
            owner_key = "buyer_id" if "where order_id = %s and buyer_id" in sql else "farmer_id"
            self.one = copy.deepcopy(row) if row and row[owner_key] == int(values[1]) else None
        elif sql.startswith("select quantity, available from produce"):
            row = self.store.produce.get(int(values[0]))
            self.one = copy.deepcopy(row) if row and row["farmer_id"] == int(values[1]) else None
        elif sql.startswith("update produce set quantity = %s where produce_id"):
            self.store.produce[int(values[1])]["quantity"] = float(values[0])
        elif sql.startswith("update orders set status = %s"):
            self.store.orders[int(values[1])]["status"] = str(values[0])
        elif sql.startswith("select produce_name, unit from produce"):
            row = self.store.produce.get(int(values[0]))
            self.one = {"produce_name": row["produce_name"], "unit": row["unit"]} if row else None
        elif sql.startswith("insert into email_notification_outbox"):
            if self.store.fail_on == "insert_outbox":
                raise RuntimeError("synthetic outbox failure")
            idempotency_key, event_name, recipient_id, other_id, payload = values
            existing = next((item for item in self.store.outbox if item["idempotency_key"] == idempotency_key), None)
            if existing:
                self.lastrowid = existing["outbox_id"]
            else:
                row = {
                    "outbox_id": self.store.next_outbox,
                    "idempotency_key": str(idempotency_key),
                    "event_name": str(event_name),
                    "recipient_user_id": int(recipient_id),
                    "other_party_user_id": int(other_id) if other_id is not None else None,
                    "payload_json": str(payload),
                    "status": "pending",
                    "attempt_count": 0,
                    "available_at": "due",
                    "locked_at": None,
                    "locked_by": None,
                    "delivered_at": None,
                    "last_error_code": None,
                }
                self.store.outbox.append(row)
                self.store.next_outbox += 1
                self.lastrowid = row["outbox_id"]
        elif sql.startswith("update email_notification_outbox set status = 'pending'"):
            for row in self.store.outbox:
                if row["status"] == "processing" and row.get("locked_at") == "expired":
                    row.update(status="pending", locked_at=None, locked_by=None, available_at="due")
        elif sql.startswith("select outbox_id, idempotency_key, event_name"):
            self.rows = [
                copy.deepcopy(row) for row in self.store.outbox
                if row["status"] == "pending" and row.get("available_at") == "due"
            ][:int(values[0])]
        elif sql.startswith("update email_notification_outbox set status = 'processing'"):
            worker_id, outbox_id = values
            row = next(item for item in self.store.outbox if item["outbox_id"] == int(outbox_id))
            if row["status"] == "pending":
                row.update(status="processing", locked_by=worker_id, locked_at="now")
                row["attempt_count"] += 1
        elif sql.startswith("update email_notification_outbox set status = %s"):
            status = str(values[0])
            if "date_add(utc_timestamp()" in sql:
                _, delay, error_code, outbox_id, worker_id = values
            else:
                _, error_code, outbox_id, worker_id = values
                delay = None
            row = next((item for item in self.store.outbox if item["outbox_id"] == int(outbox_id)), None)
            if row and row["status"] == "processing" and row["locked_by"] == worker_id:
                row.update(
                    status=status,
                    locked_at=None,
                    locked_by=None,
                    last_error_code=error_code,
                    delivered_at="now" if status == "delivered" else None,
                    available_at="future" if delay else row["available_at"],
                )
        else:
            raise AssertionError(f"Unexpected synthetic SQL: {sql}")

    def fetchone(self):
        return self.one

    def fetchall(self):
        return list(self.rows)

    def close(self):
        pass


class FakeSMTP:
    def __init__(self, sent, should_fail=False):
        self.sent = sent
        self.should_fail = should_fail

    def __enter__(self):
        if self.should_fail:
            raise OSError("synthetic SMTP unavailable")
        return self

    def __exit__(self, *args):
        return False

    def ehlo(self):
        pass

    def starttls(self):
        pass

    def login(self, username, password):
        pass

    def send_message(self, message):
        self.sent.append(message)


class TransactionEmailNotificationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = Flask(__name__, template_folder=str(PROJECT_ROOT / "backend" / "templates"))
        cls.app.config.update(TESTING=True, SECRET_KEY="synthetic-email-test-secret")
        cls.app.register_blueprint(offer_routes.offer_bp)
        cls.app.register_blueprint(order_routes.order_bp)

    def setUp(self):
        self.store = SyntheticStore()
        self.client = self.app.test_client()
        self.sent = []
        self.smtp_failed = False
        self.smtp_called_before_commit = False
        Config.MAIL_USERNAME = "smartfarmer@example.test"
        Config.MAIL_PASSWORD = "synthetic-only-password"
        Config.MAIL_DEFAULT_SENDER = None
        Config.MAIL_SERVER = "smtp.invalid.test"
        Config.MAIL_PORT = 587
        Config.MAIL_USE_TLS = True
        self.patches = [
            patch.object(offer_routes, "get_db_connection", side_effect=self.store.connect),
            patch.object(order_routes, "get_db_connection", side_effect=self.store.connect),
            patch.object(email_notifications.smtplib, "SMTP", side_effect=self._smtp_factory),
        ]
        for item in self.patches:
            item.start()
            self.addCleanup(item.stop)

    def _smtp_factory(self, *args, **kwargs):
        if self.store.commits < 1:
            self.smtp_called_before_commit = True
        return FakeSMTP(self.sent, self.smtp_failed)

    def session(self, user_id, role):
        with self.client.session_transaction() as current:
            current["user_id"] = user_id
            current["role"] = role
            current["auth_csrf_token"] = "synthetic-csrf"

    def headers(self):
        return {"X-CSRFToken": "synthetic-csrf"}

    def process_outbox(self):
        return email_outbox_worker.process_pending_batch(
            connection_factory=self.store.connect,
            app=self.app,
            batch_size=20,
        )

    def test_offer_creation_commits_one_farmer_outbox_event_without_smtp(self):
        self.session(22, "buyer")
        response = self.client.post("/api/offers", json={"produce_id": 101, "quantity": 3, "offered_price": 250}, headers=self.headers())
        self.assertEqual(response.status_code, 201)
        self.assertEqual(self.store.commits, 1)
        self.assertEqual(len(self.store.outbox), 1)
        event = self.store.outbox[0]
        self.assertEqual(event["event_name"], "offer_created")
        self.assertEqual(event["recipient_user_id"], 11)
        self.assertEqual(event["status"], "pending")
        self.assertEqual(self.sent, [])
        self.process_outbox()
        self.assertEqual(event["status"], "delivered")
        self.assertEqual(self.sent[0]["To"], "farmer@example.test")
        body = self.sent[0].get_body(preferencelist=("plain",)).get_content()
        self.assertIn("Tomato", body)
        self.assertIn("Quantity: 3 kg", body)
        self.assertIn("Unit price: Rs. 250.00 / kg", body)
        self.assertIn("Total price: Rs. 750.00", body)

    def test_transaction_email_uses_configured_default_sender(self):
        Config.MAIL_DEFAULT_SENDER = "notifications@example.test"
        with self.app.app_context():
            result = email_notifications.notify_transaction(
                "offer_created",
                {"email": "farmer@example.test", "full_name": "Synthetic Farmer"},
                {"produce": "Tomato"},
            )
        self.assertTrue(result)
        self.assertEqual(self.sent[0]["From"], "notifications@example.test")

    def test_transaction_email_falls_back_to_smtp_username(self):
        Config.MAIL_DEFAULT_SENDER = None
        with self.app.app_context():
            result = email_notifications.notify_transaction(
                "offer_created",
                {"email": "farmer@example.test", "full_name": "Synthetic Farmer"},
                {"produce": "Tomato"},
            )
        self.assertTrue(result)
        self.assertEqual(self.sent[0]["From"], Config.MAIL_USERNAME)

    def test_otp_email_uses_configured_default_sender_and_smtp_username_for_auth(self):
        sent = []

        class OtpSMTP(FakeSMTP):
            def __init__(self):
                super().__init__(sent)
                self.commands = 0

            def docmd(self, *args):
                self.commands += 1
                return [(334, b"challenge"), (334, b"challenge"), (235, b"authenticated")][self.commands - 1]

        Config.MAIL_DEFAULT_SENDER = "notifications@example.test"
        with patch.object(auth_helpers.smtplib, "SMTP", return_value=OtpSMTP()):
            auth_helpers.send_otp_email("recipient@example.test", "123456")
        self.assertEqual(sent[0]["From"], "notifications@example.test")

    def test_otp_email_falls_back_to_smtp_username(self):
        sent = []

        class OtpSMTP(FakeSMTP):
            def __init__(self):
                super().__init__(sent)
                self.commands = 0

            def docmd(self, *args):
                self.commands += 1
                return [(334, b"challenge"), (334, b"challenge"), (235, b"authenticated")][self.commands - 1]

        Config.MAIL_DEFAULT_SENDER = None
        with patch.object(auth_helpers.smtplib, "SMTP", return_value=OtpSMTP()):
            auth_helpers.send_otp_email("recipient@example.test", "123456")
        self.assertEqual(sent[0]["From"], Config.MAIL_USERNAME)

    def test_request_and_database_timing_logs_contain_only_safe_metadata(self):
        self.session(22, "buyer")
        with self.assertLogs(email_outbox.logger, level="INFO") as captured:
            response = self.client.post(
                "/api/offers",
                json={"produce_id": 101, "quantity": 3, "offered_price": 250},
                headers=self.headers(),
            )
        self.assertEqual(response.status_code, 201)
        logs = "\n".join(captured.output)
        self.assertIn("event=offer_created stage=outbox_insert duration_ms=", logs)
        self.assertIn("event=offer_created stage=database_transaction duration_ms=", logs)
        self.assertIn("event=offer_created stage=http_request duration_ms=", logs)
        self.assertNotIn("farmer@example.test", logs)
        self.assertNotIn("buyer@example.test", logs)
        self.assertNotIn("synthetic-only-password", logs)
    def test_offer_acceptance_queues_buyer_and_farmer_events(self):
        self.session(11, "farmer")
        response = self.client.patch("/api/offers/201/status", json={"status": "accepted"}, headers=self.headers())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.store.commits, 1)
        self.assertEqual([row["event_name"] for row in self.store.outbox], ["offer_accepted", "order_created"])
        self.assertEqual([row["recipient_user_id"] for row in self.store.outbox], [22, 11])
        self.assertEqual(self.sent, [])
        self.process_outbox()
        self.assertEqual([message["To"] for message in self.sent], ["buyer@example.test", "farmer@example.test"])
        self.assertIn("Offer ID", self.sent[0].get_body(preferencelist=("plain",)).get_content())
        self.assertIn("Order ID", self.sent[1].get_body(preferencelist=("plain",)).get_content())

    def test_order_confirmation_queues_buyer_event_and_returns_before_smtp(self):
        self.session(11, "farmer")
        response = self.client.patch("/api/orders/301/status", json={"status": "confirmed"}, headers=self.headers())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.store.commits, 1)
        self.assertEqual(self.store.orders[301]["status"], "confirmed")
        self.assertEqual(self.store.outbox[0]["event_name"], "order_confirmed")
        self.assertEqual(self.store.outbox[0]["recipient_user_id"], 22)
        self.assertEqual(self.sent, [])
        self.process_outbox()
        self.assertEqual(self.sent[0]["To"], "buyer@example.test")
        body = self.sent[0].get_body(preferencelist=("plain",)).get_content()
        self.assertIn("Order ID: 301", body)
        self.assertIn("Unit price: Rs. 250.00 / kg", body)

    def test_order_completion_queues_both_parties(self):
        self.store.orders[301]["status"] = "confirmed"
        self.session(11, "farmer")
        response = self.client.patch("/api/orders/301/status", json={"status": "completed"}, headers=self.headers())
        self.assertEqual(response.status_code, 200)
        self.assertEqual([row["event_name"] for row in self.store.outbox], ["order_completed", "order_completed"])
        self.assertEqual([row["recipient_user_id"] for row in self.store.outbox], [22, 11])
        self.assertEqual(self.sent, [])
        self.process_outbox()
        self.assertEqual([message["To"] for message in self.sent], ["buyer@example.test", "farmer@example.test"])

    def test_missing_recipient_is_permanent_failure_and_does_not_try_smtp(self):
        del self.store.users[11]
        self.session(22, "buyer")
        response = self.client.post("/api/offers", json={"produce_id": 101, "quantity": 3, "offered_price": 250}, headers=self.headers())
        self.assertEqual(response.status_code, 201)
        self.process_outbox()
        self.assertEqual(self.sent, [])
        self.assertEqual(self.store.outbox[0]["status"], "failed")
        self.assertEqual(self.store.outbox[0]["last_error_code"], "delivery_failed")

    def test_outbox_insert_failure_rolls_back_business_change(self):
        self.store.fail_on = "insert_outbox"
        self.session(22, "buyer")
        response = self.client.post("/api/offers", json={"produce_id": 101, "quantity": 3, "offered_price": 250}, headers=self.headers())
        self.assertEqual(response.status_code, 500)
        self.assertNotIn(202, self.store.offers)
        self.assertEqual(self.store.outbox, [])
        self.assertEqual(self.sent, [])

    def test_database_failure_does_not_leave_outbox_event(self):
        self.store.fail_on = "insert_offer"
        self.session(22, "buyer")
        response = self.client.post("/api/offers", json={"produce_id": 101, "quantity": 3, "offered_price": 250}, headers=self.headers())
        self.assertEqual(response.status_code, 500)
        self.assertEqual(self.store.outbox, [])
        self.assertEqual(self.sent, [])

    def test_commit_failure_rolls_back_offer_and_outbox(self):
        self.store.fail_on = "commit"
        self.session(22, "buyer")
        response = self.client.post("/api/offers", json={"produce_id": 101, "quantity": 3, "offered_price": 250}, headers=self.headers())
        self.assertEqual(response.status_code, 500)
        self.assertNotIn(202, self.store.offers)
        self.assertEqual(self.store.outbox, [])
        self.assertEqual(self.sent, [])

    def test_pending_event_survives_until_worker_run_after_restart(self):
        self.session(22, "buyer")
        response = self.client.post("/api/offers", json={"produce_id": 101, "quantity": 3, "offered_price": 250}, headers=self.headers())
        self.assertEqual(response.status_code, 201)
        self.assertEqual(self.store.outbox[0]["status"], "pending")
        self.assertEqual(self.sent, [])
        self.process_outbox()
        self.assertEqual(self.store.outbox[0]["status"], "delivered")
        self.assertEqual(len(self.sent), 1)

    def test_expired_processing_event_is_reclaimed_after_worker_restart(self):
        self.session(22, "buyer")
        response = self.client.post("/api/offers", json={"produce_id": 101, "quantity": 3, "offered_price": 250}, headers=self.headers())
        self.assertEqual(response.status_code, 201)
        event = self.store.outbox[0]
        event.update(status="processing", locked_at="expired", locked_by="stopped-worker")
        self.process_outbox()
        self.assertEqual(event["status"], "delivered")
        self.assertEqual(len(self.sent), 1)

    def test_order_transaction_rollback_removes_outbox_row(self):
        self.store.fail_on = "commit"
        self.session(11, "farmer")
        response = self.client.patch("/api/orders/301/status", json={"status": "confirmed"}, headers=self.headers())
        self.assertEqual(response.status_code, 500)
        self.assertEqual(self.store.orders[301]["status"], "pending")
        self.assertEqual(self.store.outbox, [])
        self.assertEqual(self.sent, [])

    def test_concurrent_worker_claims_do_not_claim_same_pending_row(self):
        self.session(22, "buyer")
        response = self.client.post("/api/offers", json={"produce_id": 101, "quantity": 3, "offered_price": 250}, headers=self.headers())
        self.assertEqual(response.status_code, 201)
        first = email_outbox_worker._claim_batch(self.store.connect, 10, 900)
        second = email_outbox_worker._claim_batch(self.store.connect, 10, 900)
        self.assertEqual(len(first), 1)
        self.assertEqual(second, [])
        self.assertEqual(self.store.outbox[0]["status"], "processing")

    def test_permanent_smtp_response_is_not_retried(self):
        self.session(11, "farmer")
        response = self.client.patch("/api/orders/301/status", json={"status": "confirmed"}, headers=self.headers())
        self.assertEqual(response.status_code, 200)

        class PermanentSMTP(FakeSMTP):
            def __enter__(self):
                raise email_notifications.smtplib.SMTPResponseException(550, b"rejected")

        with patch.object(email_notifications.smtplib, "SMTP", return_value=PermanentSMTP(self.sent)):
            self.process_outbox()
        self.assertEqual(self.store.outbox[0]["status"], "failed")
        self.assertEqual(self.store.outbox[0]["attempt_count"], 1)
        self.assertEqual(self.sent, [])
    def test_transient_smtp_failure_is_retried_and_then_delivered(self):
        self.session(11, "farmer")
        response = self.client.patch("/api/orders/301/status", json={"status": "confirmed"}, headers=self.headers())
        self.assertEqual(response.status_code, 200)
        self.smtp_failed = True
        self.process_outbox()
        event = self.store.outbox[0]
        self.assertEqual(event["status"], "pending")
        self.assertEqual(event["attempt_count"], 1)
        self.assertEqual(event["last_error_code"], "temporary_delivery_failure")
        self.assertEqual(self.sent, [])
        self.smtp_failed = False
        event["available_at"] = "due"
        self.process_outbox()
        self.assertEqual(event["status"], "delivered")
        self.assertEqual(event["attempt_count"], 2)
        self.assertEqual(len(self.sent), 1)

    def test_notification_queueing_uses_unique_idempotency_key(self):
        from services.email_outbox import enqueue_notification

        self.session(22, "buyer")
        response = self.client.post("/api/offers", json={"produce_id": 101, "quantity": 3, "offered_price": 250}, headers=self.headers())
        self.assertEqual(response.status_code, 201)
        original = self.store.outbox[0]
        cursor = self.store.connect().cursor(dictionary=True)
        enqueue_notification(
            cursor,
            event=original["event_name"],
            idempotency_key=original["idempotency_key"],
            recipient_user_id=original["recipient_user_id"],
            other_party_user_id=original["other_party_user_id"],
            details={"produce": "Tomato"},
        )
        keys = [row["idempotency_key"] for row in self.store.outbox]
        self.assertEqual(len(keys), len(set(keys)))
        self.assertEqual(len(self.store.outbox), 1)

    def test_quantity_formatter_handles_integer_decimal_scientific_and_grouping(self):
        cases = [
            ("3E+1", "30"),
            ("2.5", "2.5"),
            ("1.0", "1"),
            ("1.250", "1.25"),
            ("1000", "1,000"),
            ("3E+1 kg", "30 kg"),
        ]
        for value, expected in cases:
            with self.subTest(value=value):
                self.assertEqual(email_notifications.format_quantity(value), expected)

    def test_scientific_quantity_is_human_readable_in_notification_body(self):
        with self.app.app_context():
            email_notifications.notify_transaction(
                "offer_created",
                {"email": "farmer@example.test", "full_name": "Synthetic Farmer"},
                {"quantity": "3E+1 kg"},
            )
        body = self.sent[-1].get_body(preferencelist=("plain",)).get_content()
        self.assertIn("Quantity: 30 kg", body)
        self.assertNotIn("3E+1", body)

    def test_currency_formatter_handles_integers_decimals_scientific_large_and_zero(self):
        cases = [
            ("150", None, "Rs. 150.00"),
            ("1250.5", None, "Rs. 1,250.50"),
            ("4.5E+3", None, "Rs. 4,500.00"),
            ("12500.5", None, "Rs. 12,500.50"),
            ("0", None, "Rs. 0.00"),
            ("Rs. 1,250.50 / kg", "kg", "Rs. 1,250.50 / kg"),
            (None, None, None),
            ("not-a-price", None, None),
        ]
        for value, unit, expected in cases:
            with self.subTest(value=value, unit=unit):
                self.assertEqual(email_notifications.format_currency(value, unit), expected)

    def test_quantity_formatter_preserves_zero_and_actual_units(self):
        self.assertEqual(email_notifications.format_quantity("0.0", "g"), "0 g")
        self.assertEqual(email_notifications.format_quantity("2.500", "g"), "2.5 g")
        self.assertEqual(email_notifications.format_quantity("1000", "kg"), "1,000 kg")
        self.assertIsNone(email_notifications.format_quantity(None, "kg"))
        self.assertIsNone(email_notifications.format_quantity("invalid", "kg"))

    def test_missing_invalid_optional_values_do_not_crash_email(self):
        with self.app.app_context():
            result = email_notifications.notify_transaction(
                "offer_created",
                {"email": "farmer@example.test", "full_name": "Synthetic Farmer"},
                {"produce": "Tomato", "quantity": None, "unit": "g", "unit_price": "bad", "total": None},
            )
        self.assertTrue(result)
        body = self.sent[-1].get_body(preferencelist=("plain",)).get_content()
        self.assertIn("Tomato", body)
        self.assertNotIn("Quantity:", body)
        self.assertNotIn("Unit price:", body)
        self.assertNotIn("Total price:", body)

    def test_offer_notification_preserves_non_kg_produce_unit(self):
        self.store.produce[101]["unit"] = "g"
        self.session(22, "buyer")
        response = self.client.post("/api/offers", json={"produce_id": 101, "quantity": 2.5, "offered_price": 150}, headers=self.headers())
        self.assertEqual(response.status_code, 201)
        self.assertEqual(self.sent, [])
        self.process_outbox()
        body = self.sent[0].get_body(preferencelist=("plain",)).get_content()
        self.assertIn("Quantity: 2.5 g", body)
        self.assertIn("Unit price: Rs. 150.00 / g", body)
        self.assertIn("Total price: Rs. 375.00", body)

    def test_language_alias_and_unknown_language_fallbacks(self):
        for language in ("en", "si", "ta", "xx"):
            self.sent.clear()
            with self.app.app_context():
                email_notifications.notify_transaction("offer_created", {
                    "email": "farmer@example.test", "full_name": "Synthetic", "language": language,
                }, {"produce": "Tomato"})
            expected_language = language if language in email_notifications._COPY else "en"
            expected_subject = email_notifications._COPY[expected_language]["events"]["offer_created"][0]
            self.assertEqual(str(self.sent[-1]["Subject"]), f"Smart Farmer - {expected_subject}")
    def test_repeated_offer_acceptance_does_not_duplicate_events(self):
        self.session(11, "farmer")
        first = self.client.patch("/api/offers/201/status", json={"status": "accepted"}, headers=self.headers())
        second = self.client.patch("/api/offers/201/status", json={"status": "accepted"}, headers=self.headers())
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 409)
        self.assertEqual(len(self.store.outbox), 2)

    def test_repeated_order_confirmation_does_not_duplicate_event(self):
        self.session(11, "farmer")
        first = self.client.patch("/api/orders/301/status", json={"status": "confirmed"}, headers=self.headers())
        second = self.client.patch("/api/orders/301/status", json={"status": "confirmed"}, headers=self.headers())
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 409)
        self.assertEqual(len(self.store.outbox), 1)

    def test_smtp_failure_does_not_undo_committed_order_confirmation(self):
        self.session(11, "farmer")
        response = self.client.patch("/api/orders/301/status", json={"status": "confirmed"}, headers=self.headers())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.store.orders[301]["status"], "confirmed")
        self.assertEqual(self.sent, [])
        self.smtp_failed = True
        self.process_outbox()
        self.assertEqual(self.store.outbox[0]["status"], "pending")
        self.assertEqual(self.sent, [])

    def test_invalid_transition_does_not_queue_notification(self):
        self.store.orders[301]["status"] = "completed"
        self.session(11, "farmer")
        response = self.client.patch("/api/orders/301/status", json={"status": "completed"}, headers=self.headers())
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.store.outbox, [])
        self.assertEqual(self.sent, [])

if __name__ == "__main__":
    unittest.main()
