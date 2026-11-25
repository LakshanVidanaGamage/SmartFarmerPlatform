# Smart Farmer Platform

Flask and MySQL marketplace for farmers and buyers. Farmers can manage produce
listings and respond to buyer offers. Buyers can search listings, send offers,
and track orders. Registration and password recovery use email OTPs.

## Requirements

- Python 3.10 or later
- MySQL 8.0 or a compatible MySQL server
- A MySQL account allowed to create the application database when setting up a
  fresh install
- SMTP credentials for registration and password-recovery email

Python dependencies are listed in `requirements.txt`.

## Install Python dependencies

From the project root, create and activate a virtual environment in
PowerShell:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

If PowerShell blocks virtual-environment activation, install dependencies from
the project root with:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

## Create the database

For a fresh install, open `database/schema.sql` in MySQL Workbench and execute
it against your MySQL server, or run it with the MySQL command-line client:

```text
mysql -u your_mysql_user -p < database/schema.sql
```

Replace `your_mysql_user` with the local MySQL account name. The `-p` option
prompts for its password; do not put the password in the command.

The script creates `smart_farmer_db` before selecting it, then creates the
tables in foreign-key dependency order. It creates tables only; it does not
seed an admin account or sample market prices.

This is a fresh-install schema, not a migration. `CREATE TABLE IF NOT EXISTS`
does not change tables already present in an existing database. Back up and
plan a separate migration before applying schema changes to an existing
installation.

## Configure the application

The Flask configuration reads environment settings from `backend/.env`. Keep
that file private and do not commit or share its values. Set the following
keys in the existing file or in your deployment environment:

```dotenv
SECRET_KEY=<a-long-random-secret>
APP_ENV=development
DB_HOST=localhost
DB_PORT=3306
DB_USER=<mysql_user>
DB_PASSWORD=<mysql_password>
DB_NAME=smart_farmer_db
MAIL_SERVER=smtp.gmail.com
MAIL_PORT=587
MAIL_USE_TLS=True
MAIL_USERNAME=<smtp_username>
MAIL_PASSWORD=<smtp_password-or-app-password>
```

`SECRET_KEY` is required when Flask starts. Database host, user, password,
database name, and port have defaults in the application configuration, but
set them explicitly for your environment. SMTP credentials are needed for
registration and password-reset OTP emails. Use credentials appropriate to
your mail provider; do not put real values in source control. `APP_ENV` is
`development` for local HTTP use and should be `production` for an HTTPS
deployment. Flask debug mode is off unless `APP_ENV` is explicitly set to
`development` and `FLASK_DEBUG` is explicitly enabled.

## Run Flask

In VS Code, select **Smart Farmer Platform (email worker enabled)** in Run and
Debug and press F5. This uses the Desktop project's `.venv`, runs
`backend/app.py` from the backend directory, and starts the email outbox worker
in one background thread in the Flask process. The worker uses the existing
database and outbox configuration, polls every 5 seconds in batches of 10, and
does not block HTTP requests. Stop the application with the VS Code Stop button
or Ctrl+C; the worker is signalled to finish its current batch before Flask
exits. The Flask reloader is disabled for this configuration to prevent a
second worker process.

You can also run the same managed startup directly from PowerShell:

```powershell
Set-Location backend
..\.venv\Scripts\python.exe app.py
```

The standalone worker command remains available for deployments where Flask
and the worker run as separate services. Do not run it alongside the managed
Flask startup, or the deployment will have two workers:

```powershell
Set-Location backend
..\.venv\Scripts\python.exe -m services.email_outbox_worker --poll-interval 5 --batch-size 10
```

The automatic worker starts only when `backend/app.py` is run as the program
entry point. Importing `app:app` through another WSGI server does not start a
worker; start one standalone worker for that separate deployment instead.

Open <http://127.0.0.1:5000/> in a browser. The root page presents the language
selector; choosing a language opens the public dashboard. The development
server runs without HTTPS locally. Debug mode remains off by default. To
explicitly enable it for local development only, set both values in the current
PowerShell session before starting Flask:

```powershell
$env:APP_ENV = "development"
$env:FLASK_DEBUG = "1"
python app.py
```

The app-managed startup disables Flask's Werkzeug reloader even when debug
mode is explicitly enabled. Use the VS Code debugger for breakpoints; restart
the app to reload Python code.

For production, set `APP_ENV=production`, leave `FLASK_DEBUG` unset or set it
to `0`, serve the application over HTTPS, and use the production WSGI startup
below. **Never use `flask run --debug` or `FLASK_DEBUG=1` in production.** The
Flask CLI has an explicit debug override that an operator can use; the
application configuration cannot prevent a manual CLI override.

