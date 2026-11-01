# TrustBazaar build progress

This file is the single record of what is being built, by whom, and what is finished. Read `BUILDING.md` first. Every pull request that starts, finishes or blocks a task updates this file in the same pull request. `python3 scripts/check_progress.py` checks it (CI runs it too).

**Status values:** `todo` · `doing` (owner and branch set) · `review` (pull request open) · `done` (pull request merged) · `blocked` (reason in Notes).

**Rules:** take tasks only when everything in *Needs* is `done` · one owner per task · do not edit another owner's `doing` row without asking · a design question goes to the Decisions log, never silently into code.

## Design status

| Item | Status |
|---|---|
| SRS v2.0 | done (update pending: P0-08) |
| SDD Unit 1: Identity & Access | done (draft for review) |
| SDD Unit 2: Order, Payment & Escrow | done (draft for review) |
| SDD Unit 3: Listings & Auctions | done (draft for review) |
| SDD Unit 4: Delivery & Handover | done (draft for review) |
| SDD Unit 5: Game-Account Escrow | done (draft for review) |
| SDD Unit 6: Chat & Notifications | done (draft for review) |
| SDD Unit 7: Disputes, Trust & Safety, Staff Tools | done (draft for review) |
| SDD Unit 8: Frontend | done (draft for review) |
| SDD Unit 9: Integration | done (draft for review) |

## P0: Setup (before any unit)

| ID | Task | Needs | Status | Owner | Branch / PR | Done | Notes |
|---|---|---|---|---|---|---|---|
| P0-01 | Merge `docs/srs-v2` into `main` (the design documents become the reference) | - | done | S. M. Nihal Ahmed | #33 | 2026-10-31 | No `docs/srs-v2` branch remained on the remote; `main` already held `docs/design/` (units 01 to 09, sql, web, crypto, deploy, integration) and `docs/srs.tex`, so no merge was needed. |
| P0-02 | Move the deployment files into place: `docs/design/deploy/docker-compose*.yml` to the root, `deploy/github/*` to `.github/` (replacing the old `ci.yml`, `codeql.yml`, `dependabot.yml`), `prod.env.example` next to `.env.example` | P0-01 | done | S. M. Nihal Ahmed | #35 | 2026-10-31 | Compose files are copied, not moved: `ci.yml` runs `docs/design/deploy/test_compose.py`, which reads the reference copies. |
| P0-03 | Repository settings: branch protection on `main`, one review by a non-author, required CI, secret scanning with push protection; add security paths to `CODEOWNERS` (SEC-SDL-01, SEC-SDL-05) | P0-01 | done | S. M. Nihal Ahmed | #58 | 2026-11-01 | Settings on (owner): `main` protected; 1 non-author approval with last-push approval and stale dismissal; admins included; no force push or deletion; conversation resolution; secret scanning with push protection; Dependabot. Required checks: `database`, `documents`, `reference-browser`, `lint-and-unit (backend)`, `lint-and-unit (frontend)`. `CODEOWNERS` in #58. |
| P0-04 | Restructure `backend/src` into `kernel/` and the seven unit modules of BUILDING.md section 3; remove the old stubs and `entities/`; ESLint import boundaries | P0-01 | done | S. M. Nihal Ahmed | #59 | 2026-10-31 | Skeleton only: each unit module and `ports/index.ts` are empty until the unit's tasks add ports; the other folders of BUILDING.md section 3 appear with the code that needs them. Also removes the unused `bcrypt` (SRS forbids it; Unit 1 uses Argon2id) and adds `tsconfig.build.json` so the build writes `dist/main.js`, the path the image runs. |
| P0-05 | Migrations: one TypeORM migration per `docs/design/sql/0N_*.sql` plus `09_integration.sql`; `src/migrate.ts` entry run as `tb_owner` (I-60) | P0-04 | done | S. M. Nihal Ahmed | #65 | 2026-11-01 | Each migration embeds a frozen copy of its design SQL file; later schema changes come as new migrations. In `src/migrations/`, see the Decisions log. |
| P0-06 | Test harness: Jest unit tests, integration tests against PostgreSQL 15 in CI, test names that start with the requirement ID (BUILDING.md section 6) | P0-04 | done | S. M. Nihal Ahmed | #70 | 2026-11-01 | New CI job `integration`, now a required check on `main`. `scripts/check_test_names.py` checks titles. Coverage gate for NFR-MNT-03 (see the Decisions log). |
| P0-07 | Restructure `frontend/` to the Unit 8 layout; copy `docs/design/web/src` to `frontend/src/lib` unchanged; four Vite entries | P0-01 | done | S. M. Nihal Ahmed | #61 | 2026-11-01 | Layout, four documents with placeholder entries (U8-01 builds the shell), ESLint 9 with the Unit 8 rules and Vitest. Removes the old pages, the `localStorage` token client and the development-server Dockerfile (replaced by `web.Dockerfile`). Vitest 4.1.12 is needed for `npm audit`; its lockfile entry was written with npm 11 because of an npm 10 resolver bug, and `npm ci` with npm 10.8 installs it. |
| P0-08 | SRS update: DV-1 to DV-67, DC-15 and the SRS clarifications of the integration register (does not block coding) | - | todo | | | | |
| P0-09 | Clear `npm audit --audit-level=high` in the backend while keeping NestJS 10 (C-1): npm `overrides` to the patched versions, each scoped to the package that needs it (SEC-SDL-04) | P0-04 | done | S. M. Nihal Ahmed | #63 | 2026-11-01 | Found when `lint-and-unit (backend)` first ran to the end (#61). |

## K: Shared kernel (with Unit 1)

Design: `docs/design/09_integration.pdf` (source `.tex` beside it).

| ID | Task | Needs | Status | Owner | Branch / PR | Done | Notes |
|---|---|---|---|---|---|---|---|
| K-01 | Configuration and secrets: read at start, at least 32 bytes, refuse `dev-only-` values in production (I-59, SEC-DAT-05) | P0-04 | done | S. M. Nihal Ahmed | #72 | 2026-11-01 | `config()` / `TB_CONFIG` in the kernel (global). Provider credentials are checked against `dev-only-` only; which ones a mode needs, and the SMS mode values, are for the units' adapters. |
| K-02 | JSON logging with correlation id, module and the redaction list (NFR-OBS-02, SEC-DAT-07) | P0-04 | todo | | | | |
| K-03 | Health endpoints `/api/v1/health/live` and `/ready` (NFR-OBS-01) | P0-04 | done | S. M. Nihal Ahmed | #67 | 2026-11-01 | Also adds the kernel's database connection (tb_app, never synchronised) and Redis client, and the `/api/v1` prefix (DC-3). U1-02 must give both routes the public policy. |
| K-04 | Outbox dispatcher for all seven outboxes, consumer registry, retries (DC-6, DV-67) | P0-05 | done | S. M. Nihal Ahmed | `feature/k-04-outbox-dispatcher`, #95 | 2026-11-01 | `kernel/events/`: `EventBus` (units register with `bus.on(event, consumer, handler)` when their module starts) and `OutboxDispatcher`. First consumer: Unit 7's parameter cache on `staff.config.published`. Outbox depth and age as metrics, and the alert on an outbox older than 5 minutes, are K-06; forwarding events to Socket.IO is K-07. |
| K-05 | Job runner: intervals with spread, `SKIP LOCKED` claims, run metrics (NFR-REL-03) | P0-05 | done | S. M. Nihal Ahmed | `feature/k-05-job-runner`, #97 | 2026-11-01 | `kernel/jobs/job-runner.ts`: `JobRunner.register({ name, intervalMs, run })` when a unit's module starts, and `forEachDue()` for the one-row-per-transaction `SKIP LOCKED` claim. Run statistics are kept for K-06's metrics. First jobs: Unit 1's proposal expiry (DV-5) and audit chain verification (SEC-LOG-02), daily; U1-09 adds erasure. |
| K-06 | Metrics on port 9464; graceful shutdown (NFR-OBS-03, DV-66) | K-02 | todo | | | | |
| K-07 | Socket.IO gateway with the Redis adapter; rooms `sid:`, `user:`, `auction:` (NFR-SCL-01) | P0-04 | todo | | | | The handshake must apply U1-02's session check (Unit 1 section 4.1: every WebSocket connection passes the same pipeline); an expired access token gets a distinct error (I-51 d). |

