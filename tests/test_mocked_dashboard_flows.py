r"""Isolated Flask test-client coverage for Farmer and Buyer dashboard pages.

Run from the project root with:
    .venv\Scripts\python.exe -m unittest discover -s tests -p test_mocked_dashboard_flows.py -v

This module disables python-dotenv before importing the app and blocks any
attempt to open a file named .env. Every imported DB adapter is patched before
the first request, so the tests do not connect to MySQL.
"""

from __future__ import annotations

import os
import sys
import unittest
from datetime import date, datetime, timezone
from pathlib import Path
from unittest.mock import patch


PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = PROJECT_ROOT / "backend"
os.environ["PYTHON_DOTENV_DISABLED"] = "1"
# Isolate even a missed adapter patch from every real MySQL instance.
os.environ["SECRET_KEY"] = "synthetic-test-only-secret"
os.environ["DB_HOST"] = "127.0.0.1"
os.environ["DB_USER"] = "synthetic_test_user"
os.environ["DB_PASSWORD"] = ""
os.environ["DB_PORT"] = "1"
os.environ["DB_NAME"] = "synthetic_test_no_connect"
os.environ["MAIL_USERNAME"] = ""
os.environ["MAIL_PASSWORD"] = ""
sys.path.insert(0, str(BACKEND_ROOT))


def _block_dotenv_reads(event, args):
    if event != "open" or not args:
        return
    filename = args[0]
    if isinstance(filename, (str, bytes, os.PathLike)):
        if Path(os.fsdecode(filename)).name.lower() == ".env":
            raise PermissionError("This isolated test explicitly blocks .env access")


sys.addaudithook(_block_dotenv_reads)

import app as app_module  # noqa: E402
import auth as auth_helpers  # noqa: E402
from routes import (  # noqa: E402
    admin_routes,
    offer_routes,
    order_routes,
    produce_routes,
    profile_routes,
)


SYNTHETIC_FARMER_ID = 71001
SYNTHETIC_BUYER_ID = 72001
SYNTHETIC_DATE = datetime(2026, 11, 16, 9, 30, tzinfo=timezone.utc)
_synthetic_market_prices = [{
    "price_id": 83001,
    "produce_name": "Synthetic Tomato",
    "market_name": "Synthetic Market",
    "district": "Galle",
    "price_per_kg": 100.0,
    "price_date": date(2026, 11, 15),
}]


def _synthetic_produce():
    return [
        {
            "produce_id": 81001,
            "farmer_id": SYNTHETIC_FARMER_ID,
            "category_id": 1,
            "category_name": "Vegetables",
            "produce_name": "Tomato",
            "description": "Synthetic tomato listing.",
            "quantity": 12.0,
            "unit": "kg",
            "price_per_unit": 250.0,
            "district": "Galle",
            "created_at": SYNTHETIC_DATE,
            "available": 1,
            "farmer_name": "Synthetic Farmer",
        },
        {
            "produce_id": 81002,
            "farmer_id": SYNTHETIC_FARMER_ID,
            "category_id": 1,
            "category_name": "Vegetables",
            "produce_name": "Beans",
            "description": "Synthetic beans listing.",
            "quantity": 8.0,
            "unit": "kg",
            "price_per_unit": 300.0,
            "district": "Matara",
            "created_at": SYNTHETIC_DATE,
            "available": 0,
            "farmer_name": "Synthetic Farmer",
        },
    ]


