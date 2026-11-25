"""Loopback-only HTTP server for isolated Playwright dashboard checks.

This imports the same synthetic fixtures and adapter patches as
test_mocked_dashboard_flows.py. The test session endpoint exists only in this
runner, never in the production Flask application module.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
TEST_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(TEST_ROOT))

# Enforce no .env loading and fail closed to a loopback port with no MySQL
# server if any database adapter escapes the mock patches.
os.environ["PYTHON_DOTENV_DISABLED"] = "1"
os.environ["APP_ENV"] = "development"
os.environ["FLASK_DEBUG"] = "0"
os.environ["SECRET_KEY"] = "synthetic-browser-test-only-secret"
os.environ["DB_HOST"] = "127.0.0.1"
os.environ["DB_PORT"] = "1"
os.environ["DB_NAME"] = "synthetic_browser_test_no_connect"
os.environ["DB_USER"] = "synthetic_browser_test_user"
os.environ["DB_PASSWORD"] = ""
os.environ["MAIL_USERNAME"] = ""
os.environ["MAIL_PASSWORD"] = ""

import test_mocked_dashboard_flows as dashboard_flows  # noqa: E402
from test_mocked_dashboard_flows import (  # noqa: E402
    MockedDashboardFlowsTest,
    SYNTHETIC_BUYER_ID,
    SYNTHETIC_FARMER_ID,
    app_module,
)
from flask import jsonify, redirect, request, session, url_for  # noqa: E402
from werkzeug.serving import make_server  # noqa: E402


MockedDashboardFlowsTest.setUpClass()
fixture = MockedDashboardFlowsTest("test_farmer_dashboard_renders_with_mocked_market_prices")
fixture.setUp()
_default_produce = dashboard_flows._synthetic_produce
app = app_module.app
app.config.update(TESTING=True, DEBUG=False)


def _layout_produce():
    """Synthetic category/count fixtures for produce-grid browser checks."""
    records = []
    categories = [
        ("Vegetables", 15),
        ("Fruits", 1),
        ("Spices", 1),
        ("Leafy Vegetables", 1),
        ("Root and Tuber Crops", 1),
        ("Grains and Pulses", 1),
        ("Gourds and Climbing Vegetables", 1),
        ("Herbs", 1),
        ("Other Crops", 1),
    ]
    for category, count in categories:
        for number in range(1, count + 1):
            if category == "Vegetables":
                # Distinct search terms produce exact result sets of 1, 2, 3, 4 and 5.
                group = next(size for size in (1, 2, 3, 4, 5) if number <= sum(range(1, size + 1)))
                group_start = sum(range(1, group)) + 1
                crop_name = f"Fixture group{group} item{number - group_start + 1}"
            else:
                crop_name = {
                    "Fruits": "Orange",
                    "Spices": "Ginger",
                    "Leafy Vegetables": "Spinach",
                    "Root and Tuber Crops": "Potato",
                    "Grains and Pulses": "Rice",
                    "Gourds and Climbing Vegetables": "Pumpkin",
                    "Herbs": "Mint",
                    "Other Crops": "Tea",
                }[category]
            records.append({
                "produce_id": 81100 + len(records),
                "farmer_id": SYNTHETIC_FARMER_ID,
                "category_id": len(records) + 1,
                "category_name": category,
                "produce_name": crop_name,
                "description": "Synthetic layout fixture.",
                "quantity": 12.0,
                "unit": "kg",
                "price_per_unit": 250.0,
                "district": "Galle",
                "created_at": dashboard_flows.SYNTHETIC_DATE,
                "available": 1,
                "farmer_name": "Synthetic Farmer",
            })
    return records


@app.route("/__test__/health", methods=["GET"])
def _test_health():
    return jsonify({"status": "ok", "fixture": "synthetic-mocked"})


@app.route("/__test__/session/<role>", methods=["GET"])
def _test_session(role):
    if role not in {"farmer", "buyer"}:
        return jsonify({"error": "unsupported synthetic role"}), 404

    dashboard_flows._synthetic_produce = _layout_produce if request.args.get("fixture") == "layout" else _default_produce

    # This test-only route only creates a signed synthetic session. The real
    # before_request DB-role guard still runs on every protected page/API,
    # reading its role from MockCursor and enforcing the normal role checks.
    user_id = SYNTHETIC_FARMER_ID if role == "farmer" else SYNTHETIC_BUYER_ID
    fixture.database_role = role
    session.clear()
    session.update(
        user_id=user_id,
        role=role,
        full_name="Synthetic Farmer" if role == "farmer" else "Synthetic Buyer",
        language="en",
        auth_csrf_token="synthetic-browser-test-csrf",
    )
    destination = "farmer_dashboard" if role == "farmer" else "buyer_dashboard"
    return redirect(url_for(destination))


def main():
    host = "127.0.0.1"
    port = int(os.environ.get("SMARTFARMER_TEST_PORT", "58532"))
    if not 1024 <= port <= 65535:
        raise SystemExit("SMARTFARMER_TEST_PORT must be a valid unprivileged port")

    # make_server binds the requested loopback address directly and raises if
    # occupied; the test runner never scans or uses another MySQL/application port.
    server = make_server(host, port, app, threaded=True)
    print(f"Synthetic Smart Farmer test server listening at http://{host}:{port}", flush=True)
    print("Database adapters: mocked; .env loading: disabled", flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()
        fixture.doCleanups()


if __name__ == "__main__":
    main()
