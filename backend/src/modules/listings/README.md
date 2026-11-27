# Listings (Unit 3)

What is for sale: creating and publishing a listing, photos, the review of a listing that was held, search, and the auction engine: bids, proxy bidding, anti-sniping, closing, second-chance offers and the shill detector. Also the stock of fixed-price items.

Design: [docs/design/03_listings_auctions.pdf](../../../../docs/design/03_listings_auctions.pdf). Database schema(s): `listings`, `auctions` (`docs/design/sql/`, changed by `backend/src/migrations/`). Requirements: `docs/srs.tex`.

## What is inside

- `http/`: Listings, Auctions, Search and the staff controllers.
- `services/`: `listing.service`, `listing-commands.service`, `listing-review.service`, `search.service`, `bid.service`, `auction-closer.service`, `second-chance.service`, `shill-detector.service`, `stock.service`, `media` (photos, re-encoded without metadata).
- `db/entities/`: the schema as TypeORM sees it. `ports/`: the unit's public face. `consumers/` and `jobs/`: handlers of other units' events and scheduled work (`auctions.jobs`: closes auctions, expires second-chance offers, runs the shill detector).

## Its ports (what other units may call)

`LISTINGS_PORT`, `LISTINGS_COMMANDS`, `AUCTION_QUERY`, `LISTINGS_QUERIES`: see `ports/index.ts`. **Another unit never imports this unit's files or reads its tables** (DC-1); it asks a port, and when a change must happen together with one here the port is called in the caller's transaction (DC-13). ESLint and `src/import-boundaries.spec.ts` enforce it.

## Worth knowing

The auction row is locked in the transaction of a bid and of a decision on an offer; the concurrency suite (`backend/test/concurrency/bidding.spec.ts`) tests it.

## Tests

Unit tests are the `*.spec.ts` files beside the code. The API and database tests are in `backend/test/` (`api/`, `security/`, `concurrency/`) and need PostgreSQL and Redis ([docs/HOW-TO.md](../../../../docs/HOW-TO.md), "Run the integration suite"). A test is named after the requirement it proves.

## Adding to it

A new route: a controller method with a policy decorator, a DTO and a doc comment, then regenerate the API document ([docs/api/README.md](../../../../docs/api/README.md)). A new table: the design SQL first, then a migration. See [docs/HOW-TO.md](../../../../docs/HOW-TO.md).
