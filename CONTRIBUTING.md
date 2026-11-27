# Contributing to TrustBazaar

**Start with [`BUILDING.md`](BUILDING.md)** (the builder guide: flow, structure, conventions, tests, definition
of done) and [`PROGRESS.md`](PROGRESS.md) (who is building what, and what is finished). Where this file and
`BUILDING.md` differ, `BUILDING.md` wins.

## Branching
- `main` is always deployable — never push directly to it (branch protection enforces this).
- Branch names: `feature/<task-id>-<short-name>` or `fix/<task-id>-<short-name>`, with the task ID from `PROGRESS.md`, e.g. `feature/u3-04-bid-engine`.

## Commits
Follow [Conventional Commits](https://www.conventionalcommits.org/):
```
feat(auctions): implement proxy bidding (FR-AUC-06)
fix(payments): prevent duplicate webhook settlement
docs(readme): update setup instructions
test(orders): add concurrent stock decrement test
```
Prefixes used: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `perf`, `ci`, `build`, `style`, `revert`; the scope is the task id (`feat(U10-25): ...`). The message is checked when you commit (commitlint).

## Pull requests
1. Open a PR against `main`; fill in the PR template.
2. At least one other team member reviews and approves before merge.
3. CI (`.github/workflows/ci.yml`) must pass — backend tests, frontend build.
4. Squash-merge, so `main` history stays one commit per feature.

## Before you start a task
Pick it with `python3 scripts/check_progress.py --next`, then read its unit's design document in `docs/design/`, the integration notes listed under the unit in `PROGRESS.md`, and the requirements in `docs/srs.tex` (see `BUILDING.md` section 2).

## Code health tools (U11)
The tools check that code stays readable and that the design system is used. Run `npm run health` in `frontend/` or `backend/` for the whole report. Until the clean-up (U11 in `PROGRESS.md`) has reached a folder, most of these are warnings or reports, not errors.

| Command (in `frontend/` unless noted) | What it does |
|---|---|
| `npm run lint` | ESLint: errors stop CI; warnings are the report (accessibility of the markup, too complex, repeated code) |
| `npm run lint:css` | Stylelint: a colour or a font written in a stylesheet instead of a token (`var(--tb-…)`) is flagged |
| `npm run format` / `format:check` | Prettier, one format over the whole code (`backend/` has the same two commands); CI checks it, and the hooks leave it to you: run `npm run format` before you commit. The one commit that formatted everything (U11-14) is in `.git-blame-ignore-revs`: GitHub skips it in blame, and locally `git config blame.ignoreRevsFile .git-blame-ignore-revs` does the same |
| `npm run dup` | jscpd: copied code |
| `npm run unused` | knip: unused files, exports and dependencies (`backend/` too) |
| `npm run deps` | dependency-cruiser: a cycle, or `shared/` importing a feature |
| `npm run health:ratchet` (also in `backend/`) | The ratchet: ESLint, Stylelint, knip and jscpd numbers may go down, never up; CI runs it. After a clean-up lowered them, `npm run health:baseline` and commit `health-baseline.json` |
| `npm run visual` / `visual:update` | The screenshot tests of the main screens in the pinned Playwright container (needs Docker and `npm run build`); `visual:update` only when a screen is meant to change. Screens are recorded from the real system with `node e2e/visual/record.mjs <name> <path> --session <file>` and replayed from `e2e/visual/fixtures/` |
| `npm run storybook` | The component catalogue at http://localhost:6006; `npm run storybook:build` builds it. Add a story next to a shared component as `Component.stories.tsx` |

When you make a commit, Husky runs ESLint and Stylelint on the staged files (errors stop the commit) and checks the message (`type(scope): subject`, the scope is a task id). Run `npm install` in the repository root once to set the hooks up.

## Concurrency-sensitive work
Anything touching bidding, stock decrement, payment webhooks, or settlement math must have a corresponding test in `backend/test/concurrency/` passing before merge — these are the project's core evaluation criteria (see `docs/proposal.tex`, "Evaluation Criteria").
