# Seller

A seller's own money pages: the dashboard (the figures of their sales: completed, owed and available, the lines of a sale such as the item, the commission and the delivery, and what needs doing) and the payout account (where the money goes, checked by an operator).

Part of the user app (`../../entries/app.tsx` registers this area's routes from `routes.tsx`). Design: Unit 2 (`docs/design/02_orders_payments.pdf`). The line-grid look is in [DESIGN.md](../../../../DESIGN.md).

## Pages

| Address | Page |
|---|---|
| `/seller` | the dashboard of sales and money |
| `/account/payout` | the payout account |

## Where to start

- `SellerPage.tsx`: the dashboard.
- `PayoutAccountPage.tsx`: the bank account and its review state; changing it needs a step-up.
- `BrandMark.tsx`: the mark of a way to be paid (bKash, Nagad or a bank).

## Talks to

The `MyListings, MyPayouts, Monetization` section(s) of the API document, [docs/api/openapi.json](../../../../docs/api/openapi.json): the addresses, the shape of a request and who may call. Calls go through `useApi()` and TanStack Query (`shared/api.ts`); words are in `messages/en/seller.json` and `messages/bn/` (a test keeps the two languages in step).

## Tests

`seller.test.tsx` (run `npm test` in `frontend/`). A test is named after the requirement it proves (`FR-ACC-01 ...`). The screens are also in the screenshot tests (`e2e/visual/`).

## Changing it

Build a screen from `shared/ui` and choose a variant; do not style a button, a field or a card here ([docs/HOW-TO.md](../../../../docs/HOW-TO.md)). A file here may not pass the size limits in `eslint.config.js`: split it the way the existing `*Shared` and `*Page` files were.