### Production WSGI startup

Provision Waitress as a deployment dependency in the production environment;
it is a WSGI server and is intentionally separate from the application's
`requirements.txt`. Run it from `backend` with production settings:

```powershell
$env:APP_ENV = "production"
$env:FLASK_DEBUG = "0"
Set-Location backend
waitress-serve --listen=127.0.0.1:8000 app:app
```

Place the loopback-only Waitress listener behind the production HTTPS reverse
proxy and prevent direct external access to port 8000. This startup imports the
Flask `app` object directly through WSGI; it does not use Flask's development
server, CLI debug flag, reloader, or interactive debugger. The production
configuration keeps `DEBUG` off and enables the session cookie's `Secure`
flag. Do not add `--debug` or set `FLASK_DEBUG=1` to this deployment.

The session cookie is HttpOnly and SameSite=Lax in every environment. Its
Secure flag is enabled outside development, so local HTTP development remains
usable while production cookies are restricted to HTTPS. The existing
non-permanent Flask session lifetime and CSRF token flow are unchanged.

### Logout and CSRF

Use `POST /logout` for browser and API logout requests. Browser logout forms
submit the session-bound `auth_csrf_token` in a hidden `csrf_token` field; API
clients send the same token in the `X-CSRFToken` header. Missing or invalid
tokens are rejected, and `GET /logout` does not clear the session.

For compatibility, the legacy `POST /api/auth/logout` endpoint remains
available. It is protected by the same session-bound CSRF check and responds
with HTTP 307 to `/logout`, preserving the POST method and token header. The
`/logout` handler performs the final token validation and clears the session.
New integrations should call `POST /logout` directly.

## Project layout

- `backend/app.py` - Flask app, public pages, and role-based dashboards
- `backend/routes/` - authentication, produce, offer, and order APIs
- `backend/auth.py` - registration OTP, password reset, email, and login logic
- `backend/templates/` - public pages and farmer/buyer dashboards
- `frontend/` - login and registration pages, shared assets, and static files
- `database/schema.sql` - fresh-install MySQL schema

The public registration flow allows farmer and buyer accounts only. To create
Admin accounts, use the local CLI setup command below; public registration does
not accept the Admin role.

## Create Admin accounts

After the database is set up and `backend/.env` is configured, run the command
from the `backend` directory with the project virtual environment active:

```powershell
Set-Location backend
python create_admin.py
```

Without activating the environment, run this from `backend` instead:

```powershell
..\.venv\Scripts\python.exe create_admin.py
```

The command allows up to three Admin accounts total. It prompts for the number
to create, then separately prompts for each person's full name, email, phone,
and password confirmation. The password prompt does not echo input. A phone
number is required because the current `users` table requires a unique phone
for every account. The command hashes passwords with the same helper used by
the application, checks existing and pending email/phone values, and commits
all accounts in a transaction. It uses a database lock to prevent concurrent
setup runs from exceeding the three-account limit. It does not print passwords
or hashes. Keep database access limited to trusted operators; do not add Admin
credentials to source code or public registration forms.

## Convert the reviewed Farmer account to Admin

`backend/convert_farmer_to_admin.py` is a separate, narrowly scoped utility for
the reviewed account (user ID `1`, `lakshanpasindu977@gmail.com`). It does not
create a user or change the account's name, email, phone, or password. It only
changes `users.role` from `farmer` to `admin`. Do not edit the target constants
to use this utility for a different account.

Before running it, configure `backend/.env` as described above and install the
MySQL client tools so `mysqldump` is available on `PATH`. The database account
must be able to read and dump the full database, including its tables, views,
triggers, routines, and events, and update the `users.role` field. If the dump
tool is missing, the backup command fails, the backup is empty, or its expected
database/tables are missing, the script stops without attempting the role
change. It does not print database credentials or account secrets.

Run from the `backend` directory with the project virtual environment active:

```powershell
Set-Location backend
python convert_farmer_to_admin.py --apply
```

Without activating the environment, run:

```powershell
..\.venv\Scripts\python.exe convert_farmer_to_admin.py --apply
```

The default backup directory is the current user's local application-data
folder on Windows (`%LOCALAPPDATA%\SmartFarmerPlatform\backups`) or
`~/.local/share/smart-farmer-platform/backups` on other platforms. You can
choose another local directory with `--backup-dir "path"`. The script creates
a new full-database `.sql` dump, protects the backup file for the current local
user, validates the dump, and prints its path and SHA-256 checksum. Keep the
backup in a protected location and verify that your normal restore procedure
can read it before relying on it. If file permissions cannot be restricted or
the dump cannot be validated, no conversion is attempted.

