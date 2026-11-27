# Game accounts (Unit 5)

Selling a game account safely: the ownership proof and its review, the sealed credential handover (the credentials are encrypted for the buyer and the platform never sees them), the takeover confirmation and its window.

Design: [docs/design/05_game_accounts.pdf](../../../../docs/design/05_game_accounts.pdf). Database schema(s): `game_accounts` (`docs/design/sql/`, changed by `backend/src/migrations/`). Requirements: `docs/srs.tex`.

## What is inside

- `http/`: the game-account controller and the credential handover controller.
- `services/`: `ownership.service`, `ownership-review.service`, `handover.service`, `takeover.service`.
- `adapters/`: how disputes reach this unit.
- `db/entities/`: the schema as TypeORM sees it. `ports/`: the unit's public face. `consumers/` and `jobs/`: handlers of other units' events and scheduled work (`game.jobs`; consumers `claim.consumers`, `handover.consumers`).

## Its ports (what other units may call)

`GAME_ACCOUNT_COMMANDS`, `GAME_ACCOUNT_QUERIES`, `GAME_ACCOUNT_PORT`: see `ports/index.ts`. **Another unit never imports this unit's files or reads its tables** (DC-1); it asks a port, and when a change must happen together with one here the port is called in the caller's transaction (DC-13). ESLint and `src/import-boundaries.spec.ts` enforce it.

## Worth knowing

The page the buyer opens to receive credentials is a document of its own (`frontend/src/secure/`) that loads no shared code (SEC-GAM-03).

## Tests

Unit tests are the `*.spec.ts` files beside the code. The API and database tests are in `backend/test/` (`api/`, `security/`, `concurrency/`) and need PostgreSQL and Redis ([docs/HOW-TO.md](../../../../docs/HOW-TO.md), "Run the integration suite"). A test is named after the requirement it proves.

## Adding to it

A new route: a controller method with a policy decorator, a DTO and a doc comment, then regenerate the API document ([docs/api/README.md](../../../../docs/api/README.md)). A new table: the design SQL first, then a migration. See [docs/HOW-TO.md](../../../../docs/HOW-TO.md).
