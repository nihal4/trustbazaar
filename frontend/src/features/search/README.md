# Home and search

The front of the site: the home page (the hero, the search box, the categories, the featured and ending-soon listings, how the escrow works) and the search page with its filters. The hero's moving background is a shader (`GlowGround.tsx`) and is hidden in the screenshot tests.

Part of the user app (`../../entries/app.tsx` registers this area's routes from `routes.tsx`). Design: Unit 3 (`docs/design/03_listings_auctions.pdf`). The line-grid look is in [DESIGN.md](../../../../DESIGN.md).

## Pages

| Address | Page |
|---|---|
| `/ (home)` | the home page |
| `/search` | results with filters, a page at a time |

## Where to start

- `HomePage.tsx` and `HomeSections.tsx`: the home page.
- `SearchPage.tsx` with `SearchFilters`, `SearchActiveFilters` and `useSheet` (the filter sheet on a phone); `searchShared.tsx` is what they share.
- `ListingCard.tsx`: the card of a listing in a grid.

## Talks to

The `Search, Categories` section(s) of the API document, [docs/api/openapi.json](../../../../docs/api/openapi.json): the addresses, the shape of a request and who may call. Calls go through `useApi()` and TanStack Query (`shared/api.ts`); words are in `messages/en/search.json` and `messages/bn/` (a test keeps the two languages in step).

## Tests

`search.test.tsx`, `home.test.tsx` (run `npm test` in `frontend/`). A test is named after the requirement it proves (`FR-ACC-01 ...`). The screens are also in the screenshot tests (`e2e/visual/`).

## Changing it

Build a screen from `shared/ui` and choose a variant; do not style a button, a field or a card here ([docs/HOW-TO.md](../../../../docs/HOW-TO.md)). A file here may not pass the size limits in `eslint.config.js`: split it the way the existing `*Shared` and `*Page` files were.