The script first requires you to type the exact confirmation phrase containing
the target ID, email, configured database name, and role change. It then creates
the backup, starts a transaction, locks and verifies the target and its
reviewed produce, offer, and order records, and checks full row snapshots after
the role-only update. It coordinates with the Admin setup command and preserves
the existing three-Admin limit. It displays the verification results and asks
for a separate confirmation. Type exactly `COMMIT` to save the change. Any other
input, including an empty response or interruption, causes a rollback. The
script reports success only after the database confirms COMMIT and the
read-only post-commit checks pass. If the connection fails during COMMIT, the
result may be uncertain; do not rerun the script until you verify the account
read-only.

After conversion, the account will use the Admin dashboard and will no longer
have Farmer dashboard access. Farmer-only directory views may no longer list
the account. The script preserves the account's existing produce, offers, and
orders; it does not delete or rewrite those records.

## Project Development History

This retrospective history summarizes the development phases documented in the
project discussion. Exact dates for the early milestones were not established;
they are therefore described by phase rather than assigned calendar dates. The
initial concept and implementation planning are distinct from the development
of the working web application.

### Initial project concept

The project concept was an agricultural marketplace connecting farmers and
buyers. The intended scope covered produce listings, market price information,
direct offers, and order tracking, with separate responsibilities for farmers,
buyers, and administrators. This describes the purpose of the project, rather
than evidence of a completed application at that stage.

### Implementation planning

Planning translated the concept into a Flask and MySQL application with
HTML/Jinja templates, CSS, and JavaScript. The implementation scope included
role-based access, produce management, offers and orders, market prices, email
verification and password recovery, and English, Sinhala, and Tamil support.
Planning is recorded separately from the subsequent implementation and testing.

### Web application development

The working application implemented public browsing and role-specific
dashboards, authentication and authorization, produce management, offer
submission and acceptance, and order status management. Registration and
password recovery incorporated email OTP verification. MySQL provided persistent
storage for the application's existing records and relationships.

### Public interface and dashboard refinement

Later iterations refined shared produce and market price cards, product images
and fallbacks, responsive grids, search, and pagination. Public Farmer and Buyer
directories and profile navigation were improved. Farmer and Buyer Overview
sections gained independent pagination, while dedicated Offers and Orders pages
were presented as responsive tables. These refinements preserved existing data,
actions, translations, and business workflows.

The approved agricultural PNG background was applied to the relevant application
pages while excluding Language Selection, Login, and Registration. Shared theme
styling was reviewed for Light and Dark Mode readability.

### Admin interface refinement

The Admin Dashboard received the Smart Farmer Premium visual treatment,
including the forest-green sidebar, overview panels, tables, filters, forms,
pagination, and status badges. Subsequent corrections addressed search and
dropdown focus borders, sidebar visibility and typography, and Produce toolbar
responsiveness. The latest Produce correction enabled wrapping at wider
viewports so that Filter and Clear remain within the toolbar without reducing
button size.

### Email delivery and operational preparation

Transaction notifications were handled through a persistent email outbox and a
background worker, with retry, idempotency, and lifecycle checks. Operational
documentation covered the managed Flask/worker startup, separate worker
deployment, production WSGI startup, environment configuration, and
CSRF-protected logout. These steps supported repeatable setup and demonstration
of the existing application.

### Audit and verification milestone — 26 November 2026

The documented QA work distinguished synthetic mutation tests, mocked SMTP,
automated browser checks, and read-only live MySQL integration. A separate
temporary QA environment preserved the existing project environment.

The final regression recorded 46 passing Python tests, 15 passing JavaScript
tests, nine passing browser regression cases, compilation of 22 Python files,
and syntax checks for 15 JavaScript files. The API authorization matrix passed
40 route/method checks, and the bounded API/security audit passed 50 checks.
Additional isolated tests exercised registration, OTP, password reset, and the
Farmer-to-Buyer produce, offer, and order lifecycle.

The Admin Produce toolbar was subsequently verified in Edge/Playwright at
390px, 768px, 1024px, and 1366px. All 24 combinations of viewport, language, and
theme kept the controls within the toolbar and avoided document overflow; the
nine existing mocked dashboard tests also passed.

These results describe the verified scope and do not establish complete
production certification. Real SMTP delivery, production mutations, deployment
TLS, rate limiting, and exhaustive manual interaction testing were not
performed. Detailed evidence and limitations are recorded in
[AUTOMATED_FULL_WEBSITE_TEST_REPORT.md](AUTOMATED_FULL_WEBSITE_TEST_REPORT.md)
and its
[HTML version](AUTOMATED_FULL_WEBSITE_TEST_REPORT.html).
