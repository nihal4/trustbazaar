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
| P0-03 | Repository settings: branch protection on `main`, one review by a non-author, required CI, secret scanning with push protection; add security paths to `CODEOWNERS` (SEC-SDL-01, SEC-SDL-05) | P0-01 | doing | S. M. Nihal Ahmed | `feature/p0-03-codeowners` | | Settings already on: `main` protected, 1 approval with last-push approval and stale dismissal, admins included, no force push or deletion, secret scanning and push protection, Dependabot. Required checks: `database`, `documents`, `reference-browser`; add `lint-and-unit (backend)` after P0-04 and `lint-and-unit (frontend)` after P0-07. |
| P0-04 | Restructure `backend/src` into `kernel/` and the seven unit modules of BUILDING.md section 3; remove the old stubs and `entities/`; ESLint import boundaries | P0-01 | done | S. M. Nihal Ahmed | #59 | 2026-10-31 | Skeleton only: each unit module and `ports/index.ts` are empty until the unit's tasks add ports; the other folders of BUILDING.md section 3 appear with the code that needs them. Also removes the unused `bcrypt` (SRS forbids it; Unit 1 uses Argon2id) and adds `tsconfig.build.json` so the build writes `dist/main.js`, the path the image runs. |
| P0-05 | Migrations: one TypeORM migration per `docs/design/sql/0N_*.sql` plus `09_integration.sql`; `src/migrate.ts` entry run as `tb_owner` (I-60) | P0-04 | todo | | | | |
| P0-06 | Test harness: Jest unit tests, integration tests against PostgreSQL 15 in CI, test names that start with the requirement ID (BUILDING.md section 6) | P0-04 | todo | | | | |
| P0-07 | Restructure `frontend/` to the Unit 8 layout; copy `docs/design/web/src` to `frontend/src/lib` unchanged; four Vite entries | P0-01 | review | S. M. Nihal Ahmed | `feature/p0-07-frontend-structure`, #61 | | Layout, four documents with placeholder entries (U8-01 builds the shell), ESLint 9 with the Unit 8 rules and Vitest. Removes the old pages, the `localStorage` token client and the development-server Dockerfile (replaced by `web.Dockerfile`). Vitest 4.1.12 is needed for `npm audit`; its lockfile entry was written with npm 11 because of an npm 10 resolver bug, and `npm ci` with npm 10.8 installs it. |
| P0-08 | SRS update: DV-1 to DV-67, DC-15 and the SRS clarifications of the integration register (does not block coding) | - | todo | | | | |

## K: Shared kernel (with Unit 1)

Design: `docs/design/09_integration.pdf` (source `.tex` beside it).

| ID | Task | Needs | Status | Owner | Branch / PR | Done | Notes |
|---|---|---|---|---|---|---|---|
| K-01 | Configuration and secrets: read at start, at least 32 bytes, refuse `dev-only-` values in production (I-59, SEC-DAT-05) | P0-04 | todo | | | | |
| K-02 | JSON logging with correlation id, module and the redaction list (NFR-OBS-02, SEC-DAT-07) | P0-04 | todo | | | | |
| K-03 | Health endpoints `/api/v1/health/live` and `/ready` (NFR-OBS-01) | P0-04 | todo | | | | |
| K-04 | Outbox dispatcher for all seven outboxes, consumer registry, retries (DC-6, DV-67) | P0-05 | todo | | | | |
| K-05 | Job runner: intervals with spread, `SKIP LOCKED` claims, run metrics (NFR-REL-03) | P0-05 | todo | | | | |
| K-06 | Metrics on port 9464; graceful shutdown (NFR-OBS-03, DV-66) | K-02 | todo | | | | |
| K-07 | Socket.IO gateway with the Redis adapter; rooms `sid:`, `user:`, `auction:` (NFR-SCL-01) | P0-04 | todo | | | | |

## U1: Identity & Access

Design: `docs/design/01_identity_access.pdf` (source `.tex` beside it).

