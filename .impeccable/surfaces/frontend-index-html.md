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

OWN-WORLD: Night-market ledger. Bottle-green black ground #0A1110, text #F1F5F3, muted #A2B5B0, one vermilion #FF6B35 as the only hot colour, protect green #5DD39E only for held and verified states, error pink #FF6F8E. No filled boxes: sections are ruled by 1px hairlines (#2A3B36) and cells, the held-money cell has one 2px vermilion top rule, step numbers are plain vermilion figures, radii are nearly square (4px, controls 6px). Headlines Schibsted Grotesk 600, text and all figures Figtree, Hind Siliguri for Bangla. The one filled panel is the hero: a moving gradient ground (WebGL, grain) with a frosted-glass product window and its sheen, home only. Logotype: 'Trust' vermilion with a capital T, 'bazaar' white, a coin in each 'a'.

STORY: The buyer sees a real listing with its escrow state live (clock ticking, payment held), reads in four cards why it is safe (held money, timed auctions, ID-checked sellers, one-time handover code), sees how a purchase goes, then browses real listings.

FIRST VIEWPORT: Header (logotype, search, language, Sell). Hero panel: left, a 3-line headline, one lede, the search field as the single action; right, a glass window with a product photograph on top and its price, buy button, live clock and the three payment steps below, and one small dark card "Payment held" over its lower-left corner. The hero fills the first screen alone.

FORM: Pinned by the user in words: 'clean premium'; 'the dark one look nice ... more dynamic and glossy'; after a side-by-side comparison in the running app, 'well D [green-black palette + Schibsted Grotesk headlines] but i want you to get rid of blocks instead use lines like a line grid looks much better'. The first-surface experience (a live escrow window in a glass panel over a moving gradient ground, the 'Payment held' card) was shown to and kept by the user through every round, who approved the hero as it stands. seed: none (pinned).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
