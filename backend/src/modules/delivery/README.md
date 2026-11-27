# Delivery (Unit 4)

How the item reaches the buyer: the meetup handover (proposals, the buyer's code, the seller's photos, the device check), courier shipments (quotes, booking, status), delivery areas, fare tables, addresses and delivery issues.

Design: [docs/design/04_delivery.pdf](../../../../docs/design/04_delivery.pdf). Database schema(s): `delivery` (`docs/design/sql/`, changed by `backend/src/migrations/`). Requirements: `docs/srs.tex`.

## What is inside

- `http/`: Delivery, Handover, Shipment and the admin and staff controllers.
- `services/`: `handover.service`, `shipment.service`, `quote.service`, `booking.service`, `areas.service`, `meetup-points.service`, `records.service`, `delivery-ports.service` (the unit's port, delegating).
- `adapters/`: the courier port and a mock courier.
- `db/entities/`: the schema as TypeORM sees it. `ports/`: the unit's public face. `consumers/` and `jobs/`: handlers of other units' events and scheduled work (`delivery.jobs`: books courier shipments and reconciles; consumers `handover.consumers`, `shipment.consumers`).

## Its ports (what other units may call)

`DELIVERY_PORT`, `DELIVERY_COMMANDS`, `DELIVERY_QUERIES`: see `ports/index.ts`. **Another unit never imports this unit's files or reads its tables** (DC-1); it asks a port, and when a change must happen together with one here the port is called in the caller's transaction (DC-13). ESLint and `src/import-boundaries.spec.ts` enforce it.

## Worth knowing

An operator's unlock of a handover code makes a new code; the old one stops working.

## Tests

Unit tests are the `*.spec.ts` files beside the code. The API and database tests are in `backend/test/` (`api/`, `security/`, `concurrency/`) and need PostgreSQL and Redis ([docs/HOW-TO.md](../../../../docs/HOW-TO.md), "Run the integration suite"). A test is named after the requirement it proves.

## Adding to it

A new route: a controller method with a policy decorator, a DTO and a doc comment, then regenerate the API document ([docs/api/README.md](../../../../docs/api/README.md)). A new table: the design SQL first, then a migration. See [docs/HOW-TO.md](../../../../docs/HOW-TO.md).