## U1: Identity & Access

Design: `docs/design/01_identity_access.pdf` (source `.tex` beside it).

| ID | Task | Needs | Status | Owner | Branch / PR | Done | Notes |
|---|---|---|---|---|---|---|---|
| U1-01 | Entities and repositories over `identity` and `audit`; the SQL tests run in CI | P0-05 | done | S. M. Nihal Ahmed | #74 | 2026-11-01 | 21 entities generated by `scripts/generate_entities.py` (reusable for U2-01 to U7-02); `test/db/identity-entities.spec.ts` checks them against the migrated schema. The SQL tests run in the `database` and `integration` jobs. |
| U1-02 | Security pipeline: RateLimitGuard, AuthGuard, CsrfGuard, PolicyGuard, StepUpGuard; problem+json errors (DC-3, DC-7) | U1-01, K-01 | done | S. M. Nihal Ahmed | #76 | 2026-11-01 | Policy decorators in `kernel/http/policies.ts`; guards in `modules/identity/security/`. Staff cookie names of I-51 (a) applied; staff refresh and `/staff/me` are U1-07. Design gaps in the Decisions log. |
| U1-03 | Registration with OTP and e-mail verification | U1-02 | done | S. M. Nihal Ahmed | `feature/u1-03-registration`, #83 | 2026-11-01 | Endpoints `/auth/register`, `/register/resend`, `/register/verify`, `/email/verify`. Also the password policy and bundled blocklist (U1-05 reuses `checkPassword` for changes and resets) and the OTP helpers (U1-05 reuses them for step-up, reset and phone change). |
| U1-04 | Sign-in, MFA, sessions, refresh rotation with reuse detection | U1-02 | done | S. M. Nihal Ahmed | `feature/u1-04-signin-sessions`, #78 | 2026-11-01 | Endpoints `/auth/signin`, `/signin/mfa`, `/refresh`, `/signout`, `/sessions`. Also: `AuditService.record` (writer only; U1-07 verifies the chain), field decryption for TOTP (U1-06 completes `IdentityCrypto`), the kernel's initial `ConfigPort`, the simulated `NotificationPort` (AS-4). `GET /me` (the client's refresh probe, I-51 c) is not here. |
| U1-05 | Step-up, password reset and change, contact changes | U1-04 | done | S. M. Nihal Ahmed | `feature/u1-05-stepup-password-contact`, #85 | 2026-11-01 | Endpoints `/auth/step-up/start` and `/verify`, `/auth/password/forgot`, `/reset`, `/change`, `/me/phone/change` and `/verify`, `/me/email/change` (its link uses `/auth/email/verify`). Shared: `OtpService` (SMS codes) and `SecondFactorService` (TOTP and recovery codes). |
| U1-06 | KYC submission and review; `FileVault`, `IdentityCrypto` (I-61) | U1-02 | done | S. M. Nihal Ahmed | `feature/u1-06-kyc`, #89 | 2026-11-01 | Endpoints `/kyc/status`, `/kyc/liveness-challenge`, `/kyc/submissions`, `/kyc/files/{kind}/view`, `/staff/kyc/queue`, `/staff/kyc/submissions/{id}` (claim, details, file view, decision), `/staff/users/{id}/kyc/revoke`, `/staff/blacklist` (add, remove), `/files/v/{token}`. Approval handlers `kyc.revoke`, `blacklist.add`, `blacklist.remove`. `FileVault` (purpose `kyc`) and `IdentityCrypto` are services here; U1-08 exports them as ports (I-31 adds the ownership-proof purpose). The advisory pre-check (FR-KYC-11, Could) is not built. |
| U1-07 | Staff accounts and sign-in (own cookies, I-51), approvals (four-eyes), audit log and chain verification | U1-02 | done | S. M. Nihal Ahmed | `feature/u1-07-staff-approvals-audit`, #87 | 2026-11-01 | Endpoints `/staff/auth/signin`, `/mfa`, `/mfa/enrol`, `/mfa/enrol/confirm`, `/refresh`, `/signout`, `/staff/me`, `/staff/approvals`, `/staff/conflicts`, `/admin/staff`, `/admin/audit`, `/admin/audit/verify`; the first administrator by `node dist/staff-bootstrap.js`. `ApprovalService` (handler registry; `expireStale()` for the job runner, K-05) and `StaffService.hasConflict` are exported by U1-08's ports. KYC review and blacklist endpoints are U1-06. |
| U1-08 | Ports: `IdentityQuery`, `IdentityCommands`, `StaffQuery`, `ApprovalService`, `AuditService`, `RateLimiter` | U1-06, U1-07 | done | S. M. Nihal Ahmed | `feature/u1-08-ports`, #91 | 2026-11-01 | `modules/identity/ports/index.ts`: the interfaces and their tokens (`IDENTITY_QUERY`, `IDENTITY_COMMANDS`, `STAFF_QUERY`, `APPROVAL_SERVICE`, `AUDIT_SERVICE`, `RATE_LIMITER`, `FILE_VAULT`, `IDENTITY_CRYPTO`), exported by `IdentityModule`; adapters in `services/identity-ports.ts`. Suspension and the four-eyes reinstatement (`account.reinstate`) are here. `assertCanTransact` still reads restrictions through the `RESTRICTIONS` stand-in until Unit 7's `SanctionPort` (I-43). |
| U1-09 | Closure and erasure job; human-verification challenge (SEC-ABU-02, I-64) | U1-08, K-05 | todo | | | | |
| U1-10 | API tests, including the negative authorisation tests of SEC-SDL-09 | U1-08 | todo | | | | |
| U1-11 | Shared security middleware: `helmet` headers on API responses (HSTS, CSP, `nosniff`, `Referrer-Policy`, `Permissions-Policy`) and the CORS allow-list (DC-11, SEC-WEB-01 to SEC-WEB-03); cookie parsing is done in U1-02 | U1-02 | todo | | | | Found in U1-02: DC-11 had no task. |
| U1-12 | MFA settings: TOTP enrolment and confirmation with recovery codes, turning MFA off, regenerating recovery codes (FR-ACC-06; `/me/mfa/*`) | U1-05 | todo | | | | Found in U1-05: these endpoints of Unit 1 section 4.2 had no task. |

**Integration notes this unit must apply** (they override the older text of its document where they differ):

- [x] I-7 (from Unit 1): Shared infrastructure first: The `security` and `audit` modules, and `ApprovalService`, should be implemented first, because every later unit imports them.
- [x] I-8 (from Unit 2): Port addition: `IdentityQuery.getPrincipal` should also return `verifiedAt` for the CP-27 limits, and Unit 1 should emit a fraud flag with `identity.account.suspended` so that ...
- [x] I-24 (from Unit 4): New `IdentityQuery.getApproxArea(userId)`. Add `HANDOVER_KEY` and the courier API and webhook secrets to the key table (Unit 1 Section 3).
- [ ] I-31 (from Unit 5): `FileVault` gains a purpose for ownership screenshots, on its own volume, with retention DV-39.
- [ ] I-36 (from Unit 6): `NotificationPort` is implemented here; OTP rate limits stay in Unit 1.
- [ ] I-43 (from Unit 7): `assertCanTransact` must call `SanctionPort.restrictions` (selling, or buying and bidding).
- [ ] I-51 (from Unit 8): (a) Staff sessions use their own cookies, for example `__Host-tb_sat`, `__Host-tb_scsrf` and `__Secure-tb_srt` on `/api/v1/staff/auth/refresh`, with `POST /staff/auth/refresh` ...
- [x] I-59 (from Unit 9): Shared kernel: The backend refuses to start in production if a secret is missing, is shorter than 32 bytes or starts with `dev-only-`.
- [x] I-60 (from Unit 9): All units: One TypeORM migration per design SQL file, in unit order, then `09_integration.sql`.
- [x] I-61 (from Unit 9): Implement `FileVault`, `IdentityCrypto` and `StaffQuery` (Unit 1) and `ListingsQueries` (Unit 3) as declared in Section .
- [ ] I-64 (from Unit 9): The human-verification challenge of SEC-ABU-02: Unit 1 issues and checks it and answers `428`; Unit 8 solves it in a Web Worker.

## U2: Order, Payment & Escrow

