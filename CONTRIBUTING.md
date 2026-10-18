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
Prefixes used: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`.

## Pull requests
1. Open a PR against `main`; fill in the PR template.
2. At least one other team member reviews and approves before merge.
3. CI (`.github/workflows/ci.yml`) must pass — backend tests, frontend build.
4. Squash-merge, so `main` history stays one commit per feature.

## Before you start a task
Pick it with `python3 scripts/check_progress.py --next`, then read its unit's design document in `docs/design/`, the integration notes listed under the unit in `PROGRESS.md`, and the requirements in `docs/srs.tex` (see `BUILDING.md` section 2).

## Concurrency-sensitive work
Anything touching bidding, stock decrement, payment webhooks, or settlement math must have a corresponding test in `backend/test/concurrency/` passing before merge — these are the project's core evaluation criteria (see `docs/proposal.tex`, "Evaluation Criteria").
