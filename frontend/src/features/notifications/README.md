# Notifications

The notifications page: the list of what happened (an order paid, a message, an offer), marking them read, and the member's preferences for language and e-mail.

Part of the user app (`../../entries/app.tsx` registers this area's routes from `routes.tsx`). Design: Unit 6 (`docs/design/06_chat_notifications.pdf`). The line-grid look is in [DESIGN.md](../../../../DESIGN.md).

## Pages

| Address | Page |
|---|---|
| `/notifications` | the notifications and the preferences |

## Where to start

- `NotificationsPage.tsx`: the page. The unread count in the header is `shared/notifications.ts`.

## Talks to

The `Notifications` section(s) of the API document, [docs/api/openapi.json](../../../../docs/api/openapi.json): the addresses, the shape of a request and who may call. Calls go through `useApi()` and TanStack Query (`shared/api.ts`); words are in `messages/en/notifications.json` and `messages/bn/` (a test keeps the two languages in step).

## Tests

`notifications.test.tsx` (run `npm test` in `frontend/`). A test is named after the requirement it proves (`FR-ACC-01 ...`). The screens are also in the screenshot tests (`e2e/visual/`).

## Changing it

Build a screen from `shared/ui` and choose a variant; do not style a button, a field or a card here ([docs/HOW-TO.md](../../../../docs/HOW-TO.md)). A file here may not pass the size limits in `eslint.config.js`: split it the way the existing `*Shared` and `*Page` files were.