class MockCursor:
    def __init__(self, role_provider):
        self.role_provider = role_provider
        self.rows = []
        self.one = None
        self.closed = False

    def execute(self, query, params=None):
        sql = " ".join(str(query).lower().split())
        self.rows = []
        self.one = None

        if "select role from users where user_id" in sql:
            role = self.role_provider()
            self.one = {"role": role} if role else None
        elif "select user_id, full_name, role from users" in sql and "role = 'farmer'" in sql:
            self.one = {
                "user_id": SYNTHETIC_FARMER_ID,
                "full_name": "Synthetic Farmer",
                "role": "farmer",
            }
        elif "u.user_id as farmer_id" in sql and "from produce as p" in sql:
            self.rows = [row for row in _synthetic_produce() if row["available"] == 1]
        elif "count(*) as total_count" in sql and "from produce" in sql:
            self.one = {"total_count": 2, "active_count": 1}
        elif "select distinct p.district" in sql:
            self.rows = [{"district": "Galle"}, {"district": "Matara"}]
        elif "from produce as p" in sql and "p.available = 1" in sql:
            crop = str(params[0] or "").strip().lower() if params else ""
            district = str(params[2] or "").strip() if params else ""
            self.rows = [
                item for item in _synthetic_produce()
                if item["available"] == 1
                and (not crop or crop in item["produce_name"].lower())
                and (not district or item["district"] == district)
            ]
        elif "from produce as public_produce" in sql:
            self.rows = [
                row for row in _synthetic_produce()
                if row["available"] == 1
                and (not params or row["farmer_id"] == params[0])
            ]
        elif "count(*) as total from market_prices" in sql:
            self.one = {"total": len(_synthetic_market_prices)}
        elif "from market_prices" in sql and "limit" in sql:
            records = sorted(
                _synthetic_market_prices,
                key=lambda row: (str(row["price_date"]), row["price_id"]),
                reverse=True,
            )
            if params:
                limit, offset = params
                self.rows = records[offset:offset + limit]
            else:
                self.rows = records[:8] if "price_id" in sql else records[:6]
        elif "from market_prices" in sql:
            self.rows = sorted(
                _synthetic_market_prices,
                key=lambda row: (str(row["price_date"]), row["price_id"]),
                reverse=True,
            )
        elif "from offers as o" in sql and "where o.buyer_id" in sql:
            self.rows = [{
                "offer_id": 84001,
                "produce_id": 81001,
                "offered_price": 240.0,
                "quantity": 4.0,
                "status": "pending",
                "created_at": SYNTHETIC_DATE,
                "produce_name": "Tomato",
                "unit": "kg",
                "district": "Galle",
                "farmer_name": "Synthetic Farmer",
                "buyer_name": "Synthetic Buyer",
            }]
        elif "from offers as o" in sql and "where o.farmer_id" in sql:
            self.rows = [{
                "offer_id": 84002,
                "produce_id": 81001,
                "offered_price": 245.0,
                "quantity": 3.0,
                "status": "pending",
                "created_at": SYNTHETIC_DATE,
                "produce_name": "Tomato",
                "unit": "kg",
                "district": "Galle",
                "buyer_name": "Synthetic Buyer",
                "farmer_name": "Synthetic Farmer",
            }]
        elif "from orders as o" in sql and "where o.buyer_id" in sql:
            self.rows = [{
                "order_id": 85001,
                "produce_id": 81001,
                "quantity": 2.0,
                "total_amount": 500.0,
                "status": "confirmed",
                "created_at": SYNTHETIC_DATE,
                "produce_name": "Tomato",
                "unit": "kg",
                "district": "Galle",
                "farmer_name": "Synthetic Farmer",
                "buyer_name": "Synthetic Buyer",
            }]
        elif "from orders as o" in sql and "where o.farmer_id" in sql:
            self.rows = [{
                "order_id": 85002,
                "produce_id": 81001,
                "buyer_id": SYNTHETIC_BUYER_ID,
                "quantity": 1.0,
                "total_amount": 250.0,
                "status": "confirmed",
                "created_at": SYNTHETIC_DATE,
                "produce_name": "Tomato",
                "unit": "kg",
                "district": "Galle",
                "buyer_name": "Synthetic Buyer",
                "farmer_name": "Synthetic Farmer",
            }]
        elif "from produce left join categories" in sql and "where farmer_id" in sql:
            include_unavailable = bool(params and params[1] == 1)
            rows = _synthetic_produce()
            self.rows = rows if include_unavailable else [row for row in rows if row["available"] == 1]
        else:
            raise AssertionError(f"Unexpected mocked SQL query: {sql[:180]}")

    def fetchone(self):
        return self.one

    def fetchall(self):
        return list(self.rows)

    def close(self):
        self.closed = True


class MockConnection:
    def __init__(self, role_provider):
        self.role_provider = role_provider
        self.closed = False

    def cursor(self, dictionary=False, **kwargs):
        return MockCursor(self.role_provider)

    def close(self):
        self.closed = True


class MockedDashboardFlowsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        app_module.app.config.update(
            TESTING=True,
            SECRET_KEY="synthetic-test-only-secret",
            SERVER_NAME="localhost",
        )

    def setUp(self):
        self.database_role = "farmer"
        self.connections = []

        def connect_only_to_mock():
            connection = MockConnection(lambda: self.database_role)
            self.connections.append(connection)
            return connection

        self.adapter_patches = [
            patch.object(module, "get_db_connection", side_effect=connect_only_to_mock)
            for module in (
                app_module,
                auth_helpers,
                produce_routes,
                offer_routes,
                order_routes,
                profile_routes,
                admin_routes,
            )
        ]
        for adapter_patch in self.adapter_patches:
            adapter_patch.start()
            self.addCleanup(adapter_patch.stop)
        self.client = app_module.app.test_client()

    def establish_session(self, user_id, claimed_role):
        with self.client.session_transaction() as session:
            session["user_id"] = user_id
            session["role"] = claimed_role
            session["full_name"] = "Synthetic Farmer" if claimed_role == "farmer" else "Synthetic Buyer"
            session["language"] = "en"
            session["auth_csrf_token"] = "synthetic-csrf-token"

    def test_farmer_dashboard_renders_with_mocked_market_prices(self):
        self.database_role = "farmer"
        self.establish_session(SYNTHETIC_FARMER_ID, "farmer")
        response = self.client.get("/farmer/dashboard")
        self.assertEqual(response.status_code, 200)
        body = response.get_data(as_text=True)
        self.assertIn('data-page-view="dashboard"', body)
        self.assertIn("farmerProduceSearch", body)
        self.assertIn("receivedOffers", body)
        self.assertIn("farmerOrders", body)
        self.assertIn("farmerProduceCategoryFilter", body)
        self.assertIn("farmer_dashboard.js", body)
        self.assertIn("produce-images.js", body)
        self.assertIn('data-market-price-pagination="farmer"', body)
        self.assertIn("/farmer/produce", body)

    def test_public_market_prices_page_and_homepage_view_more_link(self):
        original_prices = list(_synthetic_market_prices)
        try:
            for record_count in (0, 1, 5, 6, 7):
                _synthetic_market_prices[:] = [
                    {
                        "price_id": 83001 + index,
                        "produce_name": f"Synthetic Produce {index + 1}",
                        "market_name": "Synthetic Market",
                        "district": "Galle",
                        "price_per_kg": 100.0 + index,
                        "price_date": date(2026, 11, 15),
                    }
                    for index in range(record_count)
                ]
                homepage = self.client.get("/home")
                self.assertEqual(homepage.status_code, 200)
                home_body = homepage.get_data(as_text=True)
                if record_count:
                    self.assertIn('class="sf-btn sf-btn-primary sf-market-price-toggle sf-home-cta" href="/market-prices"', home_body)
                else:
                    self.assertNotIn('class="sf-btn sf-btn-primary sf-market-price-toggle"', home_body)
                self.assertNotIn('data-market-price-actions', home_body)
                self.assertNotIn('data-target="public-market-prices"', home_body)
                self.assertEqual(home_body.count('class="sf-market-price-card"'), min(record_count, 6))
        finally:
            _synthetic_market_prices[:] = original_prices

        page = self.client.get("/market-prices")
        self.assertEqual(page.status_code, 200)
        body = page.get_data(as_text=True)
        self.assertIn("Synthetic Tomato", body)
        self.assertIn("Synthetic Market", body)
        self.assertIn("data-produce-image", body)
        self.assertIn("/frontend/js/produce-images.js", body)
        self.assertIn('class="sf-back-button" href="/home"', body)
        self.assertIn('/frontend/css/back-button.css', body)

    def test_farmer_full_produce_page_and_owned_mock_api(self):
        self.database_role = "farmer"
        self.establish_session(SYNTHETIC_FARMER_ID, "farmer")
        page = self.client.get("/farmer/produce")
        self.assertEqual(page.status_code, 200)
        body = page.get_data(as_text=True)
        self.assertIn('data-page-view="produce"', body)
        self.assertIn("farmerProduceSearch", body)
        self.assertIn("id=\"myProduce\"", body)
        self.assertIn("farmer_dashboard.js", body)

        active = self.client.get("/api/my-produce")
        self.assertEqual(active.status_code, 200)
        active_data = active.get_json()
        self.assertEqual(active_data["total_count"], 2)
        self.assertEqual(active_data["active_count"], 1)
        self.assertEqual([row["produce_name"] for row in active_data["produce"]], ["Tomato"])

        all_rows = self.client.get("/api/my-produce?include_unavailable=1")
        self.assertEqual(all_rows.status_code, 200)
        self.assertEqual({row["produce_name"] for row in all_rows.get_json()["produce"]}, {"Tomato", "Beans"})

    def test_buyer_dashboard_renders_only_synthetic_mock_data(self):
        self.database_role = "buyer"
        self.establish_session(SYNTHETIC_BUYER_ID, "buyer")
        response = self.client.get("/buyer/dashboard")
        self.assertEqual(response.status_code, 200)
        body = response.get_data(as_text=True)
        self.assertIn('data-page-view="dashboard"', body)
        self.assertIn("buyerProduceSearch", body)
        self.assertIn("buyerProduceCategoryFilter", body)
        self.assertIn('data-produce-name="Tomato"', body)
        self.assertNotIn('data-produce-name="Beans"', body)
        self.assertIn("Synthetic Farmer", body)
        self.assertIn("buyer_dashboard.js", body)
        self.assertIn("produce-images.js", body)
        self.assertIn('data-market-price-pagination="buyer"', body)
        self.assertIn("/buyer/produce", body)

    def test_farmer_and_buyer_market_price_pagination_boundaries(self):
        original_prices = list(_synthetic_market_prices)
        try:
            for role, user_id, endpoint in (
                ("farmer", SYNTHETIC_FARMER_ID, "/api/farmer/market-prices"),
                ("buyer", SYNTHETIC_BUYER_ID, "/api/buyer/market-prices"),
            ):
                self.database_role = role
                self.establish_session(user_id, role)
                for record_count, expected_pages in ((0, 0), (1, 1), (6, 1), (7, 2), (13, 3)):
                    _synthetic_market_prices[:] = [
                        {
                            "price_id": 83000 + index,
                            "produce_name": f"Fixture produce {index}",
                            "market_name": "Fixture Market",
                            "district": "Galle",
                            "price_per_kg": float(index),
                            "price_date": date(2026, 11, 15),
                        }
                        for index in range(record_count)
                    ]
                    first = self.client.get(endpoint + "?page=1")
                    self.assertEqual(first.status_code, 200)
                    first_data = first.get_json()
                    self.assertEqual(first_data["total"], record_count)
                    self.assertEqual(first_data["pages"], expected_pages)
                    self.assertEqual(first_data["page"], 1)
                    self.assertEqual(len(first_data["items"]), min(record_count, 6))
                    self.assertEqual(
                        len({item["produce_name"] for item in first_data["items"]}),
                        len(first_data["items"]),
                    )

                    if expected_pages > 1:
                        second = self.client.get(endpoint + "?page=2")
                        second_data = second.get_json()
                        self.assertEqual(second_data["page"], 2)
                        self.assertEqual(len(second_data["items"]), min(6, record_count - 6))
                        self.assertFalse({
                            item["produce_name"] for item in first_data["items"]
                        } & {
                            item["produce_name"] for item in second_data["items"]
                        })
                        last = self.client.get(endpoint + f"?page={expected_pages}").get_json()
                        self.assertEqual(last["page"], expected_pages)
                        self.assertGreaterEqual(expected_pages, last["page"])
                    else:
                        empty = self.client.get(endpoint + "?page=8").get_json()
                        self.assertEqual(empty["page"], 1)
                        self.assertEqual(empty["items"], first_data["items"])
        finally:
            _synthetic_market_prices[:] = original_prices

    def test_buyer_full_produce_page_renders_search_filters_and_images(self):
        self.database_role = "buyer"
        self.establish_session(SYNTHETIC_BUYER_ID, "buyer")
        response = self.client.get("/buyer/produce?crop=tomato")
        self.assertEqual(response.status_code, 200)
        body = response.get_data(as_text=True)
        self.assertIn('data-page-view="produce"', body)
        self.assertIn('value="tomato"', body)
        self.assertIn("buyerProduceCategoryFilter", body)
        self.assertIn('data-produce-image', body)
        self.assertIn('data-produce-name="Tomato"', body)
        self.assertNotIn('data-produce-name="Beans"', body)
        self.assertIn("/buyer/dashboard", body)

    def test_database_role_overrides_spoofed_session_role(self):
        self.database_role = "buyer"
        self.establish_session(SYNTHETIC_FARMER_ID, "farmer")
        response = self.client.get("/farmer/dashboard")
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.headers["Location"], "/dashboard")
        with self.client.session_transaction() as session:
            self.assertEqual(session.get("role"), "buyer")

        self.database_role = "farmer"
        self.establish_session(SYNTHETIC_BUYER_ID, "buyer")
        response = self.client.get("/buyer/dashboard")
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.headers["Location"], "/dashboard")
        with self.client.session_transaction() as session:
            self.assertEqual(session.get("role"), "farmer")

    def test_missing_and_deleted_sessions_are_rejected(self):
        unauthenticated = self.client.get("/farmer/dashboard")
        self.assertEqual(unauthenticated.status_code, 302)
        self.assertEqual(unauthenticated.headers["Location"], "/login")

        self.database_role = None
        self.establish_session(SYNTHETIC_FARMER_ID, "farmer")
        deleted_account = self.client.get("/buyer/dashboard")
        self.assertEqual(deleted_account.status_code, 302)
        self.assertEqual(deleted_account.headers["Location"], "/login-page")
        with self.client.session_transaction() as session:
            self.assertNotIn("user_id", session)

    def test_farmer_only_produce_api_rejects_buyer_role(self):
        self.database_role = "buyer"
        self.establish_session(SYNTHETIC_BUYER_ID, "buyer")
        response = self.client.get("/api/my-produce")
        self.assertEqual(response.status_code, 403)
        self.assertFalse(response.get_json()["success"])


if __name__ == "__main__":
    unittest.main()
