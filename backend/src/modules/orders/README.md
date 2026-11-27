# Orders and payments (Unit 2)

The money: orders, escrow, the ledger, payments (a mock provider and Stripe in test mode), refunds, payouts to sellers, receipts and statements, and monetization (subscriptions, featuring).

Design: [docs/design/02_orders_payments.pdf](../../../../docs/design/02_orders_payments.pdf). Database schema(s): `orders`, `payments` (`docs/design/sql/`, changed by `backend/src/migrations/`). Requirements: `docs/srs.tex`.

## What is inside

- `http/`: Orders, Payments, Payouts and Monetization controllers.
- `services/`: `order.service`, `escrow.service`, `ledger.service` (balanced lines only), `payment.service`, `refund.service`, `payout.service`, `statement.service`, `monetization.service`.
- `adapters/`: the payment and payout providers.
- `db/entities/`: the schema as TypeORM sees it. `ports/`: the unit's public face. `consumers/` and `jobs/`: handlers of other units' events and scheduled work (`orders.jobs`: expires unpaid orders, watches the fulfilment deadline and stalled deliveries, lapses cancellation requests, reconciles, sends refunds and payouts).

## Its ports (what other units may call)

`ESCROW_COMMANDS`, `ESCROW_QUERY`, `ORDERS_PORT`, `PAYOUT_CHECKS`, `PRO_STATUS`: see `ports/index.ts`. **Another unit never imports this unit's files or reads its tables** (DC-1); it asks a port, and when a change must happen together with one here the port is called in the caller's transaction (DC-13). ESLint and `src/import-boundaries.spec.ts` enforce it.

## Worth knowing

Money is integer poisha (`bigint`). An order keeps the parameter version it was created with. Lock order: listing, order, escrow, attempt (DC-14).

## Tests

Unit tests are the `*.spec.ts` files beside the code. The API and database tests are in `backend/test/` (`api/`, `security/`, `concurrency/`) and need PostgreSQL and Redis ([docs/HOW-TO.md](../../../../docs/HOW-TO.md), "Run the integration suite"). A test is named after the requirement it proves.

## Adding to it

A new route: a controller method with a policy decorator, a DTO and a doc comment, then regenerate the API document ([docs/api/README.md](../../../../docs/api/README.md)). A new table: the design SQL first, then a migration. See [docs/HOW-TO.md](../../../../docs/HOW-TO.md).
