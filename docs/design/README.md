# System Design Document

The SDD is designed one unit at a time; when every unit is done, the units are connected into the full system architecture.

| # | Unit | Status | Files |
|---|---|---|---|
| 1 | Identity & Access | Draft for review | `01_identity_access.tex` / `.pdf`, `sql/01_identity_access.sql` |
| 2 | Order, Payment & Escrow | Draft for review | `02_orders_payments.tex` / `.pdf`, `sql/02_orders_payments.sql` |
| 3 | Auction Engine; Listings, Search & Fixed-Price | Draft for review | `03_listings_auctions.tex` / `.pdf`, `sql/03_listings_auctions.sql` |
| 4 | Delivery & Handover | Next | |
| 5 | Game-Account Escrow | Planned | |
| 6 | Chat & Notifications | Planned | |
| 7 | Disputes, Trust & Safety, Staff Tools | Planned | |
| 8 | Frontend: app structure, routing, API client, screens per unit | Planned | |
| 9 | Integration: full architecture, combined data model, deployment | Planned | |

Design conventions shared by all units: DC-1 to DC-12 in Section 2 of the Unit 1 document; DC-13 (transactional ports) in Section 2.3 of the Unit 2 document.

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
```

Units are loaded in order, because a unit may reference only units designed before it.

The test script runs in a transaction and rolls back. The schema files are the reference for the TypeORM entities and migrations; they are not run by the application directly.
