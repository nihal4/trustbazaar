---
version: 1
slug: "frontend-src-features-listings-listingpage-tsx"
primary_target: "frontend/src/features/listings/ListingPage.tsx"
related_targets: []
---

# Surface: TrustBazaar listing page (the buyer's decision screen)

Scope: `frontend/src/features/listings/ListingPage.tsx` and `listings.module.css` (the fixed-price buy panel, the gallery, the seller row, details; the auction panel is restyled in the same look but could not be captured: the demo data has no auction); mode Operate, inheriting the home page's world (see DESIGN.md and `.impeccable/surfaces/frontend-index-html.md`). Audience: buyers in Bangladesh on mid-range phones deciding whether to buy a used item from a stranger; job: judge the item and the seller, then buy or save it. Constraints: Bangla and English equal, 44px targets, CSP/Trusted Types, WCAG 2.2 AA, 320px.

## Direction contract

THESIS: The listing is a ruled page where the item is the picture and the decision (price, Buy, seller) never leaves the screen: only the photos and the description scroll.
OWN-WORLD: The home page's: ground #0A1110, hairline #2A3B36, text #F1F5F3, vermilion #FF6B35 for the one action and the focus mark, protect green only for held or verified, gold only for Pro, Schibsted Grotesk 600 headings, Figtree figures. Ruled rows not boxes: the buy panel sits under a vermilion top rule; the seller is a ruled row of cells (square photo | name with a scalloped verified seal and the join year | rating and Pro | chat); details are rows between hairlines.
STORY: The buyer sees one large photo with small ones under it (press to swap; physical items have a hover magnifier), reads the title, price and the quiet payment line, presses Buy now or Save for later, checks the seller, reads the description while the right column stays in view; on wide screens the footer keeps to the left of that column.
FIRST VIEWPORT: Wide: large photo left; right column with category, title, vermilion rule, price, Buy now + Save for later side by side, one quiet line on when the seller is paid, the seller row. Phone: title, photo and thumbnails, buy panel, seller, then description and details.
FORM: Inherited from the home world; user decisions pin it: no order steps on the listing (a visitor has not paid), 'Buy now' without repeating the price, Save for later instead of a cart, the seller row layout and the Twitter-style seal. seed: none (pinned).
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
