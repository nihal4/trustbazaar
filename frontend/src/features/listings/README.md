# Listings and auctions

Looking at a listing, bidding, and selling: the listing page, the auction panel and room (bids, proxy bidding, the countdown, second-chance offers), and the sell form for a physical item, an auction or a game account.

Part of the user app (`../../entries/app.tsx` registers this area's routes from `routes.tsx`). Design: Unit 3 (`docs/design/03_listings_auctions.pdf`). The line-grid look is in [DESIGN.md](../../../../DESIGN.md).

## Pages

| Address | Page |
|---|---|
| `/listings/:id` | a listing, and its auction panel when it is one |
| `/listings/:id/room` | the live auction room |
| `/sell/new, /sell/:id` | the sell form |

## Where to start

- `ListingPage.tsx` with `ListingPhotos`, `ListingDetails` and `ListingMessageSeller`; `AuctionPanel.tsx` with `AuctionBidForm` and `AuctionOffer`; `AuctionRoom.tsx`; `Countdown.tsx`.
- `SellPage.tsx` with `SellDetails`, `SellPhotos`, `SellPublish` and `SellClarifications`; `GameListing.tsx` for a game account. What the sell parts share is `sellShared.ts` and `sellOptions.ts`.
- The auction's live state is `useAuctionLive.ts`; `announcer.ts` says changes to screen readers.

## Talks to

The `Listings, Auctions, MyListings, ListingPhotos` section(s) of the API document, [docs/api/openapi.json](../../../../docs/api/openapi.json): the addresses, the shape of a request and who may call. Calls go through `useApi()` and TanStack Query (`shared/api.ts`); words are in `messages/en/listings.json` and `messages/bn/` (a test keeps the two languages in step).

## Tests

`listing.test.tsx`, `room.test.tsx`, `sell.test.tsx`, `styles.test.ts` (run `npm test` in `frontend/`). A test is named after the requirement it proves (`FR-ACC-01 ...`). The screens are also in the screenshot tests (`e2e/visual/`).

## Changing it

Build a screen from `shared/ui` and choose a variant; do not style a button, a field or a card here ([docs/HOW-TO.md](../../../../docs/HOW-TO.md)). A file here may not pass the size limits in `eslint.config.js`: split it the way the existing `*Shared` and `*Page` files were.
