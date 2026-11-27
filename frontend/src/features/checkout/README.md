# Checkout

Buying a fixed-price item: choosing how to receive it, seeing the total with the money steps, and paying through the payment sheet. Only verified members reach it; a guest is sent to sign in.

Part of the user app (`../../entries/app.tsx` registers this area's routes from `routes.tsx`). Design: Unit 2 (`docs/design/02_orders_payments.pdf`). The line-grid look is in [DESIGN.md](../../../../DESIGN.md).

## Pages

| Address | Page |
|---|---|
| `/checkout/:listingId` | the checkout of one listing |

## Where to start

- `CheckoutPage.tsx`: the whole page; the payment sheet itself is `shared/PaymentSheet.tsx`.
- The order is made with an `Idempotency-Key`, so a repeated tap creates one order.

## Talks to

The `Orders, Payments` section(s) of the API document, [docs/api/openapi.json](../../../../docs/api/openapi.json): the addresses, the shape of a request and who may call. Calls go through `useApi()` and TanStack Query (`shared/api.ts`); words are in `messages/en/checkout.json` and `messages/bn/` (a test keeps the two languages in step).

## Tests

`checkout.test.tsx` (run `npm test` in `frontend/`). A test is named after the requirement it proves (`FR-ACC-01 ...`). The screens are also in the screenshot tests (`e2e/visual/`).

## Changing it

Build a screen from `shared/ui` and choose a variant; do not style a button, a field or a card here ([docs/HOW-TO.md](../../../../docs/HOW-TO.md)). A file here may not pass the size limits in `eslint.config.js`: split it the way the existing `*Shared` and `*Page` files were.
