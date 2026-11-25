---
version: 1
slug: "frontend-index-html"
primary_target: "frontend/index.html"
related_targets: []
---

# Surface: the TrustBazaar user app, redesign v3 (home first)

Scope: the user app (`frontend/index.html`, its routes). Home is a Persuade surface, the other routes are Operate. Audience: buyers in Bangladesh on mid-range Android phones, English and Bangla equal. Constraints: CSP `style-src 'self'`, Trusted Types, self-hosted fonts, 170 KB first-load JS, WCAG 2.2 AA, 320 px.

## Direction contract

THESIS: Paying a stranger is safe because the money is held until you have the item; the page shows that mechanism live instead of claiming it. Refuses the category default: a white classifieds grid with a "secure checkout" badge.

OWN-WORLD: Night-market dark. Ground #080D14, panels #0F1824 and #131F2E, text #F2F5F9, one vermilion #FF6B35 as the only hot colour, peach-brown tint #2A1B14 for the held-money card. Gabarito for headlines at weight 400, Figtree for text, Hind Siliguri for Bangla. Frosted-glass panels with a passing sheen only on the hero window and its card; everything else flat with 1px hairlines. Moving gradient ground (WebGL, grain) in the hero only. Logotype: "Trust" vermilion with a capital T, "bazaar" white, a coin in each "a".

STORY: The buyer sees a real listing with its escrow state live (clock ticking, payment held), reads in four cards why it is safe (held money, timed auctions, ID-checked sellers, one-time handover code), sees how a purchase goes, then browses real listings.

FIRST VIEWPORT: Header (logotype, search, language, Sell). Hero panel: left, a 3-line headline, one lede, the search field as the single action; right, a glass window with a product photograph on top and its price, buy button, live clock and the three payment steps below, and one small dark card "Payment held" over its lower-left corner. The hero fills the first screen alone.

FORM: Pinned by the user: "clean premium", then "the dark one look nice ... more dynamic and glossy", seed: none (pinned).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
