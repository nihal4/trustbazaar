# How do I change X?

Short recipes for the changes people make most. Each says where to go, what to run and what will tell you that you are done. For how the parts fit, read [ARCHITECTURE.md](../ARCHITECTURE.md) first; for the rules of a task (claiming it in `PROGRESS.md`, naming tests, definition of done) read [BUILDING.md](../BUILDING.md).

Commands are run from `frontend/` or `backend/` as shown.

## Run it

```sh
cp .env.example .env
docker compose up --build        # PostgreSQL, Redis, the backend and the web server
# the app: http://localhost:5173 (dev server) or http://localhost:8080 (the built client)
```

Frontend alone with hot reload: `cd frontend && npm run dev`. Backend alone: `cd backend && npm run start:dev` (needs PostgreSQL and Redis).

## The look of the site

**Change a colour, a font, a size, a gap, a corner or a speed.** Edit its token in `frontend/src/shared/tokens.css` (`--tb-text-md`, `--tb-space-4`, `--tb-radius-panel`, `--tb-dur-base`, `--tb-font`). Every use follows, which is the point. Never write a raw colour or font in a stylesheet: Stylelint fails the build (`npm run lint:css`). Dark is the default theme; the light values are in the `[data-theme='light']` blocks of the same file. Check what moved with the screenshot tests (below).

**Add a variant or a size to a component** (a new kind of button, a new tag tone). Edit the component in `frontend/src/shared/ui/` and its stylesheet, add a story next to it, and add a test named after the requirement it serves. A page then chooses it: `<Button variant="danger">`. `shared/ui` may not import the API, the router, the features or the language layer (an error in `npm run deps`): words and data come in as props.

**Add a component that does not exist yet.** First check Storybook (`npm run storybook`) and `shared/ui/` for one that does the job. If there really is none, add it to `shared/ui/` with a story and a test, and say why in the Decisions log of `PROGRESS.md`. Do not write a one-off in a feature's stylesheet; that is how the site came to have 55 kinds of button.

**See every component:** `cd frontend && npm run storybook` (it has the theme and language switches in its toolbar).

## Words and languages

**Add or change a piece of text.** Put the key in the area's catalogue in both languages: `frontend/src/messages/en/<area>.json` and `frontend/src/messages/bn/<area>.json`, then use `t('area.key')`. A test fails if the two languages do not have the same keys and placeholders. Money and dates are formatted by `lib/money.js` and `lib/time.js`, never by hand; times are shown in Dhaka time.

## A page

**Add a page.** In the area's folder under `frontend/src/features/`: write the page, add it to that folder's `routes.tsx` (the entry already imports it), add its words to the catalogues, build it from `shared/ui`, and write a test named after the requirement (`IF-UI-xx ...`). Call the API through `useApi()`; the address and the answer's shape are in [docs/api/openapi.json](api/openapi.json).

**Add the screen to the screenshot tests.** Record it from the running app, then add it to the list (below).

## The backend

**Add an endpoint.** In the unit's `http/` folder:

1. A controller method with a **policy decorator** (`@Public`, `@SignedIn`, `@Verified`, `@Staff`...). A route without one cannot be reached.
2. A DTO class with `class-validator` decorators for the body or query.
3. A doc comment above the method, one sentence beginning with the requirement when there is one (`/** FR-FIX-01: reserve and create the order. */`).
4. The work in a service of the same unit, in a transaction, using the transaction's manager for every query.
5. A test in `backend/test/api/` named after the requirement.
6. Regenerate the API document (below) and commit it.

**Call another unit.** Never import its files or read its tables. Use its **port** (`modules/<unit>/ports/`); if the call must change something together with your change, pass your transaction to the port (DC-13).

**Add a column or a table.** The design SQL is the reference: edit the unit's `docs/design/sql/0N_*.sql` and its `_tests.sql`, then add a migration in `backend/src/migrations/` (`<timestamp>-<name>.ts`, listed in `index.ts`), in the same pull request. Run it with `npm run migrate` (as `tb_owner`). The integration checks (`09_integration_checks.sql`) must still pass.

**Change a business value** (a limit, a window, a fee, a switch). It is a `CP-nn` parameter: staff change it in the administration screen with a second person's approval; code reads it through `ConfigPort`. A new parameter needs its seed in the design SQL and a reader through `ConfigPort`, never a constant.

**Regenerate the API document** after a route or a DTO changed:

```sh
cd backend
UPDATE_OPENAPI=1 npm run test:integration -- test/api/openapi.spec.ts
git add ../docs/api/openapi.json
```

## Run the tests

