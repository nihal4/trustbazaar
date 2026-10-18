# Building TrustBazaar

This guide is for everyone who writes code in this repository: the three of us, and any AI assistant
working for us (Claude reads `CLAUDE.md`, which sends it here). Everyone follows the same flow and the
same structure, and records progress in [`PROGRESS.md`](PROGRESS.md).

**Before your first task, read:** this guide; `PROGRESS.md`; the Unit 9 document
(`docs/design/09_integration.pdf`), sections 2 to 4; and the design document of the unit you work on.

---

## 1. Where the truth is

When two sources disagree, the higher one wins:

1. **The SRS** (`docs/srs.tex`): what the system must do. Requirement IDs like `FR-AUC-04`.
2. **The integration notes** that concern your unit (the register in Unit 9, section 9; also listed under
   each unit in `PROGRESS.md`). A note marked *Change to Unit N* overrides the older text of Unit N's document.
3. **The unit's design document** (`docs/design/0N_*.pdf` and `.tex`): how it is built.
4. **The reference files**: `docs/design/sql/` (schemas and their tests), `docs/design/web/` (frontend
   modules), `docs/design/crypto/` (`sealed.js`), `docs/design/deploy/` (containers, CI).
5. **The Decisions log** in `PROGRESS.md`: changes agreed while building.

**Never change the design silently.** If the design is wrong, unclear or missing something, write it in
the Decisions log, agree it with one teammate, and say which document must be updated. Small gaps (a
helper, a private function) need no entry; anything another unit or the user can see does.

## 2. The flow of one task

1. **Pick.** `python3 scripts/check_progress.py --next` lists the tasks whose *Needs* are all `done`. Take
   one nobody owns. Check the open pull requests too, so you do not start what someone has just claimed.
2. **Read.** The design sections for the task, the integration notes for the unit, and the SQL file and its
   tests if the task touches the database.
3. **Branch and claim.** `git switch -c feature/<task-id>-<short-name>` (for example
   `feature/u3-04-bid-engine`). The first commit sets the task's row in `PROGRESS.md` to `doing`, with your
   name and the branch. Push and open a **draft pull request** at once, so everyone sees the claim.
4. **Build** inside the structure of section 3, following the conventions of section 4. Keep the pull
   request to the one task.
5. **Test** as in section 6. Every requirement the task implements has a test named after it.
6. **Review.** Mark the pull request ready; set the row to `review` with the PR number. Fill in the PR template.
7. **Finish.** When the review is approved, the last commit sets the row to `done` with the PR number and
   today's date, ticks the integration notes you applied, and appends a line to the Finished log. Then squash-merge.
8. **If stuck,** set the row to `blocked` and write why in Notes. Do not wait silently.

## 3. Code structure

### Backend (`backend/`)

One NestJS application; one module per backend unit, plus the shared kernel (Unit 9, section 2).

```
backend/
  src/
    main.ts                  bootstrap: kernel first, then the unit modules
    migrate.ts               runs the migrations as tb_owner (used by the "migrate" container)
    kernel/                  config, logging, health, metrics, outbox dispatcher, job runner,
                             Socket.IO gateway, error format (problem+json)
    modules/
      identity/              Unit 1: schemas identity, audit; also the security pipeline (guards)
      orders/                Unit 2: schemas orders, payments
      listings/              Unit 3: schemas listings, auctions
      delivery/              Unit 4: schema delivery
      game-accounts/         Unit 5: schema game_accounts
      chat/                  Unit 6: schemas chat, notify
      trust/                 Unit 7: schemas disputes, trust, staff
  migrations/                one migration per docs/design/sql/0N_*.sql, then 09_integration
  test/                      integration and concurrency tests (real PostgreSQL)
```

Inside every unit module, the same folders:

```
modules/<unit>/
  <unit>.module.ts          imports kernel and other units' ports; EXPORTS ONLY ITS PORTS
  ports/                    the port interfaces of its design document, and their injection tokens
  http/                     controllers and DTOs (class-validator, whitelist)
  services/                 application services: one method = one flow = one transaction
  db/                       TypeORM entities over its own schemas; calls to its SQL functions
  events/                   outbox writers and the consumers of other units' events
  jobs/                     its scheduled jobs, registered with the kernel's job runner
  adapters/                 external providers (payments, courier, SMS, e-mail) behind interfaces
```

Unit tests (`*.spec.ts`) sit next to the code. The old stubs in `src/modules/` and `src/entities/` are
replaced by this structure (task P0-04).

### Frontend (`frontend/`)

As Unit 8, section 3: four HTML entries (`index.html`, `staff.html`, `kyc.html`, `secure.html`);
`src/lib/` holds the reference modules from `docs/design/web/src/` **unchanged**; `src/features/<area>/`
one folder per area; `src/staff/` only for the staff console; `src/shared/` shared components;
`src/messages/en|bn/` catalogues with identical keys.

## 4. Conventions (quick reference)

The full text is in the design documents: DC-1 to DC-12 in Unit 1 section 2, DC-13 in Unit 2, DC-14 in
Unit 4, DC-15 in Unit 9.

