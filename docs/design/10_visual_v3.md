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

Changed on 2026-11-25 at the user's request ("change the logo and the colour combination, keep the structure"): the ink-and-mint
pairing was replaced by ink-navy and vermilion. White `#FFFFFF`, surface `#F3F5F8`, ink `#0F1720` (text and every action),
muted `#5A6472`, control border `#8590A0`, line `#E2E6EC`, peach `#FFE1D2` (soft tint: the promise bar, the payment card, the
hero ground), vermilion `#FF6B35` (the vivid highlight on ink and as a fill with ink text; never as text on white),
protected-money green `#0B6B3F` (text only), error `#B42318`. Radius 10 px controls, 16 px panels, 8 px chips. The logo is a
shopping bag whose handle is a padlock's shackle on an ink tile, with the wordmark in two weights. Contrast pairs are checked
in `visual.test.ts`.

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

## 6. Update 2026-11-25: dark theme, logo and hero photo

The user chose the dark glossy hero and asked for the rest of the app to match, a more modern hero photograph, and a logo that
highlights "Trust" and its T. The user app (`index.html`, `data-theme="dark"`) now runs on dark tokens (`tokens.css`,
`:root[data-theme='dark']`: ground `#080D14`, panels `#0F1824` and `#131F2E`, text `#F2F5F9`, links and actions vermilion
with ink text); the console, the ID check and the credentials page stay light. The logotype is "Trust" in vermilion with a
capital T and "bazaar" in white (ink on light), a coin in each "a"; the favicon is the vermilion T on an ink tile. The hero
window shows a smartphone in its box (a stand-in photograph from Wikimedia Commons, `public/img/credits.json`).

## 7. Plan for the other screens (written 2026-11-25, with the advisor and impeccable)

Order: U10-22 (search, listing page, auction panel), then U10-23 (checkout and orders), U10-25 (account, sign-in, notifications,
chat), U10-24 (listing editor and seller pages), U10-26 (ID check and credential pages), U10-27 (staff console), U10-28 (sweep).
U10-22 first because it is the next step of the buyer's path after the home search and reuses the most of the home build.

**Gate before U10-22 starts.** #306 is merged, U10-21 is marked done with the PR number, the date and a Finished log row (the checker
refuses `doing` on a task whose dependency is not done), and U10-22 is claimed on its own branch from `main`.

**First commit of U10-22, no visual change (reuse).**
- Replace the hard-coded colours of the home CSS with tokens: `#2A1B14` to `--tb-accent-soft`, `#FFB08A` to `--tb-accent-strong`,
  `#5DD39E` to `--tb-protect`, `#10281E` to `--tb-protect-soft`, `#0A1018` to `--tb-action-text`; new `--tb-accent-line` for `#5A3320`;
  radius tokens for 24, 16 and 10 (`--tb-radius-panel` is 16 while home uses 24). Add the pairs to `visual.test.ts`.
