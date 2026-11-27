# Privacy ('Your data')

What a member controls about their data: asking for a copy of it (a file that is ready later) and closing the account, with what closing does stated first (the sessions end, the records that must be kept are kept, the rest is erased).

Part of the user app (`../../entries/app.tsx` registers this area's routes from `routes.tsx`). Design: Unit 7 (`docs/design/07_disputes_trust_staff.pdf`). The line-grid look is in [DESIGN.md](../../../../DESIGN.md).

## Pages

| Address | Page |
|---|---|
| `/account/privacy` | the 'Your data' tab |

## Where to start

- `PrivacyPage.tsx`: the page; the export is asked for, then checked until it is ready; closing the account is a popup that says its effects before it asks.

## Talks to

The `Trust (the /me data and privacy routes)` section(s) of the API document, [docs/api/openapi.json](../../../../docs/api/openapi.json): the addresses, the shape of a request and who may call. Calls go through `useApi()` and TanStack Query (`shared/api.ts`); words are in `messages/en/privacy.json` and `messages/bn/` (a test keeps the two languages in step).

## Tests

`privacy.test.tsx` (run `npm test` in `frontend/`). A test is named after the requirement it proves (`FR-ACC-01 ...`). The screens are also in the screenshot tests (`e2e/visual/`).

## Changing it

Build a screen from `shared/ui` and choose a variant; do not style a button, a field or a card here ([docs/HOW-TO.md](../../../../docs/HOW-TO.md)). A file here may not pass the size limits in `eslint.config.js`: split it the way the existing `*Shared` and `*Page` files were.