| ID | Task | Needs | Status | Owner | Branch / PR | Done | Notes |
|---|---|---|---|---|---|---|---|
| U1-01 | Entities and repositories over `identity` and `audit`; the SQL tests run in CI | P0-05 | todo | | | | |
| U1-02 | Security pipeline: RateLimitGuard, AuthGuard, CsrfGuard, PolicyGuard, StepUpGuard; problem+json errors (DC-3, DC-7) | U1-01, K-01 | todo | | | | |
| U1-03 | Registration with OTP and e-mail verification | U1-02 | todo | | | | |
| U1-04 | Sign-in, MFA, sessions, refresh rotation with reuse detection | U1-02 | todo | | | | |
| U1-05 | Step-up, password reset and change, contact changes | U1-04 | todo | | | | |
| U1-06 | KYC submission and review; `FileVault`, `IdentityCrypto` (I-61) | U1-02 | todo | | | | |
| U1-07 | Staff accounts and sign-in (own cookies, I-51), approvals (four-eyes), audit log and chain verification | U1-02 | todo | | | | |
| U1-08 | Ports: `IdentityQuery`, `IdentityCommands`, `StaffQuery`, `ApprovalService`, `AuditService`, `RateLimiter` | U1-06, U1-07 | todo | | | | |
| U1-09 | Closure and erasure job; human-verification challenge (SEC-ABU-02, I-64) | U1-08, K-05 | todo | | | | |
| U1-10 | API tests, including the negative authorisation tests of SEC-SDL-09 | U1-08 | todo | | | | |

**Integration notes this unit must apply** (they override the older text of its document where they differ):

- [ ] I-7 (from Unit 1): Shared infrastructure first: The `security` and `audit` modules, and `ApprovalService`, should be implemented first, because every later unit imports them.
- [ ] I-8 (from Unit 2): Port addition: `IdentityQuery.getPrincipal` should also return `verifiedAt` for the CP-27 limits, and Unit 1 should emit a fraud flag with `identity.account.suspended` so that ...
- [ ] I-24 (from Unit 4): New `IdentityQuery.getApproxArea(userId)`. Add `HANDOVER_KEY` and the courier API and webhook secrets to the key table (Unit 1 Section 3).
- [ ] I-31 (from Unit 5): `FileVault` gains a purpose for ownership screenshots, on its own volume, with retention DV-39.
- [ ] I-36 (from Unit 6): `NotificationPort` is implemented here; OTP rate limits stay in Unit 1.
- [ ] I-43 (from Unit 7): `assertCanTransact` must call `SanctionPort.restrictions` (selling, or buying and bidding).
- [ ] I-51 (from Unit 8): (a) Staff sessions use their own cookies, for example `__Host-tb_sat`, `__Host-tb_scsrf` and `__Secure-tb_srt` on `/api/v1/staff/auth/refresh`, with `POST /staff/auth/refresh` ...
- [ ] I-59 (from Unit 9): Shared kernel: The backend refuses to start in production if a secret is missing, is shorter than 32 bytes or starts with `dev-only-`.
- [ ] I-60 (from Unit 9): All units: One TypeORM migration per design SQL file, in unit order, then `09_integration.sql`.
- [ ] I-61 (from Unit 9): Implement `FileVault`, `IdentityCrypto` and `StaffQuery` (Unit 1) and `ListingsQueries` (Unit 3) as declared in Section .
- [ ] I-64 (from Unit 9): The human-verification challenge of SEC-ABU-02: Unit 1 issues and checks it and answers `428`; Unit 8 solves it in a Web Worker.

## U2: Order, Payment & Escrow

Design: `docs/design/02_orders_payments.pdf` (source `.tex` beside it).

