# ID check (KYC)

The identity verification wizard, a document of its own (`entries/kyc.tsx`): the details, a picture of each side of the document, the selfies with a liveness action, and the review status at every step. It loads none of the rest of the app.

Part of the user app (`../../entries/app.tsx` registers this area's routes from `routes.tsx`). Design: Unit 1 (`docs/design/01_identity_access.pdf`). The line-grid look is in [DESIGN.md](../../../../DESIGN.md).

## Pages

| Address | Page |
|---|---|
| `/account/kyc/*` | the wizard and the page of a finished check |

## Where to start

- `KycPage.tsx`: the page that decides what to show (the wizard, or the status after a submission).
- `KycWizard.tsx`: the steps; `Capture.tsx` takes a picture from the camera or a file; `camera.ts` talks to the browser's camera.
- `model.ts`: the status and the steps of the wizard as plain code.

## Talks to

The `Kyc` section(s) of the API document, [docs/api/openapi.json](../../../../docs/api/openapi.json): the addresses, the shape of a request and who may call. Calls go through `useApi()` and TanStack Query (`shared/api.ts`); words are in `messages/en/kyc.json` and `messages/bn/` (a test keeps the two languages in step).

## Tests

`kyc.test.tsx`, `model.test.ts` (run `npm test` in `frontend/`). A test is named after the requirement it proves (`FR-ACC-01 ...`). The screens are also in the screenshot tests (`e2e/visual/`).

## Changing it

Build a screen from `shared/ui` and choose a variant; do not style a button, a field or a card here ([docs/HOW-TO.md](../../../../docs/HOW-TO.md)). A file here may not pass the size limits in `eslint.config.js`: split it the way the existing `*Shared` and `*Page` files were.
