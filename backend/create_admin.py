"""Create up to three initial administrator accounts from a local terminal."""

import getpass
import re
import sys

from db import get_db_connection
from utils.security import hash_password


MAX_ADMIN_ACCOUNTS = 3
ADMIN_SETUP_LOCK = "smart_farmer_admin_setup"
EMAIL_PATTERN = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")
PHONE_PATTERN = re.compile(r"[0-9+\-\s]{7,20}")


class AdminSetupError(Exception):
    """A safe, user-facing setup validation error."""


def _get_admin_count():
    connection = None
    cursor = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)
        cursor.execute(
            "SELECT COUNT(*) AS admin_count FROM users WHERE role = %s",
            ("admin",),
        )
        result = cursor.fetchone()
        return int(result["admin_count"])
    finally:
        if cursor:
            cursor.close()
        if connection:
            connection.close()


def _parse_full_name(value):
    parts = " ".join(value.split()).split(" ", 1)
    if len(parts) != 2:
        raise AdminSetupError("Enter a first name and a last name.")

    first_name, last_name = parts
    full_name = f"{first_name} {last_name}"
    if len(first_name) > 50 or len(last_name) > 100 or len(full_name) > 151:
        raise AdminSetupError("The name exceeds the supported database length.")
    return first_name, last_name, full_name


def _prompt_admin_accounts(admin_count, input_fn=None, password_fn=None):
    input_fn = input_fn or input
    password_fn = password_fn or getpass.getpass
    available = MAX_ADMIN_ACCOUNTS - admin_count
    if available <= 0:
        raise AdminSetupError("The maximum of three Admin accounts already exists.")

    while True:
        raw_count = input_fn(
            f"How many Admin accounts should be created? (1-{available}): "
        ).strip()
        try:
            count = int(raw_count)
        except ValueError:
            count = 0
        if 1 <= count <= available:
            break
        print(f"Enter a number from 1 to {available}.")

    accounts = []
    seen_emails = set()
    seen_phones = set()

    for account_number in range(1, count + 1):
        print(f"\nAdmin {account_number} of {count}")

        while True:
            full_name_input = input_fn("Full name: ").strip()
            try:
                first_name, last_name, full_name = _parse_full_name(full_name_input)
                break
            except AdminSetupError as error:
                print(str(error))

        while True:
            email = input_fn("Email: ").strip().lower()
            if (
                EMAIL_PATTERN.fullmatch(email)
                and len(email) <= 254
                and email not in seen_emails
            ):
                break
            print("Enter a valid, non-repeated email address.")

        while True:
            phone = input_fn("Phone number: ").strip()
            if (
                PHONE_PATTERN.fullmatch(phone)
                and phone not in seen_phones
            ):
                break
            print("Enter a valid, non-repeated phone number.")

        while True:
            password = password_fn("Password (input hidden): ")
            confirm_password = password_fn("Confirm password (input hidden): ")
            if len(password) < 8:
                print("Password must contain at least 8 characters.")
            elif password != confirm_password:
                print("Passwords do not match.")
            else:
                break

        accounts.append({
            "first_name": first_name,
            "last_name": last_name,
            "full_name": full_name,
            "email": email,
            "phone": phone,
            "password_hash": hash_password(password),
            "role": "admin",
        })
        seen_emails.add(email)
        seen_phones.add(phone)
        del password, confirm_password

    return accounts


def _save_admin_accounts(accounts):
    connection = None
    cursor = None
    lock_acquired = False

    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)
        connection.start_transaction()

        cursor.execute(
            "SELECT GET_LOCK(%s, %s) AS lock_acquired",
            (ADMIN_SETUP_LOCK, 10),
        )
        lock_result = cursor.fetchone()
        if not lock_result or lock_result.get("lock_acquired") != 1:
            raise AdminSetupError("Could not obtain the Admin setup lock. Try again.")
        lock_acquired = True

        cursor.execute(
            "SELECT COUNT(*) AS admin_count FROM users WHERE role = %s",
            ("admin",),
        )
        current_count = int(cursor.fetchone()["admin_count"])
        if current_count + len(accounts) > MAX_ADMIN_ACCOUNTS:
            raise AdminSetupError(
                "The available Admin slots changed. Run the command again."
            )

        for account in accounts:
            cursor.execute(
                """
                SELECT user_id FROM users WHERE email = %s
                UNION ALL
                SELECT registration_id FROM pending_registrations WHERE email = %s
                LIMIT 1
                """,
                (account["email"], account["email"]),
            )
            if cursor.fetchone():
                raise AdminSetupError(
                    "An email address is already registered or pending verification."
                )

            cursor.execute(
                """
                SELECT user_id FROM users WHERE phone = %s
                UNION ALL
                SELECT registration_id FROM pending_registrations WHERE phone = %s
                LIMIT 1
                """,
                (account["phone"], account["phone"]),
            )
            if cursor.fetchone():
                raise AdminSetupError(
                    "A phone number is already registered or pending verification."
                )

            cursor.execute(
                """
                INSERT INTO users (
                    first_name, last_name, full_name, email, phone,
                    password_hash, role
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    account["first_name"],
                    account["last_name"],
                    account["full_name"],
                    account["email"],
                    account["phone"],
                    account["password_hash"],
                    account["role"],
                ),
            )

        connection.commit()
        return current_count + len(accounts)

    except Exception:
        if connection:
            connection.rollback()
        raise

    finally:
        if lock_acquired and cursor:
            try:
                cursor.execute(
                    "SELECT RELEASE_LOCK(%s) AS lock_released",
                    (ADMIN_SETUP_LOCK,),
                )
                cursor.fetchone()
            except Exception:
                pass
        if cursor:
            cursor.close()
        if connection:
            connection.close()


def main():
    try:
        current_count = _get_admin_count()
        accounts = _prompt_admin_accounts(current_count)
        new_count = _save_admin_accounts(accounts)
    except (AdminSetupError, EOFError, KeyboardInterrupt) as error:
        if isinstance(error, AdminSetupError):
            print(str(error))
        else:
            print("Admin setup cancelled; no credentials were displayed.")
        return 1
    except Exception:
        print("Admin setup failed. No account details were displayed.")
        return 1

    print(
        f"Created {len(accounts)} Admin account(s). "
        f"{MAX_ADMIN_ACCOUNTS - new_count} slot(s) remain."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
