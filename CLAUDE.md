# TrustBazaar: instructions for Claude

This repository is built from a finished design. Before writing or changing any code:

1. Read `BUILDING.md` (the builder guide). Its rules are mandatory, especially section 10.
2. Read `PROGRESS.md` and run `python3 scripts/check_progress.py --next` to see which tasks can be started.
3. Read the design sections of the task: the unit's document in `docs/design/` and the integration notes
   listed under the unit in `PROGRESS.md`. The SRS is `docs/srs.tex`.

Always:

- Work on one task from `PROGRESS.md`, claimed in that file (status `doing`, owner, branch).
- Use the code structure and conventions of `BUILDING.md` sections 3 and 4.
- Name tests after the requirement they prove (`FR-AUC-04 ...`), and run them before saying a task is done.
- Update `PROGRESS.md` in the same change: status, PR, date, ticked notes, Finished log.
- Record any design change in the Decisions log of `PROGRESS.md`; never change the design silently.
- Never commit secrets, `.env` values or personal data.

If a request does not match a task, or the design does not answer a question, ask the user before coding.
