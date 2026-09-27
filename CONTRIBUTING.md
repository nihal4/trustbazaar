# Contributing to TrustBazaar

## Branching
- `main` is always deployable — never push directly to it (branch protection enforces this).
- Branch names: `feature/<short-description>`, `fix/<short-description>`, or reference the requirement, e.g. `feature/fr23-proxy-bidding`.

## Commits
Follow [Conventional Commits](https://www.conventionalcommits.org/):
```
feat(auctions): implement proxy bidding (FR-25)
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

## Before you start a module
Read the relevant section of `docs/srs.tex` for the FR/NFR range your module covers (see the table in `README.md`) — the `TODO` comments in each module point at the requirement, not the full spec.

## Concurrency-sensitive work
Anything touching bidding, stock decrement, payment webhooks, or settlement math must have a corresponding test in `backend/test/concurrency/` passing before merge — these are the project's core evaluation criteria (see `docs/proposal.tex`, "Evaluation Criteria").