- Move into `shared/`: `EscrowSteps` (current step as a prop; replaces the home copies and `Counterfoil` on the listing, checkout and
  order pages), `Countdown` (on `useServerNow` and `formatCountdown`, the real clock of `ListingCard`'s `TimeLeft`), `BidList`, `Tag`, a
  card surface class, a section heading class, and the photo frame with its no-photo fallback.
- App screens use the themed Mantine `Button` (primary is vermilion in the dark theme), not another hand-made button.
- Home only: `GlowGround`, the glass sheen, the "Example" data. App screens are flat and show real data only.
- `Counterfoil`, `PromiseNote` and `amountWords` go only when nothing uses them (the checkout and order pages do until U10-23); each
  removal gets a Decisions-log line, and a test that pinned the old structure keeps its FR or NFR assertion and changes its document reference.

**U10-22 content.**
- Search: the filter column becomes a sheet on phones and a left rail from 1024; results use the home card grid; sort and the active
  filters as chips; empty, loading and error states in the same style.
- Listing page: photos first (a large first photo, thumbnails that never exceed the column, a swipe strip on phones); on the right the
  buy panel built from the hero window's body: price, status, the three `EscrowSteps`, the Buy button; the seller card under it with
  the identity-verified mark; details and description below. The duplicated "Price" label and the dotted money-order panel go.
- Auction panel: the home auction card's clock and bid list on the real server clock, the bid form, reserve and anti-sniping notes,
  and the closed and second-chance states.
- Breakpoints as on home: phones under 768, tablets 768 to 1023 (one column with a wide panel), 1024 and up two columns. 44 px tap targets.

**Review gates (each screen).** Build, capture 390, 768 and 1440 with real data (fixed price, auction, reserved, no photo), run the
15-device sweep and `impeccable detect`, then a fresh `impeccable-finish-reviewer` for that surface (not the home one); apply its
fix batch, get a verdict pass, then open the PR. A surface brief is written for each screen under `.impeccable/surfaces/`.

**Open decision for the user.** The colour and type review suggested a bottle-green-black palette and Schibsted Grotesk for headlines.
This is a one-place token change if decided before U10-22 spreads the system to more screens.

## 8. Update 2026-11-25: look D and the ruled grid

The user compared four looks side by side in the running app (current; green-black; Schibsted headlines; both) and chose D, and asked to
replace the filled blocks with lines, a line grid. Changes: the dark palette is a bottle-green black (ground `#0A1110`, panels `#101A19`,
surface `#16221F`, hairline `#2A3B36`, text `#F1F5F3`, muted `#A2B5B0`, held tint `#2B1A12`; the vermilion, the protect green and the error
pink are unchanged); headlines are Schibsted Grotesk at weight 600 (Figtree stays for text and all figures; Bangla unchanged); the home
page has no filled cards: sections are ruled by 1 px hairlines and cells (the bento, the purchase strip, the selling steps, the listing
grid, the category strip, the handover code); the held-money cell has one hot rule on top; step numbers are plain figures in the hot
colour; radii are nearly square (4 px for the hero, window and photos, 6 px for controls). The hero's gradient and shader colours are
tokens (`--tb-hero-*`, `--tb-glow-*`). `DESIGN.md` is updated to match.

## 9. Update 2026-11-25: the language change and the footer

Switching language no longer changes the page in front of the reader. It shows a full-page loading skeleton (shimmering blocks in the
site's own ruled layout, no text and no images, `shared/language/LanguageSkeleton.tsx`) while the new language renders underneath and
its fonts load (`ensureLangFonts` in `font.ts`: Hind Siliguri, the Bangla figures and the Latin faces are added at once and awaited),
holds for at least 750 ms, then fades out in 300 ms, so the change of typeface is never seen. The page is marked `aria-busy` while it
shows; reduced motion drops the shimmer. Box heights are pinned so a box has the same shape in English and Bangla. The footer is three
ruled columns on the page's thirds (the brand, Explore, Help); the "see all" links are text with an orange arrow and underline.


## 10. The auction room (design note, 2026-11-25; for approval before it is built)

Owner's idea: bidders who want to watch an auction live join a dedicated room that shows every bid as it happens, like people seated in a council, and bid or sit out from there. The listing page keeps the quick view: the bid bar (price, clock, See the bids, bid box). The room is the second, immersive view; the bar gets a "Join the live room" cell that opens it. Prototype: `frontend/public/proto-auction/c.html` (static, simulated).

Route and who: `/listings/:id/room`, signed-in users only (guests have no live channel; DV-19). The seller sees it read-only. It exists only while the auction is open; after the close it shows the result and links to the listing.

Screen (laptop and wide): a header row (small photo, title, "Live" mark, time left, number of bidders); left, the stage: bidders seated in an arc, one seat per bidder alias (Bidder 1, 2 ...), the leader's seat in vermilion, the viewer's own seat ringed in white, the current price at the centre below the arc; under the stage the controls: three quick-bid buttons (the next minimum plus one, two and three increments, with the resulting amount shown), a field for the viewer's own maximum, Place bid, and "Sit this one out"; right, the live bid list (newest on top, new rows flash once). On phones the stage is a compact arc above the list, the controls are a bar at the bottom.

Data and rules: everything comes from the existing auction state, bid history, `/my-status` and the live channel `auction:{id}`; bids go through the existing bid API with its confirmation dialog (a quick-bid button opens the same dialog; nothing is sent in one press, FR-AUC and section 8.4). The anti-sniping extension shows on the clock. Aliases only (FR-ACC-10; no names). Seats are the bidders who have bid, because the server does not report who is merely watching; a "watching" count and seats for watchers need presence on the live channel (backend, a separate task).

"Sit this one out": proposed meaning: the viewer stays in the room as a watcher, gets no alerts for this auction, and the price is not affected (bidding is by maximum, so not bidding is already the default). It needs no server support in the first version (the choice is kept on the page only).

Accessibility: the arc is decoration (aria-hidden); the live list and the controls carry the meaning; announcements keep the existing throttle (5 s, outbid at once); no motion beyond one short flash per new bid, and none with reduced motion; the room works with the keyboard and at 320 px; English and Bangla equal.

Open for the owner: (1) the meaning of "Sit this one out"; (2) whether version one may ship without presence (seats = bidders only); (3) whether quick-bid buttons stay (they only shortcut the amount; the dialog still confirms).