| What | Command |
|---|---|
| Frontend unit tests | `cd frontend && npm test` |
| Backend unit tests | `cd backend && npm test` |
| Lint, format, Stylelint, dependency rules | `npm run lint`, `npm run format:check`, `npm run lint:css`, `npm run deps` (frontend); `npm run lint` and `npm run format:check` (backend) |
| The health ratchet | `node ../scripts/health-ratchet.mjs` |
| The screenshot tests | `cd frontend && npm run build && sh e2e/visual/run.sh` |
| The integration suite | see below |

**Run the integration suite on your machine** without touching your development database. It needs PostgreSQL and Redis; use throw-away containers on other ports, set up as CI does it:

```sh
docker run -d --name tb-it-pg -p 55432:5432 \
  -e POSTGRES_PASSWORD=ci-only-password -e POSTGRES_USER=postgres -e TB_DATABASE=trustbazaar \
  -e TB_OWNER_PASSWORD=ci-only-owner-password-0123456789 -e TB_APP_PASSWORD=ci-only-app-password-0123456789ab \
  -v "$PWD/docs/design/deploy/postgres/init:/docker-entrypoint-initdb.d:ro" postgres:15-alpine
docker run -d --name tb-it-redis -p 56379:6379 redis:7-alpine

cd backend && npm run build
DATABASE_URL=postgres://tb_owner:ci-only-owner-password-0123456789@localhost:55432/trustbazaar node dist/migrate.js
DATABASE_URL=postgres://tb_app:ci-only-app-password-0123456789ab@localhost:55432/trustbazaar \
REDIS_URL=redis://localhost:56379/0 npm run test:integration          # about 3 minutes
docker rm -f tb-it-pg tb-it-redis                                      # when you are done
```

## The screenshot tests

They are 92 pictures of the main screens (dark and light, phone and desktop, English and Bangla in places), compared with **zero different pixels**. They are made inside the pinned Playwright container, so the fonts are drawn the same way everywhere; run them with `sh e2e/visual/run.sh` (Docker needed, after `npm run build`).

- **A refactor that must change nothing:** the tests must pass without touching a baseline. That is your proof.
- **A change that is meant to change a screen:** run `sh e2e/visual/run.sh --update-snapshots --grep "<screen>"`, then **look at the pictures** (`e2e/visual/__screenshots__/`, or the `*-diff.png` files in `test-results/` after a failing run) and check that only what you meant changed. Commit the new baselines with the change and say so in the Decisions log.
- **A new screen:** record its API answers with `node e2e/visual/record.mjs <name> <path> --session <file>` (it writes `e2e/visual/fixtures/<name>.json`), add it to `e2e/visual/screens.json`, then make its baselines as above.
- A canvas is hidden in the pictures (it is not masked); a clock moves ten seconds before each picture, so countdowns are the same every time.

## When CI is red

| Check | What it usually means |
|---|---|
| `lint-and-unit` > format | run `npm run format` in that app and commit |
| `lint-and-unit` > health ratchet | a number went **up** (lint warnings, unused exports, duplicated code). Fix it. Run `node ../scripts/health-ratchet.mjs --update` **only** when the numbers went down, and commit `health-baseline.json` to keep the gain |
| `lint-and-unit` > Stylelint | a raw colour or font in a stylesheet: use a token |
| `lint-and-unit` > deps | an import that breaks a boundary or makes a cycle |
| `visual` | a screen changed; open the diff images in the job's output and decide if you meant it |
| `integration` > `openapi.spec` | the API document is stale or a route has no doc comment: regenerate (above) |
| `integration` fails at about 10 minutes | a known intermittent hang in the concurrency suites (see [decisions/U11-code-health.md](decisions/U11-code-health.md), the pool note); re-run the job, and read the server log: the pool watchdog now says when connections run out |
| `images` > SBOM / Syft download | the download of an external tool failed (`HTTP 5xx`); re-run the job |

## A file hit the size limit

ESLint limits a file to a few hundred lines of code and a function to a few hundred too (the numbers are in `.eslintrc.js` and `frontend/eslint.config.js`). When you hit it, split along what the code already is:

1. Move whole components or services into **sibling files** next to the original.
2. What two of the moved parts share (types, constants, small helpers) goes in a **shared file** next to them (`sellShared.ts`, `disputeTypes.ts`), so that no two files import each other.
3. A page whose first half is state and handlers and second half is markup becomes a **hook** and a page (`registerFlow.tsx` and `RegisterPage.tsx`).
4. Run the type check and the tests after every move, and the screenshot tests at the end: a split must change no pixel.