Design: `docs/design/02_orders_payments.pdf` (source `.tex` beside it).

| ID | Task | Needs | Status | Owner | Branch / PR | Done | Notes |
|---|---|---|---|---|---|---|---|
| U2-01 | Entities over `orders` and `payments`; the SQL tests run in CI | P0-05 | done | S. M. Nihal Ahmed | `feature/u2-01-entities`, #99 | 2026-11-01 | 18 entities generated by `scripts/generate_entities.py --schemas orders,payments` (named `OrdersOutboxEvent`, `PaymentAttempt`, `PaymentProviderEvent` where the table name alone is ambiguous); `test/db/orders-entities.spec.ts` checks them against the migrated schema through the shared `test/support/entity-check.ts`. The design's `02_orders_payments` SQL tests already run in the `database` and `integration` jobs (since U1-01). |
| U2-02 | Checkout and order creation with idempotency keys (I-52) | U2-01, U1-08 | todo | | | | |
| U2-03 | Provider adapters: mock, bKash, Nagad, Stripe (sandbox); verified confirmation; webhooks | U2-02 | todo | | | | |
| U2-04 | Escrow commands and queries, including `lockForFulfilment` (DC-14) and the dispute calls | U2-02 | todo | | | | |
| U2-05 | Release, refunds, payouts, payout accounts (step-up) | U2-04 | todo | | | | |
| U2-06 | Ledger, settlement, monetization | U2-05 | todo | | | | |
| U2-07 | Jobs: payment expiry, fulfilment deadline, auto-release, reconciliation, workers | U2-04, K-05 | todo | | | | |
| U2-08 | Concurrency tests: AC-2 checkout race, AC-3, AC-4 webhook replay | U2-07 | todo | | | | |

**Integration notes this unit must apply** (they override the older text of its document where they differ):

