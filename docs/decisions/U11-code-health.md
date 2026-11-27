# Decisions of the code-health series (U11)

Short notes on why the code is the way it is after the clean-up and the design system. Each says what was decided, why, and what follows from it. The full record, with dates and the user's own words, is the Decisions log in [PROGRESS.md](../../PROGRESS.md).

## One format, enforced
**Decided:** Prettier formats the whole code base, and `format:check` is a CI check. The big reformatting was one commit, listed in `.git-blame-ignore-revs`.
**Why:** a diff should show what changed, not whose editor reflowed it. **Follows:** run `npm run format` before you commit; `git blame` skips the reformatting commit.

## Screenshots are the safety net for any visual refactor
**Decided:** 92 pictures of the main screens, compared with **zero different pixels**, in a pinned Playwright container, and the job is required.
**Why:** a refactor that must change nothing needs a proof, and "it looks the same" is not one. The net found real defects by itself: an invisible footer logo in the light theme, a tab row that depended on how fast a font loaded, and sign-in pages that the net could not see at all because a mask covered the whole-screen canvas.
**Follows:** a canvas is hidden, not masked; a clock moves ten seconds before each picture. If a screen is meant to change, you re-make its baselines and look at them.

## The health ratchet: numbers only go down
**Decided:** `scripts/health-ratchet.mjs` compares ESLint, Stylelint, knip and jscpd counts with `health-baseline.json` and fails if any is higher.
**Why:** the code base had hundreds of warnings and nobody could clear them in one go. A ratchet stops it getting worse while the numbers fall by use. **Follows:** `--update` is for when the numbers went **down** (it keeps the gain); never to hide a rise.

## Tokens are the one source of every visual value
**Decided:** colours, the type scale, the spacing scale (steps of 4 px), corners and motion are tokens in `shared/tokens.css`, each holding exactly the value the site already drew; a raw colour or font in a stylesheet is a Stylelint **error**.
**Why:** changing a font or a gap once should change the whole site. Because each token equals the old value, introducing them moved no pixel (checked by the screenshots).

## Every kind of thing exists once, with variants
**Decided:** `shared/ui` holds Button, IconButton, Field, Radio, Checkbox, Notice, Tag, Count, Avatar, Panel, Section, Card, FactList, Stepper, Table, Tabs, Popup, ConfirmDialog and Calendar. A page chooses a variant; it does not style its own. The inventory found 143 variants of 13 kinds before this (55 kinds of button).
**Why:** one place to change a look, and a design that holds together. **Follows:** `shared/ui` is presentational only (a dependency-cruiser error): no API, router, features or language layer; words and data arrive as props. Mantine was removed, and our own `Button` replaced it.

## Fields are an underline, in both themes
**Decided (by the project owner):** a text field is a hairline under the text, vermilion when focused. The ruled box is a rare variant, and a textarea is always boxed. Radios are round (a ring with a dot) and checkboxes square.
**Why:** it is the look that was polished on sign-in; the light theme used to fall back to a rounded box and a solid black button, which was the inconsistency this removed.

## The first class name is not the meaning
**Learned:** a class called `.secondary` meant different things in different stylesheets (a link, the main action, a cell of a popup's button grid). Converting buttons by class name was wrong in the order and chat pages, and was taken back.
**Follows:** convert a button only when you know what the class meant there; a button inside a grid cell needs its container to become a component first (task U11-15).

## Large files are split along what they already are, and limits are errors
**Decided:** components move whole into sibling files, what two parts share goes into a shared file, and a state-heavy page becomes a hook and a page. File size, function length and cyclomatic complexity have error limits just above today's worst; they come down as files are split.
**Why:** a file nobody can hold in their head is not changed safely. **Follows:** see the last section of [docs/HOW-TO.md](../HOW-TO.md).

## The database pool, and an intermittent hang we could not reproduce
**What happened:** the integration job failed at about 10 minutes twice on pull requests with no backend change, and passed unchanged on a re-run.
**What is known:** the app used the library's default pool of 10 connections with no wait limit; a transaction holds one connection for its whole length; the code itself documents that a read needing a second connection inside a transaction can wait for ever when every connection waits for the same lock; the failing test fires exactly 10 requests at once.
**What is not known:** we could not make it fail, even with a pool of 2 or a database throttled to half a CPU, so the cause is likely and **not proven**.
**Decided:** a pool with headroom (`DB_POOL_MAX`, default 20), a limit on waiting for a connection (`DB_CONNECT_TIMEOUT_MS`, default 20 s), and a watchdog (`kernel/db/pool-watch.ts`) that logs when requests wait with no connection free. If the hang comes back, its log says whether this was the cause.

## The API document is generated, never written
**Decided:** `docs/api/openapi.json` is generated from the routes, the policy decorators, the DTO rules and the doc comments, and a test fails when it is stale or a route has no description.
**Why:** IF-COM-04 is a Must requirement; a hand-written document of 231 operations would be wrong within a week. **Not yet described:** the shape of a successful answer.

## A tool that deletes code needs to know what it cannot see
**Learned:** the tool that removed CSS rules for classes no component uses cannot see a class built at run time from a number (`cols${columns}`), and deleted the column rules of `FactList`. It was caught by reading the diff and restored. **Follows:** machine-made removals are checked against the screenshots and by looking at what went, and are never run over the design system.
