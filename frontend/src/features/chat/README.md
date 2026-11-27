# Chat

The conversations between a buyer and a seller about a listing: the thread list, one conversation (a Messenger-style layout drawn on the line grid, shared with the dispute chat), photos with captions, blocking and reporting. New messages arrive over the live connection.

Part of the user app (`../../entries/app.tsx` registers this area's routes from `routes.tsx`). Design: Unit 6 (`docs/design/06_chat_notifications.pdf`). The line-grid look is in [DESIGN.md](../../../../DESIGN.md).

## Pages

| Address | Page |
|---|---|
| `/messages` | the thread list, newest first, with the unread count in words and a number |
| `/messages/:thread` | one conversation |

## Where to start

- `ThreadsPage.tsx`: the list.
- `ThreadPage.tsx`: one conversation; `MessageItem.tsx` is a message, `Dock.tsx` the box at the bottom, `ThreadActions.tsx` block and unblock, `ReportForm.tsx` the report popup.
- `model.ts`: what the API answers and the bridge to the reference thread in `lib/live.js`, which orders messages and recognises our own by their client id.

## Talks to

The `Chat` section(s) of the API document, [docs/api/openapi.json](../../../../docs/api/openapi.json): the addresses, the shape of a request and who may call. Calls go through `useApi()` and TanStack Query (`shared/api.ts`); words are in `messages/en/chat.json` and `messages/bn/` (a test keeps the two languages in step).

## Tests

`chat.test.tsx` (run `npm test` in `frontend/`). A test is named after the requirement it proves (`FR-ACC-01 ...`). The screens are also in the screenshot tests (`e2e/visual/`).

## Changing it

Build a screen from `shared/ui` and choose a variant; do not style a button, a field or a card here ([docs/HOW-TO.md](../../../../docs/HOW-TO.md)). A file here may not pass the size limits in `eslint.config.js`: split it the way the existing `*Shared` and `*Page` files were.