| Rule | In one line |
|---|---|
| DC-1 | A unit never reads or writes another unit's tables. Ask its port. |
| DC-5 | Foreign keys only to your own unit or an earlier one. |
| DC-6 | Events go through your unit's outbox, in the same transaction; names `<unit>.<entity>.<past>`; consumers are idempotent. |
| DC-13 | A change that must happen together with another unit's runs through that unit's port **in your transaction**. |
| DC-14 | Lock order: listing, order, your unit's row, escrow, attempt. |
| DC-15 | A foreign key gets an index if its parent can be deleted or something looks rows up by it. |
| Money | Integer poisha as `bigint` in the database and `bigint`/string in code. Never floating point. |
| Time | `timestamptz`, UTC in the backend; Asia/Dhaka only on screen. |
| Parameters | Every CP value comes from `ConfigPort`; nothing is hard-coded (NFR-MNT-06). |
| Errors | RFC 9457 problem documents with a correlation id; generic messages to users. |
| Input | DTOs with `class-validator` and `whitelist`; unknown fields rejected. |
| Security | Every endpoint has a policy decorator; no policy means unreachable (DC-7). |
| Text | User text is plain text everywhere; no HTML rendering, no `dangerouslySetInnerHTML`. |
| SQL | Parameter binding only; never build SQL from strings. |

**Schema changes:** the design SQL files are the reference. A schema change edits the unit's
`docs/design/sql/0N_*.sql` and its tests, then the migration, in the same pull request; the integration
checks (`09_integration_checks.sql`) must still pass.

## 5. Order of work

Setup (P0) first, then the shared kernel and Unit 1, then Unit 2, then Unit 3. Units 4, 5 and 6 can run in
parallel. Unit 7's `ConfigPort` (U7-01) is small and is needed early by everyone; the rest of Unit 7
follows Units 2 to 6. Frontend tasks follow the backend tasks they depend on. The *Needs* column in
`PROGRESS.md` is the authority; `--next` applies it.

## 6. Tests

| Level | Where | Required for |
|---|---|---|
| Database | `docs/design/sql/0N_*_tests.sql`, run by CI on the migrated database | Every task that touches a schema |
| Unit | `*.spec.ts` beside the code (Jest) | Every service with logic |
| API | `backend/test/api/` against a real database | Every endpoint, including SEC-SDL-09's four negative cases: another user's object, a lower role, no session, an expired session |
| Concurrency | `backend/test/concurrency/` | Bidding, stock, webhooks, settlement, escrow (NFR-MNT-02) |
| Frontend | Vitest beside components; Playwright end to end | Every screen |

**Name tests after the requirement:** `it('FR-AUC-04 a bid below the increment is refused', ...)`. The
document checks count requirements by these names (Unit 9, section 7.4).

Before pushing: `npm run lint` and `npm test` in the package you changed; `python3 scripts/check_progress.py`.

## 7. Definition of done

A task is `done` only when all of these hold:

- [ ] It does what its design sections say, and applies the unit's integration notes it touches.
- [ ] Every requirement it implements has a named test, and all tests pass in CI.
- [ ] Lint passes; no secret, `.env` value or personal data in the commit.
- [ ] Any design change is in the Decisions log, with the document to update.
- [ ] `PROGRESS.md` updated: row `done` with PR and date, notes ticked, Finished log line.
- [ ] Reviewed and approved by a teammate who did not write it (security paths: see `CODEOWNERS`).

## 8. `PROGRESS.md` rules

- Status values: `todo`, `doing`, `review`, `done`, `blocked`.
- Only the owner changes a `doing` or `review` row. Change ownership only by agreement, noted in Notes.
- A task may be `doing` only when every task in its *Needs* is `done`.
- New tasks get the next free ID in their section (`U3-08`) and a *Needs* entry; add them in a pull request.
- `python3 scripts/check_progress.py` must pass on every pull request.

## 9. Git

- Branches: `feature/<task-id>-<name>`, `fix/<task-id>-<name>`. Never push to `main`.
- Commits: Conventional Commits with the task ID, e.g. `feat(listings): place_bid with proxy bidding (U3-04, FR-AUC-06)`.
- One task per pull request; squash-merge.

## 10. For AI assistants

If you are an AI assistant working in this repository:

1. Read this guide, `PROGRESS.md` and the design sections of the task before writing code.
2. Work only on a task that is `todo` with all *Needs* `done`, or one the user assigns to you by ID. If the
   user asks for something that is not a task, add a task row first and say so.
3. Claim it in `PROGRESS.md` with the user's name as owner (ask if you do not know it).
4. Follow sections 3, 4 and 6 exactly. Do not invent structure, names or endpoints that the design already fixes.
5. Where the design is silent or contradicts itself, stop and ask, or record a proposed decision; never
   decide a design question silently.
6. Do not mark a task `done` unless its tests ran and passed; say which tests you ran.
7. Keep the change inside the task; list anything else you noticed as a new task or a Decisions-log entry.
