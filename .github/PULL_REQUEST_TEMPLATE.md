## Task
<!-- The task ID from PROGRESS.md, e.g. "U3-04 Bid engine", and the design sections followed,
     e.g. "docs/design/03_listings_auctions.pdf, sections 5.1-5.4; notes I-38, I-53". -->

## What this PR does
<!-- One or two sentences. Link the requirement(s) it implements, e.g. "Implements FR-AUC-01–FR-AUC-04". -->

## Type of change
- [ ] New feature
- [ ] Bug fix
- [ ] Refactor (no functional change)
- [ ] Docs / config only

## How it was tested
<!-- Which tests did you add/run? If this touches a concurrency-sensitive path
     (bidding, stock decrement, payment webhooks, settlement split), say so
     explicitly and confirm the relevant test in test/concurrency/ passes. -->

## Checklist
- [ ] Follows `BUILDING.md` (structure, conventions, tests named after requirements)
- [ ] `PROGRESS.md` updated (status, PR, date; integration notes ticked; Finished log) and `python3 scripts/check_progress.py` passes
- [ ] Any design change recorded in the Decisions log of `PROGRESS.md`
- [ ] Linked to an issue / requirement number
- [ ] Tests added or updated for the change
- [ ] `npm run lint` and `npm test` pass locally
- [ ] No secrets or `.env` values committed
- [ ] Docs (`README.md` or `docs/`) updated if behavior changed
