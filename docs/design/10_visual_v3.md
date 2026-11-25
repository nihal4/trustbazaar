# Visual design, version 3 (U10-21 to U10-28)

Status: in progress (U10-21, 2026-11-25). Replaces the money-order world of `10_visual_v2.md`, which the course teacher
rejected and asked to be made more advanced. Product truth stays in `PRODUCT.md`. Scope: presentation only; features,
routes, API calls and the FR-named tests stay.

## 1. Direction

Chosen with the user: "clean premium", a full re-layout (new header, home, cards, listing, checkout), not a re-skin.
The first attempt (blue gradient, glow, floating cards, a kicker label) was rejected as generic. The rebuild follows
the two design skills' real tools:

- taste-skill's dealer (`start.mjs deal`, `deal.mjs`): palette "white-mint-tiles" (taken over the dealt dark palettes
  because the user chose a light look and the buyers use cheap phones in daylight), type "gabarito" (Gabarito for
  headlines at weight 400, Figtree for text, self-hosted; Hind Siliguri for Bangla), radius soft, hero "collage".
- impeccable's craft floor and detector (`impeccable detect`): no kicker above a heading, no gradient text, no glass,
  no glow, no one-sided bars, no overused font. The detector reports no findings on the changed files.

## 2. Tokens

White `#FFFFFF`, surface `#F3F3F3`, ink `#232323` (text and every action), muted `#686868`, control border `#8A8A8A`,
line `#E4E4E4`, mint `#A1FFCB` (the highlight: chips, ticks, the promise bar; never text on white), protected-money
green `#0B6B3F` (text only), error `#B42318`. Radius 10 px controls, 16 px panels, 8 px chips. Shadows only on the
product window and the small card. Contrast pairs are checked in `visual.test.ts`.

## 3. Structure

- Shell: a mint promise bar, a sticky white header with the logo, a search field, links and the Sell button; an ink
  footer; on phones a standard bottom bar.
- Home: the hero is alone on the first screen (text left, search as the one action; right, a lit mint frame holding a
  window of a real listing, with a real photograph, the price, the buy button and the three payment steps, cut by the
  frame, and one small "Payment held" card). Then the categories, "Your money waits with us" in three steps, the
  auctions on a swipe rail, featured, newest and a flat ink selling band.
- Listing cards: the photo leads; the card lifts 2 px and the photo zooms 1.03 inside its frame.

## 4. Photographs

The listing photographs in the hero window are stand-ins from Wikimedia Commons, fetched with taste-skill's
`photos.mjs` into `frontend/public/img/` (the credits are in `credits.json` there). Replace them with TrustBazaar's own
photographs before release. Item photographs elsewhere come from sellers.

## 5. Still to do

Listing page, checkout, orders, sell, account, ID check, staff and the sweep (U10-22 to U10-28); the footer's credit
line for the stand-in photographs; the Bangla check of the new screens.
