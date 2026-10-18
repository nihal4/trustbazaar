# System Design Document

The SDD is designed one unit at a time; when every unit is done, the units are connected into the full system architecture.

| # | Unit | Status | Files |
|---|---|---|---|
| 1 | Identity & Access | Draft for review | `01_identity_access.tex` / `.pdf`, `sql/01_identity_access.sql` |
| 2 | Order, Payment & Escrow | Draft for review | `02_orders_payments.tex` / `.pdf`, `sql/02_orders_payments.sql` |
| 3 | Auction Engine; Listings, Search & Fixed-Price | Draft for review | `03_listings_auctions.tex` / `.pdf`, `sql/03_listings_auctions.sql` |
| 4 | Delivery & Handover | Draft for review | `04_delivery.tex` / `.pdf`, `sql/04_delivery.sql` |
| 5 | Game-Account Escrow | Draft for review | `05_game_accounts.tex` / `.pdf`, `sql/05_game_accounts.sql`, `crypto/sealed.js` |
| 6 | Chat & Notifications | Draft for review | `06_chat_notifications.tex` / `.pdf`, `sql/06_chat_notifications.sql` |
| 7 | Disputes, Trust & Safety, Staff Tools | Draft for review | `07_disputes_trust_staff.tex` / `.pdf`, `sql/07_disputes_trust_staff.sql` |
| 8 | Frontend: app structure, routing, API client, screens per unit | Draft for review | `08_frontend.tex` / `.pdf`, `web/` (reference modules, nginx configuration, tests) |
| 9 | Integration: full architecture, combined data model, deployment | Draft for review | `09_integration.tex` / `.pdf`, `sql/09_*`, `deploy/`, `integration/` |

Design conventions shared by all units: DC-1 to DC-12 in Section 2 of the Unit 1 document; DC-13 (transactional ports) in Section 2.3 of the Unit 2 document; DC-14 (lock order for delivery) in Section 2.3 of the Unit 4 document; DC-15 (indexes on foreign keys) in Section 3.2 of the Unit 9 document.

## Database schema per unit

Each unit owns its own PostgreSQL schema and ships an SQL file plus a test script for the rules the database enforces. To check the schemas against a local PostgreSQL 15 or later:

```bash
createdb tb_design_check
psql -d tb_design_check -v ON_ERROR_STOP=1 -f docs/design/sql/01_identity_access.sql
psql -d tb_design_check -v ON_ERROR_STOP=1 -f docs/design/sql/01_identity_access_tests.sql   # every line prints PASS
psql -d tb_design_check -v ON_ERROR_STOP=1 -f docs/design/sql/02_orders_payments.sql
psql -d tb_design_check -v ON_ERROR_STOP=1 -f docs/design/sql/02_orders_payments_tests.sql
psql -d tb_design_check -v ON_ERROR_STOP=1 -f docs/design/sql/03_listings_auctions.sql
psql -d tb_design_check -v ON_ERROR_STOP=1 -f docs/design/sql/03_listings_auctions_tests.sql
psql -d tb_design_check -v ON_ERROR_STOP=1 -f docs/design/sql/04_delivery.sql
psql -d tb_design_check -v ON_ERROR_STOP=1 -f docs/design/sql/04_delivery_tests.sql
psql -d tb_design_check -v ON_ERROR_STOP=1 -f docs/design/sql/05_game_accounts.sql
psql -d tb_design_check -v ON_ERROR_STOP=1 -f docs/design/sql/05_game_accounts_tests.sql
psql -d tb_design_check -v ON_ERROR_STOP=1 -f docs/design/sql/06_chat_notifications.sql
psql -d tb_design_check -v ON_ERROR_STOP=1 -f docs/design/sql/06_chat_notifications_tests.sql
psql -d tb_design_check -v ON_ERROR_STOP=1 -f docs/design/sql/07_disputes_trust_staff.sql
psql -d tb_design_check -v ON_ERROR_STOP=1 -f docs/design/sql/07_disputes_trust_staff_tests.sql
psql -d tb_design_check -v ON_ERROR_STOP=1 -f docs/design/sql/09_integration.sql
psql -d tb_design_check -v ON_ERROR_STOP=1 -f docs/design/sql/09_integration_checks.sql          # 21 checks across units
```

Unit 4 also has a concurrency script, which commits its own fixtures, so run it on a separate database
loaded with the Unit 1-4 schemas: `PSQL="psql" sh docs/design/sql/04_delivery_concurrency.sh tb_race_check`.
Unit 5's `05_game_accounts_concurrency.sh`, Unit 6's `06_chat_notifications_concurrency.sh` and Unit 7's `07_disputes_trust_staff_concurrency.sh` work the same way, on a database loaded with the schemas up to their unit.
`sql/06_chat_notifications_print.sql` is a generated ASCII copy of the Unit 6 schema for the PDF (Bangla shown as code points); edit `06_chat_notifications.sql`.

## Integration (Unit 9)

- `sql/09_integration_checks_selftest.sh DB docs/design/sql` plants one violation per check in a fresh
  database and expects every check to fail; `sql/09_backup_restore_test.sh docs/design/sql WORKDIR` dumps,
  restores and rechecks the combined database.
- `deploy/` holds the reference Compose files, Dockerfiles, the database init script, CI workflows and
  Dependabot (for `.github/`), and their tests: `python3 docs/design/deploy/test_compose.py .` (needs only
  the Docker Compose CLI) and `deploy/test_accounts.sh` (needs a PostgreSQL superuser).
- `integration/check_documents.py docs` checks the SRS and the nine units against each other.

## Web client reference code (Unit 8)

`web/` holds the modules the web client imports unchanged (API client, money, Dhaka time and the server
clock, the plain-language money state, live ordering, catalogues, redirects) and the web container's nginx
configuration. `cd docs/design/web && npm install && sh test/run_all.sh` runs 46 unit tests, 12 Chromium
checks and 25 container checks (the last need nginx on PATH). See `web/README.md`.

## Browser code (Unit 5)

`crypto/sealed.js` is the reference module for the sealed game-account handover (HPKE over the Web
Cryptography API). `cd docs/design/crypto && npm install && npm test` runs its 14 checks in Chromium
through Playwright.

Units are loaded in order, because a unit may reference only units designed before it.

The test script runs in a transaction and rolls back. The schema files are the reference for the TypeORM entities and migrations; they are not run by the application directly.
