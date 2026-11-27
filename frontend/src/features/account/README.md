# Account

Everything about being a member: registering, signing in, resetting a password, the account page, and security (the live sessions, the password, the mobile number, the e-mail address and the authenticator app), plus the terms and the privacy notice. Sign-in and registration sit on a ruled card over the site's line grid.

Part of the user app (`../../entries/app.tsx` registers this area's routes from `routes.tsx`). Design: Unit 1 (`docs/design/01_identity_access.pdf`). The line-grid look is in [DESIGN.md](../../../../DESIGN.md).

## Pages

| Address | Page |
|---|---|
| `/register, /signin, /reset` | registration, sign-in and password reset on the ruled card |
| `/reset-password, /verify-email` | the pages of an e-mailed link |
| `/account` | the profile and what is verified |
| `/account/security` | sessions, password, phone, e-mail, authenticator |
| `/help/terms, /help/privacy` | the terms and the privacy notice |

## Where to start

- `SignInPage.tsx`: the steps of sign-in (login, password, then a code when one is needed). One error text for every failure, so the page never tells which accounts exist.
- `RegisterPage.tsx` and `registerFlow.tsx`: one question at a time; the flow (state, checks, calls) is the hook, the page draws the steps. The steps are history entries, so Back works.
- `SecurityPage.tsx` and the `Security*` and `Mfa*` files: each setting is a row that opens its form in a popup; a sensitive change asks for a step-up first (`shared/stepUp`).
- `AuthSplit.tsx` and `GridCanvas.tsx`: the page behind sign-in: a canvas of grid cells with the ruled form frame on its lines.

## Talks to

The `Auth, Registration, Account` section(s) of the API document, [docs/api/openapi.json](../../../../docs/api/openapi.json): the addresses, the shape of a request and who may call. Calls go through `useApi()` and TanStack Query (`shared/api.ts`); words are in `messages/en/account.json` and `messages/bn/` (a test keeps the two languages in step).

## Tests

`account.test.tsx`, `mfa.test.tsx`, `input.test.ts`, `qr.test.ts` (run `npm test` in `frontend/`). A test is named after the requirement it proves (`FR-ACC-01 ...`). The screens are also in the screenshot tests (`e2e/visual/`).

## Changing it

Build a screen from `shared/ui` and choose a variant; do not style a button, a field or a card here ([docs/HOW-TO.md](../../../../docs/HOW-TO.md)). A file here may not pass the size limits in `eslint.config.js`: split it the way the existing `*Shared` and `*Page` files were.
