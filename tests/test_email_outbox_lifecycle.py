"""Lifecycle tests use a synthetic runner and never connect to MySQL or SMTP."""

from __future__ import annotations

import os
import sys
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import Mock


PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = PROJECT_ROOT / "backend"
os.environ["PYTHON_DOTENV_DISABLED"] = "1"
os.environ["SECRET_KEY"] = "synthetic-lifecycle-test-secret"
os.environ["DB_HOST"] = "127.0.0.1"
os.environ["DB_PORT"] = "1"
os.environ["DB_USER"] = "synthetic-only"
os.environ["DB_PASSWORD"] = ""
os.environ["DB_NAME"] = "synthetic_only"
os.environ["MAIL_USERNAME"] = ""
os.environ["MAIL_PASSWORD"] = ""
sys.path.insert(0, str(BACKEND_ROOT))

from flask import Flask  # noqa: E402

import app as app_module  # noqa: E402
from services.email_outbox_worker import EmailOutboxWorkerLifecycle  # noqa: E402


class EmailOutboxWorkerLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.config.update(TESTING=True, DEBUG=False, SECRET_KEY="synthetic-only")
        self.app.add_url_rule("/login-page", "login_page", lambda: "login", methods=["GET"])

    def test_flask_entrypoint_starts_worker_before_serving_and_stops_after(self):
        events = []

        class LifecycleStub:
            def __init__(self, app, *, poll_interval, batch_size):
                self.app = app
                self.poll_interval = poll_interval
                self.batch_size = batch_size

            def start(self):
                events.append(("start", self.poll_interval, self.batch_size))

            def stop(self):
                events.append(("stop",))

        self.app.run = Mock(side_effect=lambda **kwargs: events.append(("run", kwargs)))
        app_module.run_application(self.app, lifecycle_factory=LifecycleStub)

        self.assertEqual(events[0], ("start", 5, 10))
        self.assertEqual(events[1][0], "run")
        self.assertEqual(events[1][1], {"debug": False, "use_reloader": False})
        self.assertEqual(events[2], ("stop",))

    def test_duplicate_start_does_not_create_a_second_worker_thread(self):
        started = threading.Event()
        calls = []
        calls_lock = threading.Lock()

        def runner(*, app, poll_interval, batch_size, stop_event):
            with calls_lock:
                calls.append((poll_interval, batch_size))
            started.set()
            stop_event.wait(2)

        lifecycle = EmailOutboxWorkerLifecycle(self.app, worker_runner=runner)
        self.assertTrue(lifecycle.start())
        self.assertTrue(started.wait(1))
        self.assertFalse(lifecycle.start())
        self.assertEqual(calls, [(5, 10)])
        lifecycle.stop()
        self.assertTrue(lifecycle.is_stopped)

    def test_application_registry_reuses_the_running_lifecycle(self):
        started = threading.Event()
        calls = []

        def runner(*, app, poll_interval, batch_size, stop_event):
            calls.append((poll_interval, batch_size))
            started.set()
            stop_event.wait(2)

        created = []

        def factory(app, *, poll_interval, batch_size):
            lifecycle = EmailOutboxWorkerLifecycle(
                app,
                poll_interval=poll_interval,
                batch_size=batch_size,
                worker_runner=runner,
            )
            created.append(lifecycle)
            return lifecycle

        first = app_module._get_email_outbox_lifecycle(self.app, factory)
        second = app_module._get_email_outbox_lifecycle(self.app, factory)
        self.assertIs(first, second)
        self.assertEqual(len(created), 1)
        self.assertTrue(first.start())
        self.assertTrue(started.wait(1))
        self.assertFalse(second.start())
        self.assertEqual(calls, [(5, 10)])
        first.stop()

    def test_lifecycle_logs_start_and_graceful_shutdown(self):
        started = threading.Event()

        def runner(*, app, poll_interval, batch_size, stop_event):
            started.set()
            stop_event.wait(2)

        lifecycle = EmailOutboxWorkerLifecycle(self.app, worker_runner=runner)
        with self.assertLogs("email_notification_worker", level="INFO") as captured:
            lifecycle.start()
            self.assertTrue(started.wait(1))
            lifecycle.stop()

        logs = "\n".join(captured.output)
        self.assertIn("lifecycle=started", logs)
        self.assertIn("lifecycle=stopping", logs)
        self.assertIn("lifecycle=stopped", logs)

    def test_shutdown_waits_for_in_flight_work_to_finish(self):
        started = threading.Event()
        observed_stop = threading.Event()
        finish_work = threading.Event()
        finished_work = threading.Event()

        def runner(*, app, poll_interval, batch_size, stop_event):
            started.set()
            stop_event.wait(2)
            observed_stop.set()
            finish_work.wait(2)
            finished_work.set()

        lifecycle = EmailOutboxWorkerLifecycle(self.app, worker_runner=runner)
        lifecycle.start()
        self.assertTrue(started.wait(1))
        stopper = threading.Thread(target=lifecycle.stop)
        stopper.start()
        self.assertTrue(observed_stop.wait(1))
        time.sleep(0.02)
        self.assertTrue(stopper.is_alive())
        self.assertFalse(finished_work.is_set())
        finish_work.set()
        stopper.join(1)
        self.assertFalse(stopper.is_alive())
        self.assertTrue(finished_work.is_set())
        self.assertTrue(lifecycle.is_stopped)

    def test_flask_request_completes_while_worker_thread_is_running(self):
        started = threading.Event()

        def runner(*, app, poll_interval, batch_size, stop_event):
            started.set()
            stop_event.wait(2)

        application = app_module.app
        application.config.update(
            TESTING=True,
            DEBUG=False,
            SECRET_KEY="synthetic-lifecycle-test-secret",
        )
        lifecycle = EmailOutboxWorkerLifecycle(application, worker_runner=runner)
        lifecycle.start()
        try:
            self.assertTrue(started.wait(1))
            response = application.test_client().get("/login-page")
            self.assertEqual(response.status_code, 200)
            self.assertTrue(lifecycle.thread.is_alive())
        finally:
            lifecycle.stop()


if __name__ == "__main__":
    unittest.main()
