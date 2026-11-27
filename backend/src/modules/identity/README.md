# Identity (Unit 1)

Who a person is and whether to let them in: registration, sign-in with a second factor, sessions and devices, step-up for sensitive actions, KYC (identity verification and its review), staff accounts and their approvals, and the audit log.

Design: [docs/design/01_identity_access.pdf](../../../../docs/design/01_identity_access.pdf). Database schema(s): `identity`, `audit` (`docs/design/sql/`, changed by `backend/src/migrations/`). Requirements: `docs/srs.tex`.

## What is inside

- `http/`: Auth, Registration, Account, Kyc and Staff controllers.
- `services/`: `signin.service`, `registration.service`, `session.service`, `mfa.service`, `step-up.service`, `kyc.service`, `kyc-review.service`, `staff-auth.service`, `approval.service` (four eyes), `audit.service`.
- `security/`: the guards (policy, CSRF, step-up), cookies, the rate limiter and the human check.
- `crypto/`: password hashing, TOTP, image checks.
- `db/entities/`: the schema as TypeORM sees it. `ports/`: the unit's public face. `consumers/` and `jobs/`: handlers of other units' events and scheduled work (`identity.jobs`: expires approvals, erases closed accounts, verifies the audit chain).

## Its ports (what other units may call)

`IDENTITY_QUERY`, `IDENTITY_COMMANDS`, `STAFF_QUERY`, `APPROVAL_SERVICE`, `AUDIT_SERVICE`, `RATE_LIMITER`, `FILE_VAULT`: see `ports/index.ts`. **Another unit never imports this unit's files or reads its tables** (DC-1); it asks a port, and when a change must happen together with one here the port is called in the caller's transaction (DC-13). ESLint and `src/import-boundaries.spec.ts` enforce it.

## Worth knowing

Sign-in answers the same for every failure so accounts cannot be probed (SEC-AUTH-05); the sign-in and staff cookies are separate (I-51).

## Tests

Unit tests are the `*.spec.ts` files beside the code. The API and database tests are in `backend/test/` (`api/`, `security/`, `concurrency/`) and need PostgreSQL and Redis ([docs/HOW-TO.md](../../../../docs/HOW-TO.md), "Run the integration suite"). A test is named after the requirement it proves.

## Adding to it

A new route: a controller method with a policy decorator, a DTO and a doc comment, then regenerate the API document ([docs/api/README.md](../../../../docs/api/README.md)). A new table: the design SQL first, then a migration. See [docs/HOW-TO.md](../../../../docs/HOW-TO.md).
