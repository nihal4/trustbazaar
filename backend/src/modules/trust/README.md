# Trust, disputes and staff tools (Unit 7)

Keeping it fair: disputes and their evidence and decisions, ratings, strikes and sanctions, reports, the privacy rights (data export, closing an account), the parameter set (`CP-nn` values) and its publication, signals for the operators and the staff work queues.

Design: [docs/design/07_disputes_trust_staff.pdf](../../../../docs/design/07_disputes_trust_staff.pdf). Database schema(s): `disputes`, `trust`, `staff` (`docs/design/sql/`, changed by `backend/src/migrations/`). Requirements: `docs/srs.tex`.

## What is inside

- `http/`: the Trust controller (disputes, ratings, privacy, staff queues) and the Config controller.
- `services/`: `dispute.service` and `dispute-case.service`, `evidence-pack.service`, `rating.service`, `sanction.service`, `privacy.service`, `data-export.service`, `config.service` and `config-admin.service` (the parameters), `signal.service`, `queue.service`.
- `db/entities/`: the schema as TypeORM sees it. `ports/`: the unit's public face. `consumers/` and `jobs/`: handlers of other units' events and scheduled work (`trust.jobs`: applies the retention of disputes; consumers `trust.consumers`).

## Its ports (what other units may call)

`REPORT_COMMANDS`, `SANCTION_PORT`, `CASE_QUERY`, `TRUST_QUERY`, `DISPUTE_COMMANDS`, `DISPUTE_QUERIES`: see `ports/index.ts`. **Another unit never imports this unit's files or reads its tables** (DC-1); it asks a port, and when a change must happen together with one here the port is called in the caller's transaction (DC-13). ESLint and `src/import-boundaries.spec.ts` enforce it.

## Worth knowing

`ConfigService` implements `ConfigPort` for every unit: parameters are cached for 60 seconds and an order or auction keeps its version. The emergency switches are never cached.

## Tests

Unit tests are the `*.spec.ts` files beside the code. The API and database tests are in `backend/test/` (`api/`, `security/`, `concurrency/`) and need PostgreSQL and Redis ([docs/HOW-TO.md](../../../../docs/HOW-TO.md), "Run the integration suite"). A test is named after the requirement it proves.

## Adding to it

A new route: a controller method with a policy decorator, a DTO and a doc comment, then regenerate the API document ([docs/api/README.md](../../../../docs/api/README.md)). A new table: the design SQL first, then a migration. See [docs/HOW-TO.md](../../../../docs/HOW-TO.md).