| ID | Task | Needs | Status | Owner | Branch / PR | Done | Notes |
|---|---|---|---|---|---|---|---|
| U2-01 | Entities over `orders` and `payments`; the SQL tests run in CI | P0-05 | todo | | | | |
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
- [ ] I-60 (from Unit 9): All units: One TypeORM migration per design SQL file, in unit order, then `09_integration.sql`.
- [ ] I-63 (from Unit 9): Retention jobs: the credential-access log after 2 years and ownership screenshots under DV-39 (Unit 5); dispute statements and evidence files 2 years after the decision (Unit ...

## U3: Listings & Auctions

Design: `docs/design/03_listings_auctions.pdf` (source `.tex` beside it).

| ID | Task | Needs | Status | Owner | Branch / PR | Done | Notes |
|---|---|---|---|---|---|---|---|
| U3-01 | Entities over `listings` and `auctions`; the SQL tests run in CI | P0-05 | todo | | | | |
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
- [ ] I-60 (from Unit 9): All units: One TypeORM migration per design SQL file, in unit order, then `09_integration.sql`.
- [ ] I-61 (from Unit 9): Implement `FileVault`, `IdentityCrypto` and `StaffQuery` (Unit 1) and `ListingsQueries` (Unit 3) as declared in Section .
- [ ] I-62 (from Unit 9): Publish `listings.listing.cancelled` and `listings.listing.relisting_flagged` (Unit 3) and `delivery.issue.opened` (Unit 4); list `chat.message.flagged` among Unit 6's events.

## U4: Delivery & Handover

Design: `docs/design/04_delivery.pdf` (source `.tex` beside it).

| ID | Task | Needs | Status | Owner | Branch / PR | Done | Notes |
|---|---|---|---|---|---|---|---|
| U4-01 | Entities over `delivery`; the SQL tests and concurrency script run in CI | P0-05 | todo | | | | |
| U4-02 | Areas, fares, binding quotes; saved addresses (encrypted) | U4-01, U3-06 | todo | | | | |
| U4-03 | Meetup proposals and the handover code | U4-02, U2-04 | todo | | | | |
| U4-04 | Courier adapter (mock first), shipments, status, returns | U4-02, U2-04 | todo | | | | |
| U4-05 | Jobs: booking, status reconciliation, proposal lapse, retention | U4-04, K-05 | todo | | | | |

**Integration notes this unit must apply** (they override the older text of its document where they differ):

- [ ] I-10 (from Unit 2): Delivery issues quotes bound to buyer, listing and expiry, and reports pickup, handover code, delivered and returned through `EscrowCommands`.
- [ ] I-39 (from Unit 6): Their events already carry the deadlines (meetup, pickup, credential delivery, takeover window, re-key); this unit schedules and cancels reminders from them.
- [ ] I-46 (from Unit 7): Publish `delivery.issue.opened`, so delivery issues appear as signals in the flagged-activity queue rather than a queue of their own.
- [ ] I-54 (from Unit 8): The handover answer includes the code attempts left. The credential screens are routes under `/secure/orders/{id}/`, served by `secure.html`, which imports `sealed.js` ...
- [ ] I-60 (from Unit 9): All units: One TypeORM migration per design SQL file, in unit order, then `09_integration.sql`.
- [ ] I-62 (from Unit 9): Publish `listings.listing.cancelled` and `listings.listing.relisting_flagged` (Unit 3) and `delivery.issue.opened` (Unit 4); list `chat.message.flagged` among Unit 6's events.

## U5: Game-Account Escrow

Design: `docs/design/05_game_accounts.pdf` (source `.tex` beside it).

| ID | Task | Needs | Status | Owner | Branch / PR | Done | Notes |
|---|---|---|---|---|---|---|---|
| U5-01 | Entities over `game_accounts`; the SQL tests and concurrency script run in CI | P0-05 | todo | | | | |
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
- [ ] I-60 (from Unit 9): All units: One TypeORM migration per design SQL file, in unit order, then `09_integration.sql`.
- [ ] I-63 (from Unit 9): Retention jobs: the credential-access log after 2 years and ownership screenshots under DV-39 (Unit 5); dispute statements and evidence files 2 years after the decision (Unit ...

## U6: Chat & Notifications

Design: `docs/design/06_chat_notifications.pdf` (source `.tex` beside it).

| ID | Task | Needs | Status | Owner | Branch / PR | Done | Notes |
|---|---|---|---|---|---|---|---|
| U6-01 | Entities over `chat` and `notify`; the SQL tests and concurrency script run in CI | P0-05 | todo | | | | |
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
- [ ] I-60 (from Unit 9): All units: One TypeORM migration per design SQL file, in unit order, then `09_integration.sql`.
- [ ] I-62 (from Unit 9): Publish `listings.listing.cancelled` and `listings.listing.relisting_flagged` (Unit 3) and `delivery.issue.opened` (Unit 4); list `chat.message.flagged` among Unit 6's events.

## U7: Disputes, Trust & Safety, Staff Tools

Design: `docs/design/07_disputes_trust_staff.pdf` (source `.tex` beside it).

| ID | Task | Needs | Status | Owner | Branch / PR | Done | Notes |
|---|---|---|---|---|---|---|---|
| U7-01 | `ConfigPort` over `staff` parameter versions (needed early by every unit) | P0-05 | todo | | | | |
| U7-02 | Entities over `disputes`, `trust`, `staff`; the SQL tests and concurrency script run in CI | P0-05 | todo | | | | |
| U7-03 | Disputes: open, respond, case file, decide (four-eyes), withdraw, refund after return | U7-02, U2-04, U4-04, U5-04, U6-03 | todo | | | | |
| U7-04 | Reports, signals, sanctions, strikes; `SanctionPort` | U7-02, U1-08 | todo | | | | |
| U7-05 | Ratings and the profile summary | U7-02, U2-04 | todo | | | | |
| U7-06 | Staff queues and actions; parameter editor and switches | U7-04, U1-07 | todo | | | | |
| U7-07 | Data export and lawful disclosure; jobs; retention (I-63) | U7-03, K-05 | todo | | | | |

**Integration notes this unit must apply** (they override the older text of its document where they differ):

- [ ] I-4 (from Unit 1): Parameter store: `ConfigPort` moves from environment configuration to the Staff Tools unit's versioned store (FR-OPS-08) without changing callers.
- [ ] I-5 (from Unit 1): Lost MFA and recovery codes: An operator-assisted re-verification procedure is to be designed in the Staff Tools unit.
- [ ] I-12 (from Unit 2): Disputes owns dispute windows by type, four-eyes approval of large outcomes, and the return shipment for "refund after return".
- [ ] I-17 (from Unit 3): hosts the queues for listings in review, flags and voids, using this unit's staff endpoints.
- [ ] I-26 (from Unit 4): hosts the delivery issue queue and the unlock action. It uses `fulfilmentRecord` in the case file (FR-DSP-05), `notReceivedAllowed` for `not_received` disputes, and ...
- [ ] I-33 (from Unit 5): The ownership-proof queue (FR-OPS-01) calls `reviewProof`. A `credentials_invalid` dispute is opened in the same transaction as the report, and also when a re-key is overdue.
- [ ] I-40 (from Unit 6): Use `ChatCommands.hold` and `release` for every dispute and report that concerns a thread, and `chat.staff_read` in the case file (FR-DSP-05).
- [ ] I-56 (from Unit 8): The dispute form needs the types that may be opened now: `GET /orders/{id}/dispute-types` answers from the owning units' checks.
- [ ] I-60 (from Unit 9): All units: One TypeORM migration per design SQL file, in unit order, then `09_integration.sql`.
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

## Finished log

Append one line when a task becomes `done` (newest last).

| Date | Task | Owner | PR |
|---|---|---|---|
| 2026-10-31 | P0-01 | S. M. Nihal Ahmed | #33 |
| 2026-10-31 | P0-02 | S. M. Nihal Ahmed | #35 |
| 2026-10-31 | P0-04 | S. M. Nihal Ahmed | #59 |