- [ ] I-2 (from Unit 1): Pro Seller status belongs to the Monetization part of the Order unit; `IdentityQuery` does not expose it.
- [ ] I-14 (from Unit 3): `ListingsPort` is implemented by `listings.reserve`, `release` and `mark_sold`.
- [ ] I-19 (from Unit 4): `orders.order.paid` payload: It must carry the fulfilment method, buyer, seller, `fulfilment_due_at` and the delivery quote id.
- [ ] I-20 (from Unit 4): `OrdersPort.lockForFulfilment(orderId, tx)`: New. Locks the order row and returns its status, fulfilment, parties, deadline and whether the step or delivery event is recorded ...
- [ ] I-21 (from Unit 4): Quotes and courier costs: `DeliveryPort.getQuote` becomes `claimQuote`, which also checks quantity and allows one use.
- [ ] I-22 (from Unit 4): Fulfilment job: Before refunding a courier order for a missed pickup, it calls `DeliveryPort.syncPickup` outside its lock.
- [ ] I-29 (from Unit 5): `GameAccountPort.assertCheckoutReady` is `checkout_ready` plus the CP-36 check.
- [ ] I-37 (from Unit 6): Call `BlockPort.assertNotBlocked` when creating an order and when accepting a second-chance offer (FR-CHT-08).
- [ ] I-44 (from Unit 7): The refund event at a missed fulfilment deadline must carry its reason, so it can count as a strike.
- [ ] I-52 (from Unit 8): Idempotency keys on `POST /orders` and `/orders/{id}/payments`. `GET /orders/{id}` returns every field `describeMoney` reads: status, escrow state, release policy, total, ...
- [x] I-60 (from Unit 9): All units: One TypeORM migration per design SQL file, in unit order, then `09_integration.sql`.
- [ ] I-63 (from Unit 9): Retention jobs: the credential-access log after 2 years and ownership screenshots under DV-39 (Unit 5); dispute statements and evidence files 2 years after the decision (Unit ...

## U3: Listings & Auctions

Design: `docs/design/03_listings_auctions.pdf` (source `.tex` beside it).

| ID | Task | Needs | Status | Owner | Branch / PR | Done | Notes |
|---|---|---|---|---|---|---|---|
| U3-01 | Entities over `listings` and `auctions`; the SQL tests run in CI | P0-05 | done | S. M. Nihal Ahmed | `feature/u3-01-entities`, #102 | 2026-11-01 | 14 entities generated by `scripts/generate_entities.py --schemas listings,auctions` (named `AuctionsOutboxEvent`, `AuctionFlag`, `AuctionStrike`, `ListingStatusChange`, `Bid`, `BidderAlias` where the table name alone is ambiguous); `test/db/listings-entities.spec.ts` checks them. The design's `03_listings_auctions` SQL tests already run in CI. |
| U3-02 | Listings: create, photos, screening, publish, review; `ListingsPort` (reserve, release, sold) | U3-01, U1-08 | todo | | | | |
| U3-03 | Search with filters and cursor pages | U3-02 | todo | | | | |
| U3-04 | Bid engine: `place_bid`, proxy bidding, anti-sniping, idempotency (I-53) | U3-02, K-07 | todo | | | | |
| U3-05 | Auction closer, award, second-chance offers | U3-04, U2-02, K-05 | todo | | | | |
| U3-06 | Shill signals; staff actions on listings, bids and auctions; `ListingsQueries` (I-61) | U3-04 | todo | | | | |
| U3-07 | Concurrency tests: AC-1 bids, last-unit reservation | U3-05 | todo | | | | |

**Integration notes this unit must apply** (they override the older text of its document where they differ):

- [ ] I-1 (from Unit 1): User location: The saved approximate location is stored here. The Listings unit decides whether each listing copies it (FR-LST-06).
- [ ] I-9 (from Unit 2): Listings must provide `reserve` and `release` as single conditional updates (DC-13), mark units sold on `order.paid` and release them on `order.cancelled`.
- [ ] I-23 (from Unit 4): New `ListingsQueries.fulfilmentFacts(listingId)`. The listing form, and a constraint added to `listings.listings`, should refuse courier options for the `over_10kg` weight ...
- [ ] I-30 (from Unit 5): Publish `listings.listing.cancelled` as well, so a claim can be released.
- [ ] I-38 (from Unit 6): Call `BlockPort.assertNotBlocked` in `BidService` before `auctions.place_bid`.
- [ ] I-45 (from Unit 7): Publish `listings.listing.relisting_flagged`. Hide and show a user's listings also on `trust.sanction.applied` and `.lifted` for selling and account suspensions.
- [ ] I-53 (from Unit 8): Idempotency keys on `POST /auctions/{id}/bids` and `POST /listings`. A bid's answer carries the new state with `seq` and `serverTime`.
- [x] I-60 (from Unit 9): All units: One TypeORM migration per design SQL file, in unit order, then `09_integration.sql`.
- [ ] I-61 (from Unit 9): Implement `FileVault`, `IdentityCrypto` and `StaffQuery` (Unit 1) and `ListingsQueries` (Unit 3) as declared in Section .
- [ ] I-62 (from Unit 9): Publish `listings.listing.cancelled` and `listings.listing.relisting_flagged` (Unit 3) and `delivery.issue.opened` (Unit 4); list `chat.message.flagged` among Unit 6's events.

## U4: Delivery & Handover

Design: `docs/design/04_delivery.pdf` (source `.tex` beside it).

| ID | Task | Needs | Status | Owner | Branch / PR | Done | Notes |
|---|---|---|---|---|---|---|---|
| U4-01 | Entities over `delivery`; the SQL tests and concurrency script run in CI | P0-05 | done | S. M. Nihal Ahmed | `feature/u4-01-entities`, #104 | 2026-11-01 | 14 entities generated by `scripts/generate_entities.py --schemas delivery` (named `DeliveryOutboxEvent`, `CourierProviderEvent`, `DeliveryIssue`, `HandoverCodeEntry`, `ShipmentStatusChange` where the table name alone is ambiguous); `test/db/delivery-entities.spec.ts` checks them. The design's `04_delivery` SQL tests and `04_delivery_concurrency.sh` already run in CI (database job). |
| U4-02 | Areas, fares, binding quotes; saved addresses (encrypted) | U4-01, U3-06 | todo | | | | |
| U4-03 | Meetup proposals and the handover code | U4-02, U2-04 | todo | | | | |
| U4-04 | Courier adapter (mock first), shipments, status, returns | U4-02, U2-04 | todo | | | | |
| U4-05 | Jobs: booking, status reconciliation, proposal lapse, retention | U4-04, K-05 | todo | | | | |

**Integration notes this unit must apply** (they override the older text of its document where they differ):

- [ ] I-10 (from Unit 2): Delivery issues quotes bound to buyer, listing and expiry, and reports pickup, handover code, delivered and returned through `EscrowCommands`.
- [ ] I-39 (from Unit 6): Their events already carry the deadlines (meetup, pickup, credential delivery, takeover window, re-key); this unit schedules and cancels reminders from them.
- [ ] I-46 (from Unit 7): Publish `delivery.issue.opened`, so delivery issues appear as signals in the flagged-activity queue rather than a queue of their own.
- [ ] I-54 (from Unit 8): The handover answer includes the code attempts left. The credential screens are routes under `/secure/orders/{id}/`, served by `secure.html`, which imports `sealed.js` ...
- [x] I-60 (from Unit 9): All units: One TypeORM migration per design SQL file, in unit order, then `09_integration.sql`.
- [ ] I-62 (from Unit 9): Publish `listings.listing.cancelled` and `listings.listing.relisting_flagged` (Unit 3) and `delivery.issue.opened` (Unit 4); list `chat.message.flagged` among Unit 6's events.

## U5: Game-Account Escrow

Design: `docs/design/05_game_accounts.pdf` (source `.tex` beside it).

| ID | Task | Needs | Status | Owner | Branch / PR | Done | Notes |
|---|---|---|---|---|---|---|---|
| U5-01 | Entities over `game_accounts`; the SQL tests and concurrency script run in CI | P0-05 | review | S. M. Nihal Ahmed | `feature/u5-01-entities`, #106 | | 10 entities generated by `scripts/generate_entities.py --schemas game_accounts` (named `GameAccountsOutboxEvent`, `CredentialHandover`, `GameAccountDetail`, `PlayerIdClaim`, `CredentialAccess`, `TakeoverConfirmation` where the table name alone is ambiguous); `test/db/game-accounts-entities.spec.ts` checks them. The design's `05_game_accounts` SQL tests and `05_game_accounts_concurrency.sh` already run in CI (database job). |
| U5-02 | Games catalogue, game details, ownership proof and review | U5-01, U3-02 | todo | | | | |
| U5-03 | Sealed handover: buyer keys, sealed credentials, retrieval log (with `sealed.js`) | U5-02, U2-04 | todo | | | | |
| U5-04 | Takeover checklist, protection period, re-key, report invalid | U5-03 | todo | | | | |
| U5-05 | Jobs: takeover end, overdue re-key, proof expiry, retention (I-63) | U5-04, K-05 | todo | | | | |

**Integration notes this unit must apply** (they override the older text of its document where they differ):

- [ ] I-11 (from Unit 2): Game-Account reports credential delivery and takeover completion, and exposes `assertCheckoutReady`.
- [ ] I-15 (from Unit 3): adds its game-account details table with a foreign key to `listings.listings` (allowed by DC-5), and approves listings through `ListingsCommands`.
- [ ] I-39 (from Unit 6): Their events already carry the deadlines (meetup, pickup, credential delivery, takeover window, re-key); this unit schedules and cancels reminders from them.
- [ ] I-47 (from Unit 7): `DisputeCommands.open` is implemented as designed, for the `credentials_invalid` report and the overdue re-key (`opened_by = system`).
- [ ] I-54 (from Unit 8): The handover answer includes the code attempts left. The credential screens are routes under `/secure/orders/{id}/`, served by `secure.html`, which imports `sealed.js` ...
- [x] I-60 (from Unit 9): All units: One TypeORM migration per design SQL file, in unit order, then `09_integration.sql`.
- [ ] I-63 (from Unit 9): Retention jobs: the credential-access log after 2 years and ownership screenshots under DV-39 (Unit 5); dispute statements and evidence files 2 years after the decision (Unit ...

## U6: Chat & Notifications

Design: `docs/design/06_chat_notifications.pdf` (source `.tex` beside it).

| ID | Task | Needs | Status | Owner | Branch / PR | Done | Notes |
|---|---|---|---|---|---|---|---|
| U6-01 | Entities over `chat` and `notify`; the SQL tests and concurrency script run in CI | P0-05 | doing | S. M. Nihal Ahmed | `feature/u6-01-entities` | | 15 entities generated by `scripts/generate_entities.py --schemas chat,notify` (named `ChatOutboxEvent`, `UserBlock`, `ChatMessage`, `ChatThread`, `ChatStaffAccess`, `NotificationDelivery`, `NotificationPreference`, `NotificationTemplate`, `ListingWatch`, `SmsLogEntry` where the table name alone is ambiguous); `test/db/chat-entities.spec.ts` checks them. The design's `06_chat_notifications` SQL tests and `06_chat_notifications_concurrency.sh` already run in CI (database job). |
| U6-02 | Chat threads, messages, resync, images, detection warnings, blocks | U6-01, K-07 | todo | | | | |
| U6-03 | Reports and holds; staff read through a held case | U6-02 | todo | | | | |
| U6-04 | Notifications from events; templates in both languages; preferences | U6-01, K-04 | todo | | | | |
| U6-05 | E-mail and SMS adapters (log mode first), delivery worker, reminders, retention | U6-04, K-05 | todo | | | | |

**Integration notes this unit must apply** (they override the older text of its document where they differ):

- [ ] I-3 (from Unit 1): Message templates and their Bangla and English texts belong to the Notifications unit; this unit supplies event data only.
- [ ] I-16 (from Unit 3): delivers `auctions.bid.outbid` and the ending-soon notices (FR-NTF-02).
- [ ] I-25 (from Unit 4): delivers the meetup, handover, lock and shipment notifications, and the deadline reminders (FR-NTF-07).
- [ ] I-32 (from Unit 5): Notify the seller when credentials are requested and the buyer when they are delivered, and remind both at CP-38 before the credential deadline, the window end and the ...
- [ ] I-48 (from Unit 7): Holds are placed when a dispute opens or a report concerns a thread, and released on decision, withdrawal or resolution.
- [ ] I-55 (from Unit 8): `notification.new` names the object it concerns (for example the order id), so the client refreshes exactly that data.
- [x] I-60 (from Unit 9): All units: One TypeORM migration per design SQL file, in unit order, then `09_integration.sql`.
- [ ] I-62 (from Unit 9): Publish `listings.listing.cancelled` and `listings.listing.relisting_flagged` (Unit 3) and `delivery.issue.opened` (Unit 4); list `chat.message.flagged` among Unit 6's events.

## U7: Disputes, Trust & Safety, Staff Tools

Design: `docs/design/07_disputes_trust_staff.pdf` (source `.tex` beside it).

| ID | Task | Needs | Status | Owner | Branch / PR | Done | Notes |
|---|---|---|---|---|---|---|---|
| U7-01 | `ConfigPort` over `staff` parameter versions (needed early by every unit) | P0-05 | done | S. M. Nihal Ahmed | `feature/u7-01-config-port`, #93 | 2026-11-01 | `ConfigService` in `modules/trust/services/`, provided to every unit as `CONFIG_PORT` by the global `ConfigPortModule`; the interface stays in `kernel/config-port.ts`. Administrators' API: `/admin/config` (current set, versions, validate, publish, four-eyes proposals). The refresh on `staff.config.published` comes with the outbox dispatcher (K-04); until then the 60-second refresh applies. |
| U7-02 | Entities over `disputes`, `trust`, `staff`; the SQL tests and concurrency script run in CI | P0-05 | todo | | | | |
| U7-03 | Disputes: open, respond, case file, decide (four-eyes), withdraw, refund after return | U7-02, U2-04, U4-04, U5-04, U6-03 | todo | | | | |
| U7-04 | Reports, signals, sanctions, strikes; `SanctionPort` | U7-02, U1-08 | todo | | | | |
| U7-05 | Ratings and the profile summary | U7-02, U2-04 | todo | | | | |
| U7-06 | Staff queues and actions; parameter editor and switches | U7-04, U1-07 | todo | | | | |
| U7-07 | Data export and lawful disclosure; jobs; retention (I-63) | U7-03, K-05 | todo | | | | |

**Integration notes this unit must apply** (they override the older text of its document where they differ):

- [x] I-4 (from Unit 1): Parameter store: `ConfigPort` moves from environment configuration to the Staff Tools unit's versioned store (FR-OPS-08) without changing callers.
- [ ] I-5 (from Unit 1): Lost MFA and recovery codes: An operator-assisted re-verification procedure is to be designed in the Staff Tools unit.
- [ ] I-12 (from Unit 2): Disputes owns dispute windows by type, four-eyes approval of large outcomes, and the return shipment for "refund after return".
- [ ] I-17 (from Unit 3): hosts the queues for listings in review, flags and voids, using this unit's staff endpoints.
- [ ] I-26 (from Unit 4): hosts the delivery issue queue and the unlock action. It uses `fulfilmentRecord` in the case file (FR-DSP-05), `notReceivedAllowed` for `not_received` disputes, and ...
- [ ] I-33 (from Unit 5): The ownership-proof queue (FR-OPS-01) calls `reviewProof`. A `credentials_invalid` dispute is opened in the same transaction as the report, and also when a re-key is overdue.
- [ ] I-40 (from Unit 6): Use `ChatCommands.hold` and `release` for every dispute and report that concerns a thread, and `chat.staff_read` in the case file (FR-DSP-05).
- [ ] I-56 (from Unit 8): The dispute form needs the types that may be opened now: `GET /orders/{id}/dispute-types` answers from the owning units' checks.
- [x] I-60 (from Unit 9): All units: One TypeORM migration per design SQL file, in unit order, then `09_integration.sql`.
- [ ] I-63 (from Unit 9): Retention jobs: the credential-access log after 2 years and ownership screenshots under DV-39 (Unit 5); dispute statements and evidence files 2 years after the decision (Unit ...

## U8: Frontend

Design: `docs/design/08_frontend.pdf` (source `.tex` beside it).

| ID | Task | Needs | Status | Owner | Branch / PR | Done | Notes |
|---|---|---|---|---|---|---|---|
| U8-01 | App shell, router, the four entries, `lib/` wired in, language switch | P0-07 | todo | | | | |
| U8-02 | Account and sign-in screens | U8-01, U1-05 | todo | | | | |
| U8-03 | KYC wizard (`kyc.html`) | U8-01, U1-06 | todo | | | | |
| U8-04 | Listings, search and the auction panel | U8-01, U3-04 | todo | | | | |
| U8-05 | Checkout and payment return | U8-04, U2-03 | todo | | | | |
| U8-06 | Order view, handover code, shipments | U8-05, U4-03 | todo | | | | |
| U8-07 | Game-account screens (`secure.html`) | U8-06, U5-04 | todo | | | | |
| U8-08 | Chat and notification centre | U8-01, U6-04 | todo | | | | |
| U8-09 | Disputes, ratings, seller dashboard, privacy screens | U8-06, U7-05 | todo | | | | |
| U8-10 | Staff console (`staff.html`) | U8-01, U7-06 | todo | | | | |
| U8-11 | End-to-end, accessibility, 360 and 320 pixel, Lighthouse runs | U8-09, U8-10 | todo | | | | |

**Integration notes this unit must apply** (they override the older text of its document where they differ):

- [ ] I-27 (from Unit 4): (frontend) shows the code screen with its instruction, the seller's entry screen with the "hand over only after" instruction, a "simulated" banner on every mock shipment, and ...
- [ ] I-34 (from Unit 5): Screens of IF-UI-06 use `sealed.js`; check Web Crypto and IndexedDB before purchase (AS-5); warn the buyer to stay in the same browser; follow the strict-page rules of the ...
- [ ] I-41 (from Unit 6): Render chat as text only; give every message a client id; resync after reconnects and gaps; show the warnings on flagged messages to both parties; offer block and report on ...
- [ ] I-49 (from Unit 7): The staff console: the eight queues with ages; claim; the case file with masked data; the decision form with the outcome preview and the four-eyes notice; the parameter editor ...
- [ ] I-64 (from Unit 9): The human-verification challenge of SEC-ABU-02: Unit 1 issues and checks it and answers `428`; Unit 8 solves it in a Web Worker.
- [ ] I-65 (from Unit 9): The Socket.IO client connects with `transports: ['websocket']`, so no sticky sessions are needed with several backend instances.

## U9: Integration and release

Design: `docs/design/09_integration.pdf` (source `.tex` beside it).

| ID | Task | Needs | Status | Owner | Branch / PR | Done | Notes |
|---|---|---|---|---|---|---|---|
| U9-01 | `docker compose up --wait` in CI; images scanned; SBOM | P0-02, U1-02 | todo | | | | |
| U9-02 | API security tests for the 47 SEC requirements still untested (Unit 9, section 7.4) | U7-06 | todo | | | | |
| U9-03 | Reference load test NFR-PERF-01 with k6; acceptance criteria rechecked | U8-11 | todo | | | | |
| U9-04 | ZAP baseline and triage; ASVS 5.0 checklist (SEC-GEN-01) | U9-01 | todo | | | | |
| U9-05 | Backup and restore rehearsal; incident procedure in `SECURITY.md` | U9-01 | todo | | | | |
| U9-06 | Release for the demonstration | U9-02, U9-03, U9-04, U9-05 | todo | | | | |

**Integration notes this unit must apply** (they override the older text of its document where they differ):

- [ ] I-57 (from Unit 8): The web container is the two-stage Dockerfile with the reference nginx configuration, and its health check is `/healthz`.

## Decisions log

Any change to the design made while building: what, why, who agreed, and which document must be updated.

| Date | Task | Decision | Agreed by | Document to update |
|---|---|---|---|---|
| 2026-10-31 | P0-02 | CI `reference-browser`: run `apt-get update` before `apt-get install -y nginx-light`; without it the runner's stale package index asks for a version the mirror no longer has (404). Applied to `.github/workflows/ci.yml` and the reference `docs/design/deploy/github/workflows/ci.yml`. | S. M. Nihal Ahmed; reviewer of #35 | Unit 9 (`09_integration.tex`) if it quotes the CI steps |
| 2026-10-31 | P0-03 | `CODEOWNERS`: the security paths (`identity/`, `orders/`, `game-accounts/`) are owned by all three team members (any one non-author approval suffices); the old `* @nihal4` rule is removed, since the branch rule already requires a non-author review on every PR. `/.github/` is added to the security paths so CI and `CODEOWNERS` cannot be weakened by an ordinary review. | S. M. Nihal Ahmed; reviewer of the P0-03 PR | Unit 9 (`09_integration.tex`, repository settings): name `.github/` among the security-reviewed paths |
| 2026-11-01 | P0-05 | (Proposed) Migrations live in `backend/src/migrations/`, not `backend/migrations/` as BUILDING.md section 3 draws: the backend image ships only `dist/`, and a folder outside `src/` would either be missing from it or move the build output to `dist/src/`, breaking `node dist/main.js` and `node dist/migrate.js`. Each migration embeds a frozen copy of its design SQL file; a later change to a design file is a new migration, never an edit of an applied one. | S. M. Nihal Ahmed; reviewer of the P0-05 PR | BUILDING.md section 3 (backend tree; the "Schema changes" note in section 4) |
| 2026-11-01 | P0-05 | `deploy/postgres/init/01_roles.sh` grants `USAGE ON SCHEMA public TO tb_app`. The script revoked all access to `public` from PUBLIC, but `citext`, `pgcrypto` and `pg_trgm` live there, so `tb_app` could not resolve them by name: inserting into `audit.events` failed (the chain trigger's `digest()`), `citext` comparisons silently became case-sensitive, and `01_identity_access_tests.sql` failed on a database set up like the container. USAGE only, so `tb_app` still cannot create objects in `public`. `test_accounts.sh` gains two checks that fail without the grant. | S. M. Nihal Ahmed; reviewer of the P0-05 PR | Unit 9 (`09_integration.tex`, deployment: accounts of SEC-INF-03) |
| 2026-11-01 | P0-05 | `09_integration_checks.sql` exempts the migration tool's bookkeeping table `public.migrations` (with its key and sequence) from "nothing of the design is in the public schema". A stray table in `public` still fails the check. | S. M. Nihal Ahmed; reviewer of the P0-05 PR | Unit 9 (`09_integration.tex`, the integration checks) |
| 2026-11-01 | P0-06 | CI gains an `integration` job: PostgreSQL 15 and Redis 7; the container's init script; the migrations as `tb_owner` (a second run must apply nothing); the design's SQL tests and integration checks on that migrated database; then `npm run test:integration` as `tb_app`. The `database` job loads the SQL as a superuser with `public` open and could not catch the P0-05 access bug; this job can. The `documents` job also runs `scripts/check_test_names.py`. Applied to `.github/workflows/ci.yml` and its reference copy. | S. M. Nihal Ahmed; reviewer of the P0-06 PR | Unit 9 (`09_integration.tex`, section 7.1, the pipeline table) |
| 2026-11-01 | P0-06 | NFR-MNT-03's 70% line coverage is enforced by `backend/test/tools/coverage-gate.ts` (run as `posttest` after `npm test -- --coverage`), not by Jest's `coverageThreshold`: Jest fails a threshold for a module that has no code yet, which every gated module is today. The gate applies from a module's first measured line; wiring files (`*.module.ts`, `ports/index.ts`) and migrations are not measured. | S. M. Nihal Ahmed; reviewer of the P0-06 PR | Unit 9 (`09_integration.tex`, section 7.1: "coverage thresholds ... in the test configuration") |
| 2026-11-01 | U1-02 | Problem types are relative URIs, `/problems/<name>` (RFC 9457 allows them); the design asks for a stable `type` but names no base. The web client's `/step-up-required` check works with them. | S. M. Nihal Ahmed; reviewer of the U1-02 PR | Unit 1 section 2 (DC-3) |
| 2026-11-01 | U1-02 | The policy decorators (`@Public`, `@SignedIn`, `@Verified`, `@Staff`, `@StepUp`, `@RateLimit`, `@Credential`) and the `Principal` type live in the kernel (`kernel/http/`), as metadata only; Unit 1's guards enforce them. The kernel's own routes need `@Public`, and every unit declares policies, without importing Unit 1's internals (DC-1). | S. M. Nihal Ahmed; reviewer of the U1-02 PR | Unit 1 sections 3.2 and 4.1 (the `security` module); BUILDING.md section 3 |
| 2026-11-01 | U1-02 | The non-session policies of the API tables (MFA ticket, refresh cookie, pending staff, signed link, signed state, provider or Stripe signature) are `@Credential(kind)`: the pipeline lets them through and the endpoint's service verifies the credential. Signed state and provider signature are cross-site and skip the Origin and CSRF checks. Ownership policies (Seller, Buyer, Participant, Assigned operator, ...) are service checks; the route declares `@SignedIn` or `@Staff`. | S. M. Nihal Ahmed; reviewer of the U1-02 PR | Unit 1 section 4.1 (policy table) |
| 2026-11-01 | U1-02 | (Proposed) Until Unit 7's `ConfigPort` (U7-01) serves parameters, the CP-35 limit (`search`) uses its SRS default, 60 per minute per address; U7-01 makes `RATE_RULES` read CP values. Likewise `@Verified(action)` checks restrictions through a `RESTRICTIONS` port that answers "none" until Unit 7's `SanctionPort` replaces it (I-43). | S. M. Nihal Ahmed; reviewer of the U1-02 PR | Unit 1 section 5.4; Unit 7 (U7-01, I-43) |
| 2026-11-01 | U1-02 | (Proposed) The rate limiter allows a request when Redis cannot be reached, and logs it: Redis holds only reconstructible data (NFR-REL-01), and OTP attempt limits are also enforced in PostgreSQL. Per-principal limits identify the principal from the access token's signature alone, so RateLimitGuard can stay first, before any database read. Access-token key ids are `v<n>`. | S. M. Nihal Ahmed; reviewer of the U1-02 PR | Unit 1 sections 5.4 and 7.1 |
| 2026-11-01 | U1-04 | `ConfigPort` is a kernel provider (`CONFIG_PORT`) that, as Unit 1 section 4.5 says ("initially environment configuration"), answers the SRS defaults of the parameters used so far (CP-01 to CP-04, CP-35) as version 0. U7-01 rebinds `CONFIG_PORT` to Unit 7's versioned store. | S. M. Nihal Ahmed; reviewer of the U1-04 PR | Unit 7 (U7-01) |
| 2026-11-01 | U1-04 | Pieces of later Unit 1 tasks that sign-in needs now: `AuditService.record` (the writer; U1-07 keeps chain verification and the port) and field encryption (`encryptField`/`decryptField`, AES-256-GCM with the table, column and row as associated data; the AES key is SHA-256 of `FIELD_KEY_Vn`). U1-06 completes `IdentityCrypto` around them. | S. M. Nihal Ahmed; reviewer of the U1-04 PR | Unit 1 section 5.5 (key derivation) |
| 2026-11-01 | U1-04 | Sign-in throttling (SEC-AUTH-04) is keyed by a hash of the normalised login, not the user id, so an unknown account is throttled exactly like a real one (SEC-AUTH-05); a throttled attempt answers 429 with `Retry-After`. Failures answer `/problems/signin-failed` (401), wrong second factors `/problems/mfa-failed` (401), and a refresh within DV-4 `/problems/refresh-retry` (409). Five wrong codes end an MFA ticket (CP-05 per challenge). Recovery codes compare ignoring case, spaces and hyphens. | S. M. Nihal Ahmed; reviewer of the U1-04 PR | Unit 1 sections 4.2 and 6.2 |
| 2026-11-01 | U1-04 | Open question: `sessions.approx_location` (FR-ACC-08, "approximate location") stays empty; the design names no source for it (an IP geolocation database would be one). The session list shows the device instead. | open | Unit 1 section 6.2 |
| 2026-11-01 | U1-04 | `deploy/backend.Dockerfile`: the build stage installs `python3 make g++` and compiles native modules from source (`npm_config_build_from_source=true`), because argon2's bundled musl prebuild crashes on Alpine 3.23. The compilers stay in the build stage; the runtime image has none. The runtime images also run `apk upgrade`, and the backend runtime drops npm, npx, yarn and corepack (it only runs `node`), because the image scan failed on Alpine's OpenSSL and on npm's own bundled packages. Every cookie call also states `secure: true` explicitly so CodeQL can see it (it was already set through the shared options). | S. M. Nihal Ahmed; reviewer of the U1-04 PR | Unit 9 (backend image) |
| 2026-11-01 | U1-03 | The blocklist of SEC-AUTH-02 (the design names no source) is SecLists' `100k-most-used-passwords-NCSC.txt` (MIT licence), keeping the entries of 8 or more characters, lower-cased: `modules/identity/crypto/common-passwords.txt`, copied into `dist` by `nest-cli.json`. Context words: "trustbazaar", and the person's name parts, number and e-mail name of 4 or more characters. | S. M. Nihal Ahmed; reviewer of the U1-03 PR | Unit 1 section 6.1 |
| 2026-11-01 | U1-03 | The current terms and privacy versions (FR-ACC-04; the design names no source) come from `TERMS_VERSION` and `PRIVACY_VERSION` (default `2026-11-01`); registration with any other version is refused with `validation-failed`. | S. M. Nihal Ahmed; reviewer of the U1-03 PR | Unit 1 section 6.1 |
| 2026-11-01 | U1-03 | Registration details the design leaves open: the 202 answer is `{registrationId, resendAt}`, with a 60-second gap between sends to one number (on top of CP-05's 3 per hour and 10 per day; a send too early is 429 with `Retry-After`). For a number that already has an open account, a challenge is still created, with a code that is never sent, so every later answer (wrong code, expiry, resend) is the same as for a new number; its owner is told once. The newest challenge of a registration is the only valid one. Code entries are also limited to 20 per number per hour (CP-05's per-account limit, before an account exists). | S. M. Nihal Ahmed; reviewer of the U1-03 PR | Unit 1 section 6.1 |
| 2026-11-01 | U1-03 | The e-mail verification link is sent through `NotificationPort.sendEmail` right after the account is created, not through the outbox, so the raw token is never stored (only its SHA-256). The link is `PUBLIC_ORIGIN/verify-email#token=...`; Unit 8 adds that page, which posts the token to `/auth/email/verify`. `identity.user.registered` carries only the user id. New problem types: `otp-failed` (400), `otp-expired` (410), `link-invalid` (410), `password-rejected` (422, with the reason), `registration-refused` (409). Audit actions: `identity.account.registered`, `identity.email.verified`. | S. M. Nihal Ahmed; reviewer of the U1-03 PR | Unit 1 sections 4.2 and 6.1; Unit 8 (route) |
| 2026-11-01 | U1-05 | Step-up answers the design leaves open: `start` returns `{method: 'totp'}` (nothing sent) or `{method: 'sms', resendAt}`; `verify` returns `{grant, expiresInSeconds}`, and a TOTP user may also use a recovery code. The SMS code is bound to the session and the action. Code entries count towards CP-05's 20 per account per hour. Audit: `identity.step_up.granted` and `.failed`. | S. M. Nihal Ahmed; reviewer of the U1-05 PR | Unit 1 section 6.3 |
| 2026-11-01 | U1-05 | Password reset: a link is sent only to a verified e-mail (FR-ACC-07 says "the verified e-mail"); the link is `PUBLIC_ORIGIN/reset-password#token=...` (a Unit 8 page). The reset limit of 3 per account per hour, and CP-05's send limits, drop the message silently, so the answer stays 202. The new password is checked first, then the proof is spent, then (MFA on) the second factor; if that is missing (`mfa-required`, 403) or wrong, nothing is spent and the link or code still works. A wrong code and an unknown number both answer `otp-failed`. A reset also clears the CP-04 sign-in delay (Unit 1 section 6.2). `identity.password.changed` carries `{userId, via: 'reset' or 'change'}`. A change needs the current password (`password-incorrect`, 400) and refuses the same password again. | S. M. Nihal Ahmed; reviewer of the U1-05 PR | Unit 1 section 6.4; Unit 8 (route) |
| 2026-11-01 | U1-05 | Contact changes: the notice to the old number or address is sent directly through `NotificationPort`, because after the change the account no longer holds it; `identity.contact.changed` carries only `{userId, kind}`. The phone code is bound to the session; asking again needs a new step-up. A number held by another open account is handled as at registration (a code made but not sent, the owner told, the same 202). An e-mail change link is used through `/auth/email/verify` (page `/verify-email`), and any e-mail change ends the account's earlier e-mail links. If another account takes the number or address in between, the answer is `contact-unavailable` (409). | S. M. Nihal Ahmed; reviewer of the U1-05 PR | Unit 1 sections 4.2 and 6.5 |
| 2026-11-01 | U1-05 | New task U1-12 for the MFA settings endpoints (`/me/mfa/totp`, `/confirm`, `DELETE`, `/me/mfa/recovery-codes`): they are in Unit 1 section 4.2 but no task covered them. | S. M. Nihal Ahmed; reviewer of the U1-05 PR | PROGRESS (U1) |
| 2026-11-01 | U1-07 | Staff sign-in answers the design leaves open: the password step answers 200 `{mfaRequired}` with an MFA ticket cookie `__Host-tb_smfa` (DV-1), or, for an account in `pending_mfa`, `{enrolmentRequired}` with an enrolment ticket `__Host-tb_senrol` valid 15 minutes. Enrolment is two calls: `POST /staff/auth/mfa/enrol` sets the staff member's own password (it must differ from the generated one) and returns a new 160-bit TOTP secret as an `otpauth://` URI; `POST /staff/auth/mfa/enrol/confirm` takes the first code, makes the account active and signs it in. Staff have TOTP only: no SMS (SEC-AUTH-07) and no recovery codes (a lost authenticator is the four-eyes `staff.mfa_reset`). Passkeys (optional in the design) are not built. Staff passwords follow SEC-AUTH-01's MFA rule (8 or more characters) and the blocklist. Staff failures are throttled like users', keyed by `staff:` + e-mail. A staff access token never outlives CP-03's idle limit. | S. M. Nihal Ahmed; reviewer of the U1-07 PR | Unit 1 sections 4.2, 6.2 and 6.8 |
| 2026-11-01 | U1-07 | Approvals: the decider must hold the required role and not be the proposer (`own-proposal`, 403); a second open proposal for the same action and target is `already-proposed` (409); a decided or expired one is `approval-closed` (409). An expired proposal is marked `expired` when someone tries to decide it, and by `ApprovalService.expireStale()`, which the job runner (K-05) will schedule. `propose()` refuses an action with no registered handler. Audit actions `staff.approval.proposed`, `.approved`, `.rejected` and `.expired`, with the approval id. | S. M. Nihal Ahmed; reviewer of the U1-07 PR | Unit 1 section 6.7 |
| 2026-11-01 | U1-07 | Staff administration: an administrator cannot disable their own account; disabling and an MFA reset need a reason of 10 or more characters. The first password is 128 random bits, returned once in the 201 answer and never stored in clear. The audit log is read newest first with filters (actor, object, action prefix, time) by administrators only; reading it is not itself audited, verifying is. Operators' access to the entries of their own cases (SEC-LOG-04) belongs to the case units. `hasConflict` compares e-mail and number now; the NID comparison joins with U1-06 (`staff_accounts.nid_bidx`). | S. M. Nihal Ahmed; reviewer of the U1-07 PR | Unit 1 sections 5.3 and 6.8 |
| 2026-11-01 | U1-07 | The bootstrap command is `docker compose exec backend node dist/staff-bootstrap.js --email ... --name ...` (also `npm run staff:bootstrap -- ...` outside the container), because the backend image has no npm since U1-04. It prints the first password once, to the terminal. | S. M. Nihal Ahmed; reviewer of the U1-07 PR | Unit 1 section 4.4 |
| 2026-11-01 | U1-06 | Images: `sharp` as the design names; but not `file-type`: its last CommonJS version has open advisories and the current one is ES-module only, so the type is identified from the first bytes by our own check (JPEG, PNG, WebP), and sharp's decoding refuses anything else. Images are re-encoded as JPEG (quality 85), at most 2000 px (DV-9), at most 50 megapixels in. The backend image now compiles only argon2 from source (`npm rebuild argon2 --build-from-source`), because sharp ships its own libvips build for Alpine. | S. M. Nihal Ahmed; reviewer of the U1-06 PR | Unit 1 sections 3 and 6.6; Unit 9 (backend image) |
| 2026-11-01 | U1-06 | `FILES_ROOT` (default `/srv/files`, the Compose volumes) is a new setting; KYC files go to `FILES_ROOT/kyc` with 48-hex random names, mode 0600. Stored form: IV, ciphertext, tag; the wrapped data key (KEK version, IV, key, tag) stays in `kyc_files`. A file is decrypted whole in memory before it is sent (re-encoded images are small), not streamed. | S. M. Nihal Ahmed; reviewer of the U1-06 PR | Unit 1 sections 5.5 and 6.7 |
| 2026-11-01 | U1-06 | Details the design leaves open: the liveness actions are `turn_head_left`, `turn_head_right`, `look_up`, `smile`, `blink_twice`, one challenge per request, single use, for its own user, valid DV-3. Document numbers: NID 10, 13 or 17 digits; passport 1 or 2 letters and 7 or 8 digits. CP-34 counts every submission in the last 30 days (at most 3). Flags: `duplicate` when another account's claim or submission has the same document index; `possible_duplicate` only when not `duplicate`. A claim lasts DV-6 and the claimant may renew it; a decision releases it. New problem types: `kyc-not-allowed`, `kyc-limit`, `already-claimed`, `not-claimed`, `kyc-cannot-approve` (with the reason: `underage`, `blacklisted`, `duplicate_identity`), `conflict-of-interest`. | S. M. Nihal Ahmed; reviewer of the U1-06 PR | Unit 1 sections 6.6 and 6.7 |
| 2026-11-01 | U1-06 | Revocation and blacklisting are proposed and decided by operators (CP-30); both the proposer and the decider must have no conflict with the user. A blacklist proposal needs a verified identity (an identity claim) and carries the source and related order; the entry's `added_by` is the proposer. Signed file links are `/api/v1/files/v/{token}`, the token being the file, the session, user or staff, and the expiry, with HMAC under `LINK_KEY`; any failure answers `link-invalid` (410). Staff conflicts compare `staff_accounts.nid_bidx` with the user's submissions (no screen sets a staff NID yet). `account.reinstate` comes with suspension in U1-08. | S. M. Nihal Ahmed; reviewer of the U1-06 PR | Unit 1 sections 6.7 and 6.8 |
| 2026-11-01 | U1-08 | Port shapes, as the design's interfaces with these additions: every method that writes accepts an optional `CallContext` (address, correlation id) for the audit log; `ApprovalService.decide(id, byStaffId, ...)` looks the role up itself; `RateLimiter.define(rule, limit, window)` lets a unit name its own rules; `IdentityQuery.getContact` (I-36), `getApproxArea` (I-24) and `getPrincipal().verifiedAt` (I-8); `IdentityCommands.suspendAccount(..., { fraud })` puts the fraud flag in `identity.account.suspended` (I-8), and `proposeReinstatement` proposes the four-eyes `account.reinstate`, whose handler calls `reinstateAccount`. `assertCanTransact` throws `transaction-not-allowed` (403) with a reason: `suspended`, `closed`, `kyc-not-verified`, `email-not-verified` or `restricted`. `getPublicProfile` returns Unit 1's fields only (name, badge, join month, district); the rating and transaction count come from Unit 7's `TrustQuery`. | S. M. Nihal Ahmed; reviewer of the U1-08 PR | Unit 1 section 4.4; Unit 9 section 4 |
| 2026-11-01 | U1-08 | `FileVault` for other units: no table holds their files' keys, so `store()` returns an opaque key `v1.<purpose>.<file id>.<name>.<wrapped data key>` that the caller keeps in its own row; the data key is wrapped by `KYC_KEK`, which never leaves Unit 1. Every purpose is encrypted (the integration design names chat images as optional) and each goes to its own Compose volume. Image purposes are re-encoded like KYC images; `data_export` is stored as given and served as an attachment. A staff link needs a reason of 10 or more characters and is audited as `files.file.viewed`. | S. M. Nihal Ahmed; reviewer of the U1-08 PR | Unit 9 section 4 (FileVault); I-31 |
| 2026-11-01 | U7-01 | `ConfigPort` serves the parameters in the shapes of the seeded version 1 (`docs/design/sql/07_disputes_trust_staff.sql`), for example CP-01 = `{"access": "15 minutes"}`; it adds `ms(code, field?)` to read a duration in milliseconds and `switchOn(name)` for the emergency switches, read uncached. Unit 1's readers moved from the interim shapes of the U1-04 stand-in, which is removed. CP-34 holds the number of submissions; its 30-day window is the SRS's wording, fixed in code. The `search` rate limit now reads CP-35 (the U1-02 proposal). | S. M. Nihal Ahmed; reviewer of the U7-01 PR | Unit 7 section "Parameters and Feature Switches"; I-4 |
| 2026-11-01 | U7-01 | `CONFIG_PORT` is provided by Unit 7's global `ConfigPortModule`, which needs only the database and the clock, so every unit can inject it whatever the module order. Each instance caches the current set for 60 seconds (DV-50) and refreshes at once after its own publication; the refresh on `staff.config.published` follows when the outbox dispatcher (K-04) exists. Administrators' API: `GET /admin/config`, `GET /admin/config/versions`, `POST /admin/config/validate` (every broken rule, nothing published), `POST /admin/config` (publish, 201 with the version; `config-invalid` 422 with all rules; `four-eyes-required` 409 for switches, CP-30 and CP-36), `POST /admin/config/proposals` (approval action `emergency.control` for switches, `config.publish` for CP-30 and CP-36, decided by a second administrator; one open proposal of each kind at a time). Every publication is audited as `staff.config.published` with the changed values before and after. | S. M. Nihal Ahmed; reviewer of the U7-01 PR | Unit 7 section "Parameters and Feature Switches"; Unit 8 (parameter editor) |
| 2026-11-01 | K-04 | Dispatcher details the design leaves open: each pass takes up to 100 due events per outbox in one transaction, with `FOR UPDATE SKIP LOCKED`, and runs the consumers while holding them; the consumers use their own connections. An event is retried when any consumer fails, and all its consumers are called again (the design's "each consumer records which events it has processed" is each consumer's idempotency; no shared table records it). Retry delay 5 s doubling, at most one hour; after 10 attempts the event stays undispatched with an error log line for the operators. An event with no consumer is marked dispatched. `OUTBOX_DISPATCHER=off` stops the poller, for tests that drain by hand. | S. M. Nihal Ahmed; reviewer of the K-04 PR | Unit 9 section 3.2; DV-67 |
| 2026-11-01 | K-05 | Job runner details: the first run comes after a random delay of at most 10% of the interval or 30 seconds, whichever is less, so an outage is caught up soon after a restart; later runs follow at the interval plus up to 10% (DV-67). A job never overlaps itself in one instance; across instances, jobs claim their rows with `forEachDue()` (one row per transaction, `FOR UPDATE SKIP LOCKED`, which it insists on). A failed run is logged and counted, and the next run comes at the interval. Unit 1's jobs run daily as the integration design's table says; a decision on an expired proposal was already refused at once. `JOB_RUNNER=off` stops the runner, for tests that run jobs by hand. | S. M. Nihal Ahmed; reviewer of the K-05 PR | Unit 9 "Scheduled jobs"; DV-67 |
| 2026-11-01 | U2-01 | `scripts/generate_entities.py` now also writes a unit's copy of an earlier unit's enum that its columns use (`audit.actor_type` in `orders.escrow_history`), so no unit imports another's internals (DC-1), and maps `char(n)` columns (`currency`). The entity checks moved to `test/support/entity-check.ts`, shared by every U*-01 task; they compare enums by schema and name, because two units may each have an enum of the same name (`item_kind` in orders and listings). The NFR-MNT-03 coverage gate no longer measures the generated `db/entities/` and `db/enums.ts`: they are declarations, verified against the database by the entity checks, and measuring them failed Unit 2's gate before it has any logic. | S. M. Nihal Ahmed; reviewer of the U2-01 PR | U3-01 to U7-02 (same tools) |
| 2026-11-01 | U3-01 | The generator maps `interval` (as a string, e.g. the auction's snipe window) and `tsvector` columns, and marks every `GENERATED ALWAYS` column, like the trigger-set ones, as never written by the application (`listings.search_tsv`). | S. M. Nihal Ahmed; reviewer of the U3-01 PR | U4-01 to U7-02 (same tools) |

## Finished log

Append one line when a task becomes `done` (newest last).

| Date | Task | Owner | PR |
|---|---|---|---|
| 2026-10-31 | P0-01 | S. M. Nihal Ahmed | #33 |
| 2026-10-31 | P0-02 | S. M. Nihal Ahmed | #35 |
| 2026-10-31 | P0-04 | S. M. Nihal Ahmed | #59 |
| 2026-11-01 | P0-07 | S. M. Nihal Ahmed | #61 |
| 2026-11-01 | P0-03 | S. M. Nihal Ahmed | #58 |
| 2026-11-01 | P0-09 | S. M. Nihal Ahmed | #63 |
| 2026-11-01 | P0-05 | S. M. Nihal Ahmed | #65 |
| 2026-11-01 | K-03 | S. M. Nihal Ahmed | #67 |
| 2026-11-01 | P0-06 | S. M. Nihal Ahmed | #70 |
| 2026-11-01 | K-01 | S. M. Nihal Ahmed | #72 |
| 2026-11-01 | U1-01 | S. M. Nihal Ahmed | #74 |
| 2026-11-01 | U1-02 | S. M. Nihal Ahmed | #76 |
| 2026-11-01 | U1-04 | S. M. Nihal Ahmed | #78 |
| 2026-11-01 | U1-03 | S. M. Nihal Ahmed | #83 |
| 2026-11-01 | U1-05 | S. M. Nihal Ahmed | #85 |
| 2026-11-01 | U1-07 | S. M. Nihal Ahmed | #87 |
| 2026-11-01 | U1-06 | S. M. Nihal Ahmed | #89 |
| 2026-11-01 | U1-08 | S. M. Nihal Ahmed | #91 |
| 2026-11-01 | U7-01 | S. M. Nihal Ahmed | #93 |
| 2026-11-01 | K-04 | S. M. Nihal Ahmed | #95 |
| 2026-11-01 | K-05 | S. M. Nihal Ahmed | #97 |
| 2026-11-01 | U2-01 | S. M. Nihal Ahmed | #99 |
| 2026-11-01 | U3-01 | S. M. Nihal Ahmed | #102 |
| 2026-11-01 | U4-01 | S. M. Nihal Ahmed | #104 |
