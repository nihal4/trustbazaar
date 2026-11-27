# Orders

The buyer's and the seller's side of an order: the list, one order (the money panel with its steps, the deadlines, the shipment, what can be done now, the dispute slot, the other party), the meetup handover, courier shipments, disputes with their chat, ratings and receipts.

Part of the user app (`../../entries/app.tsx` registers this area's routes from `routes.tsx`). Design: Units 2, 4, 5 and 7 (`docs/design/`). The line-grid look is in [DESIGN.md](../../../../DESIGN.md).

## Pages

| Address | Page |
|---|---|
| `/orders` | the list |
| `/orders/:id` | one order; the page is the same layout for every state and role |
| `/disputes/:id` | the dispute chat, where TrustBazaar sits between the parties |

## Where to start

- `OrderPage.tsx`: the layout. `progress.ts` decides where the order is and which words its steps use (a view model, unit-tested); the page only draws it.
- `Handover.tsx` and the `Handover*` files: the meetup (the buyer's code, the seller's photos and code, proposals).
- `Actions.tsx`, `Courier.tsx`, `Shipments.tsx`, `Disputes.tsx`, `DisputePage.tsx`, `Ratings.tsx`, `ReturnStep.tsx`, `Game.tsx`, `Terms.tsx`: what can be done, and the popups for it.
- `moneyText.ts` says where the money is in one sentence (NFR-USE-07); `receipt.ts` makes the receipt.

## Talks to

The `Orders, OrderActions, Handover, Shipment, Trust (disputes, ratings)` section(s) of the API document, [docs/api/openapi.json](../../../../docs/api/openapi.json): the addresses, the shape of a request and who may call. Calls go through `useApi()` and TanStack Query (`shared/api.ts`); words are in `messages/en/orders.json` and `messages/bn/` (a test keeps the two languages in step).

## Tests

`orders.test.tsx`, `order-view.test.tsx`, `disputes-ratings.test.tsx`, `game.test.tsx`, `receipt.test.ts` (run `npm test` in `frontend/`). A test is named after the requirement it proves (`FR-ACC-01 ...`). The screens are also in the screenshot tests (`e2e/visual/`).

## Changing it

Build a screen from `shared/ui` and choose a variant; do not style a button, a field or a card here ([docs/HOW-TO.md](../../../../docs/HOW-TO.md)). A file here may not pass the size limits in `eslint.config.js`: split it the way the existing `*Shared` and `*Page` files were.
