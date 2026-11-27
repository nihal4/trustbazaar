# Chat and notifications (Unit 6)

Talking and being told: conversations between buyer and seller, blocks, reports, the detection terms that flag a message, holds on a conversation for a case, and notifications by screen, e-mail and SMS with reminders.

Design: [docs/design/06_chat_notifications.pdf](../../../../docs/design/06_chat_notifications.pdf). Database schema(s): `chat`, `notify` (`docs/design/sql/`, changed by `backend/src/migrations/`). Requirements: `docs/srs.tex`.

## What is inside

- `http/`: Chat, Notifications and the staff and dev controllers, and the chat gateway for the live connection.
- `services/`: `chat.service`, `block.service`, `hold.service`, `report.service`, `detection-terms.service`, `notification.service`, `reminder.service`, `templates`.
- `adapters/`: the e-mail and SMS channels (log mode in development; a dev mailbox shows what would be sent).
- `db/entities/`: the schema as TypeORM sees it. `ports/`: the unit's public face. `consumers/` and `jobs/`: handlers of other units' events and scheduled work (`notify.jobs`: sends deliveries and reminders, applies the retention of notifications and threads; consumers `notification.consumers`, `reminder.consumers`).

## Its ports (what other units may call)

`NOTIFIER`, `NOTIFICATION_PORT`, `BLOCK_PORT`, `CHAT_COMMANDS`: see `ports/index.ts`. **Another unit never imports this unit's files or reads its tables** (DC-1); it asks a port, and when a change must happen together with one here the port is called in the caller's transaction (DC-13). ESLint and `src/import-boundaries.spec.ts` enforce it.

## Worth knowing

Messages are plain text. The client id of a message makes a retry send it once.

## Tests

Unit tests are the `*.spec.ts` files beside the code. The API and database tests are in `backend/test/` (`api/`, `security/`, `concurrency/`) and need PostgreSQL and Redis ([docs/HOW-TO.md](../../../../docs/HOW-TO.md), "Run the integration suite"). A test is named after the requirement it proves.

## Adding to it

A new route: a controller method with a policy decorator, a DTO and a doc comment, then regenerate the API document ([docs/api/README.md](../../../../docs/api/README.md)). A new table: the design SQL first, then a migration. See [docs/HOW-TO.md](../../../../docs/HOW-TO.md).
