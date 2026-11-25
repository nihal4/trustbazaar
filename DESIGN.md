---
name: TrustBazaar
description: Bottle-green-black marketplace for Bangladesh where the page shows the held-money mechanism live; one vermilion action colour, everything ruled by hairlines and dividers instead of boxes.
colors:
  ground: "#0a1110"
  panel: "#101a19"
  surface: "#16221f"
  hairline: "#2a3b36"
  control-border: "#66807a"
  text: "#f1f5f3"
  text-muted: "#a2b5b0"
  hero-lede: "#b8c7c2"
  vermilion: "#ff6b35"
  vermilion-hover: "#ff8a5c"
  vermilion-text: "#ff7a45"
  peach-text: "#ffb08a"
  held-tint: "#2b1a12"
  protect-green: "#5dd39e"
  protect-green-ground: "#10281e"
  pro-gold: "#e8b84a"
  error-pink: "#ff6f8e"
  error-text: "#ffb3c0"
  error-ground: "#2b1219"
  on-vermilion: "#0a1018"
  hero-start: "#0a1110"
  hero-mid: "#10231f"
  hero-end: "#3a1d12"
  search-well: "#f1f5f3"
  paper: "#ffffff"
  ink: "#0f1720"
typography:
  display:
    fontFamily: "Schibsted Grotesk Variable, TB Figures, Hind Siliguri, system-ui, sans-serif"
    fontSize: "clamp(2.5rem, 5.6vw, 4rem)"
    fontWeight: 600
    lineHeight: 1.04
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Schibsted Grotesk Variable, TB Figures, Hind Siliguri, system-ui, sans-serif"
    fontSize: "clamp(1.75rem, 3.6vw, 2.5rem)"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Schibsted Grotesk Variable, TB Figures, Hind Siliguri, system-ui, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.015em"
  buy-price:
    fontFamily: "Figtree Variable, TB Figures, Hind Siliguri, system-ui, sans-serif"
    fontSize: "clamp(2.25rem, 1.8rem + 1.6vw, 3rem)"
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: "-0.03em"
    fontFeature: "tabular-nums"
  step-number:
    fontFamily: "Schibsted Grotesk Variable, TB Figures, Hind Siliguri, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1
    fontFeature: "tabular-nums"
  lede:
    fontFamily: "Figtree Variable, TB Figures, Hind Siliguri, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 400
    lineHeight: 1.5
  body:
    fontFamily: "Figtree Variable, TB Figures, Hind Siliguri, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  price:
    fontFamily: "Figtree Variable, TB Figures, Hind Siliguri, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.01em"
    fontFeature: "tabular-nums"
  figure:
    fontFamily: "Figtree Variable, TB Figures, Hind Siliguri, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.2
    fontFeature: "tabular-nums"
  label:
    fontFamily: "Figtree Variable, TB Figures, Hind Siliguri, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.4
rounded:
  box: "4px"
  control: "6px"
  tag: "2px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  section: "72px"
  max-width: "82rem"
components:
  button-primary:
    backgroundColor: "{colors.vermilion}"
    textColor: "{colors.on-vermilion}"
    rounded: "{rounded.box}"
    height: "48px"
    padding: "0 24px"
  button-primary-hover:
    backgroundColor: "{colors.vermilion-hover}"
  search-hero:
    backgroundColor: "{colors.search-well}"
    textColor: "{colors.ink}"
    rounded: "{rounded.box}"
    padding: "6px 6px 6px 16px"
  button-buy:
    backgroundColor: "{colors.vermilion}"
    textColor: "{colors.on-vermilion}"
    rounded: "{rounded.control}"
    height: "52px"
    padding: "0 24px"
  button-buy-hover:
    backgroundColor: "{colors.vermilion-hover}"
  nav-cell:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.text}"
    width: "52px"
    height: "48px"
  nav-cell-hover:
    backgroundColor: "{colors.surface}"
  tab-item:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.text-muted}"
    height: "58px"
  dialog:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    padding: "24px"
  bid-bar:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    typography: "{typography.figure}"
  quick-bid:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.text}"
    height: "52px"
  quick-bid-hover:
    backgroundColor: "{colors.surface}"
  count-cell:
    textColor: "{colors.text}"
    typography: "{typography.figure}"
  seller-row:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.text}"
    height: "80px"
  pro-badge:
    textColor: "{colors.pro-gold}"
    rounded: "{rounded.box}"
    height: "20px"
  category-item:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.text}"
    height: "52px"
    padding: "0 24px"
  category-item-hover:
    backgroundColor: "{colors.surface}"
  cell:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.text}"
    padding: "32px"
  cell-held:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.text}"
    padding: "32px"
  step-figure:
    textColor: "{colors.vermilion}"
    typography: "{typography.step-number}"
  digit-cell:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.text}"
    typography: "{typography.figure}"
    height: "52px"
  listing-tag-featured:
    backgroundColor: "{colors.held-tint}"
    textColor: "{colors.text}"
    rounded: "{rounded.tag}"
---

# Design System: TrustBazaar

## Overview

**Creative North Star: "The Night Market"**

TrustBazaar is a marketplace for buyers in Bangladesh, in English and Bangla at equal weight. The shipped home page is a bottle-green black ground with white-grey text and a single vermilion that does all the calling. The page proves safety by showing the mechanism (a real listing, a live clock, a "Payment held" card) rather than asserting it with a badge.

The system is ruled, not boxed, and that is the heart of the look. Across the user app (home, search, listing page, auction room, header, footer, dialog) there are no filled cards and no outlined or rounded boxes except buttons and images: sections, rows, cells, fields and dialogs are separated by 1px hairlines and dividers, and grids are cells in the page colour over a 1px gap that shows the hairline colour. Depth comes from lines and tone, not shadow. The exception is the home hero, which carries a moving WebGL gradient ground and a frosted-glass product window with a passing sheen; these exist only on the home hero and are not part of the shared system.

Colour has jobs. Vermilion is for actions, the live signal, step figures and the one 2px rule that tops a panel asking for an action. Protect Green marks money that is held and sellers that are verified. Pro Gold marks Pro sellers. Error Pink is for errors, being outbid, the last-hour clock and the live dot.

**Key Characteristics:**
- Dark theme on the user app (`data-theme="dark"`); the console, ID check and credentials pages stay on the light tokens.
- Ruled Grid: hairlines and cells, no filled cards, no outlined or rounded boxes except buttons and images; radii nearly square (4px images and buttons, 6px the larger buttons).
- One vermilion voice; green only for held or verified; gold only for Pro and the rating star.
- Schibsted Grotesk 600 for headlines, Figtree for text and every figure.
- Hero fills the first screen alone; its moving ground falls back to a still CSS gradient.
- 44px minimum tap targets; reduced motion switches every animation off.

## Colors

A bottle-green black ground with one vermilion voice and a green that only ever means "protected".

### Primary
- **Vermilion** (`--tb-hot`, `--tb-action` in dark): the primary button ground, the search submit, the Sell call, the live-clock dot, the step figures, the 2px top rule of the held-money cell, buy panel, auction panel, bid bar, room controls and confirm dialog, the focus underline on text fields, hover rules on outlined cells, the selected tick and chevrons, the leader's seat and the newest bid, the current phone tab's top line and the category strip's first-item underline. Text on it is Night Ink (#0a1018), never white.
- **Vermilion Hover** (#ff8a5c): hover on vermilion buttons; also the dark-theme focus ring.
- **Vermilion Text** (#ff7a45, `--tb-accent`): links and accent text on the dark ground.
- **Peach Text** (#ffb08a, `--tb-accent-strong`): strong accent text; also the pale stop of the shader.

### Secondary
- **Protect Green** (#5dd39e, `--tb-protect`, `--tb-success`): held and verified states only: the current timeline step, tick marks, the verified seal, the "you lead" lines, the "Payment held" tick. On Protect Green Ground (#10281e). The buy panel carries none: nothing is held until the visitor pays.

### Tertiary
- **Pro Gold** (#e8b84a, `--tb-gold`, defined in `features/listings/listings.module.css`): the Pro Seller badge and, by intent, the seller's rating star, nothing else. Never an action colour.
- **Held Tint** (#2b1a12, `--tb-accent-soft`): the "Featured" tag on listings. A brown tint, not an orange fill.
- **Error Pink** (#ff6f8e, `--tb-error`) on Error Ground (#2b1219), text Error Text #ffb3c0 (`--tb-error-text`): errors, being outbid, the last-hour clock digits and the live auction dot.

### Neutral
- **Ground** (#0a1110, `--tb-bg`): the page and every ruled cell.
- **Panel** (#101a19, `--tb-sheet`, `--tb-ink`): the footer and the always-dark ink.
- **Surface** (#16221f, `--tb-surface`): hover wash on category items, header icon cells, quick bids and room actions; photo wells.
- **Hairline** (#2a3b36, `--tb-line`): every rule, cell gap and strip edge.
- **Control Border** (#66807a, `--tb-border`): the rules under fields and search, the phone tab bar's top line, dialog foot, quick-bid and room-action rules; 3:1 or better.
- **Text** (#f1f5f3) and **Text Muted** (#a2b5b0): body and secondary copy. Hero lede and proof line use #b8c7c2.
- **Hero Gradient** (#0a1110 to #10231f at 60% to #3a1d12, 135deg; `--tb-hero-from`, `--tb-hero-mid`, `--tb-hero-to`): the hero's still ground, under the WebGL canvas. The shader reads `--tb-glow-0` to `--tb-glow-3` (#0a1110, #10231f, #ff6b35, #ffb08a).
- **Search Well** (#f1f5f3 at 96%): the home hero search field's pale well, with Ink text.
- **Paper** (#ffffff) and **Ink** (#0f1720): the light theme's ground and action, and the hero search field's text.

### Named Rules
**The One Hot Colour Rule.** Vermilion is the only hot colour. It marks an action, a live signal or a single rule or figure; it is never a large fill and never carries white text.

**The Protect Green Rule.** Green means held or verified money and nothing else. Do not use it for "success" decoration or for brand accent. Being outbid is pink, not green.

**The Gold Rule.** Gold is for Pro and the rating star only; never an action, a fill or a rule.

## Typography

**Display Font:** Schibsted Grotesk Variable (with TB Figures, Hind Siliguri, system-ui)
**Body Font:** Figtree Variable (with TB Figures, Hind Siliguri, system-ui, Segoe UI, Roboto)
**Bangla:** Hind Siliguri (Bengali block, 400 to 700), loaded only when the language is Bangla, with the TB Figures face first in the Bangla stack.

**Character:** A tight grotesque for headlines over a friendly humanist text face. Headlines are weight 600 (`--tb-display-weight`) with negative tracking; every figure, including prices, uses Figtree with tabular numerals.

### Hierarchy
- **Display** (600, clamp 2.5rem to 4rem, 1.04, -0.03em): the home hero headline only, balanced wrap.
- **Headline** (600, clamp 1.75rem to 2.5rem, 1.1, -0.025em): section headings, each under a hairline.
- **Title** (600, 1.375rem, 1.2, -0.015em): showcase cell headings. Journey step headings use 1.25rem.
- **Step figure** (Schibsted 600, 1.5rem, tabular): plain vermilion numerals for selling and journey steps; no tile behind them.
- **Lede** (400, 1.25rem, 1.5, max 34rem): the line under the hero headline, in #b8c7c2.
- **Body** (400, 1rem, 1.5; cell copy capped at 36ch): running text, in Text Muted in cells.
- **Price** (Figtree 600, 1.25rem on listing cards, 1.75rem hero window, tabular, -0.01em to -0.02em). The listing page's buy price and the auction's current price are Figtree 600 at clamp(2.25rem, 1.8rem + 1.6vw, 3rem), -0.03em; the room's price is clamp(2rem to 3rem).
- **Figure** (Figtree 600, 1.5rem, tabular): live clock, bid bar values and the handover-code digits. Countdown cells use 1.25rem over a 0.75rem muted unit label; ledger amounts 1.125rem.
- **Label** (600, 0.875rem): captions, tags (0.75rem to 0.8125rem). Listing page section headings are Schibsted 600 at 1.5rem; the listing title clamp(1.5rem to 2rem), 1.12.

### Named Rules
**The Ticking Figures Rule.** Every number, static or ticking (clocks, prices, bids, codes), is Figtree with `tabular-nums`. Schibsted Grotesk sets words, and the step numerals only.

**The Bangla Face Rule.** In Bangla the stack becomes `TB Figures, Hind Siliguri, Figtree`, line height 1.7 for body and 1.3 to 1.4 for headings, headings drop to weight 500 with letter-spacing 0. Digits, the taka sign and the separators between them always come from TB Figures so numbers read in one face.

## Layout

One centred column, `max-width: 82rem`, with a fluid gutter of `clamp(1rem, 4vw, 3.5rem)` shared by header, main and footer. Home sections stack with a 4.5rem gap. The hero pads 20px on phones, 40px on tablets and 56px on laptops. Sections open with a 1px hairline and 1.5rem of padding before the heading.

Layout is a ruled grid: a `display: grid` with `gap: 1px` over a `--tb-line` background, cells in the page colour, edges closed by block borders. Cells carry padding on the inside edge only, so outer cells align to the column.

Breakpoints are fixed at three bands (the listing page, search and room split into columns at 60rem, and the bid bar's room cell wraps between 48em and 75em):
- **Phones, under 768px (48em):** one column; listing grid two across (search results the same); the showcase one column; the category strip scrolls sideways; steps stacked with rules between.
- **Tablets, 768 to 1023px:** hero still one column; home listing grid four across, search results three (four from 80rem); showcase two columns with the payment cell spanning both; journey in a 2 by 2; selling heading and button on one row over the steps.
- **Laptop, 1024px and up (64em):** hero in two columns (5fr / 6fr, min height `min(40rem, 100svh - 7rem)`); showcase in twelve columns (5/7, then three spans of 4); journey in four ruled steps; selling steps in three ruled columns.

Listing page: from 60rem the page is a 1.4fr photo and description column and a 20 to 27rem right rail with a 3rem gap; at 46rem window height and up the rail is sticky at 5.75rem under the header and scrolls inside itself (max-height 100svh minus 6.5rem) when taller than the window. Auction listings flow without a rail. Search: from 60rem a 16.5rem filter rail and results with a 3rem gap; below it filters are a bottom sheet. Room: from 60rem the stage and controls beside a 22rem live-bids column. Details are two columns from 30rem with one vertical hairline. Narrow-phone adjustments at 30rem and 26rem (smaller tags, search icon hidden). Every button and stand-alone link is at least 44px tall. The live UI sits at the bottom of each cell so copy above aligns.

## Elevation & Depth

Flat, ruled. Surfaces carry no shadow and no fill: separation is a 1px hairline, a 2px vermilion rule or a gap-1px cell grid. The listing bid bar, its bid-history sheet, the header, the footer, the phone tab bar and the confirm dialog have no shadow. Listing cards on the home and search lift 2px on hover and the photo zooms 1.03 inside its frame. Shadows exist only for the home hero's floating pieces and two overlays that must separate from the page (the phone filter sheet and the desktop dropdown menu).

### Shadow Vocabulary
- **Hero window** (`inset 0 1px 0 rgb(255 255 255 / .3), 0 40px 80px -30px rgb(0 0 0 / .7)`): the glass window only.
- **Hero search** (`0 18px 40px -18px rgb(0 0 0 / .55)`): the hero search well.
- **Hero payment card** (`0 20px 40px -16px rgb(0 0 0 / .7)`): the small "Payment held" card.
- **Filter sheet** (`0 -24px 48px rgb(0 0 0 / .5)`): the phone filter sheet over its 60% black backdrop.
- **Dropdown menu** (`0 18px 36px rgb(0 0 0 / .5)`): the ruled menu from 60rem, floating under its field.
- **Rules drawn as inset shadow** (`inset 0 2px 0 var(--tb-hot)` held-money cell top; `inset 0 -2px 0 var(--tb-hot)` focus underline on search, fields, bid input and the category first item, and the room action that is on; `inset 3px 0 0 var(--tb-hot)` the newest bid): these are lines, not depth. Forced-colours mode swaps them for real borders.
- **Card / Lift** (`--tb-shadow-card`, `--tb-shadow-lift`): defined in the tokens, used by no shipped surface.

### Named Rules
**The Ruled Grid Rule.** Lines, not boxes. Separate content with 1px hairlines (`--tb-line`) and ruled cells; do not fill a card, do not outline one with a box. Only buttons and images keep a box. A section, strip, list, field, dialog or code is a rule above it, rules between its cells, and nothing else.

**The Hot Top Rule.** A panel that asks the visitor for an action (buy, bid, the bid bar, the room's controls, the confirm dialog) is topped by one 2px vermilion rule on the page or sheet colour. An ended or sold auction loses it and returns to a hairline.

**The Rule-Not-Ring Rule.** A text field has no box and no ring: it is a 1px control-border line under it, and focus draws a 2px vermilion underline. Buttons and cells take a 2px vermilion focus ring, inset on cells.

**The Home-Only Glass Rule.** The WebGL gradient ground (four-colour mesh with grain, pointer-following light, still fallback) and the frosted-glass window with its 7-second sheen exist only on the home hero. New screens do not use backdrop blur, sheen or a moving ground.

## Shapes

Nearly square, and mostly no shape at all. **4px** for images and photo frames (listing photos, gallery stage and 72px thumbnails, seller avatar, room thumbnail), the hero and its glass window, the search submits and the Sell button, and the small outlined tags; **6px** for the larger buttons (Buy now, Save for later, dialog actions, See the bids outline); **2px** for the clock and Featured tags on cards. Everything else is square-cornered with no outline: header icon cells, footer language switch, tab bar, bid bar and its cells, countdown cells, quick bids, room stage and actions, ledger, seller row, details, dialog, form fields and dropdown menus. Dots, the bid-seat chip and the SVG seats are circles. There are no pills in the shell, header, footer or listing surfaces (`--tb-radius-pill` remains defined and is still used by older screens: privacy, chat, notifications, account). Tokens: `--tb-radius-panel` 4px, `--tb-radius-control` 6px.

## Components

### Buttons
- **Shape:** 4px radius on the home and search (48px tall, 24px padding); the listing page's Buy now is 6px, 52px tall, 1.0625rem; dialog actions 6px, 48px.
- **Primary:** Vermilion ground (#ff6b35) with Night Ink text (#0a1018), weight 700.
- **Hover / Focus:** ground to #ff8a5c; the Sell button lifts 2px; active scales 0.97 (Buy now sinks 1px). Focus is a 2px ring offset 3px: text colour on the buy panel, #ff8a5c elsewhere in dark, 3px white on the Sell button.
- **Outlined secondary:** Save for later and the dialog's other actions are buttons with a 1px control border, no fill, 6px; hover turns the border vermilion; "saved" is vermilion text and border. Text-only secondaries (Cancel in the dialog, Sit this one out, Clear) are a label with a 1px control-border line under it that turns vermilion on hover.
- **Light theme:** the action is ink (#0f1720) with white text.

### Search
- **Hero field:** pale well (#f1f5f3 at 96%), 4px radius, 48px input, vermilion submit (4px) inside; the one action in the hero. Vermilion focus ring offset 3px.
- **Header search (from 1024px, other routes):** no box: a 1px control-border line under the field, a 2px vermilion underline on focus; hidden below 1024 where the page's own search is the one.
- **Search page bar:** a 4rem row between two control-border rules, 1.25rem text, no field box, the vermilion 4px submit at its end; focus draws the vermilion underline.
- **Filters:** a rail from 60rem, a bottom sheet (88svh, hairline top, 60% black backdrop, 260ms rise) below it. Each filter is a row between hairlines: muted label above, value below with no box; selects use vermilion chevrons; the focused row gets the vermilion underline; price pairs sit side by side on phones with one vertical hairline.
- **Active filters:** 44px outlined chips (1px control border, 4px) with a vermilion cross; a small outlined tag-button, noted below as tolerated, not as a pattern to extend.

### Dropdown
A ruled select: no box, a vermilion chevron, label above. The menu is a list between two control-border rules, rows 48px between hairlines, the chosen row bold with a vermilion tick, the keyboard-active row on a #1d2c29 wash with a vermilion inset outline; a floating menu from 60rem.

### Category strip
A ruled row: 1px hairline above and below, 1px dividers between items, 52px tall, 24px padding, scrolls sideways. Hover washes to Surface. The first item ("All categories") is weight 650 with a 2px vermilion underline.

### Ruled cells (showcase)
- **Cell:** page-colour ground, no border, no radius, padding 1.75rem to 2rem on the inside edge, 12px internal gap, hairlines from the grid gap.
- **Held-money cell:** the same cell with one 2px vermilion top rule; no tint fill.
- **Handover code:** six cells ruled by 1px hairlines (52px tall, Figtree 600 1.5rem tabular), outer hairline all round.
- **Lists inside cells:** bids, timeline and methods are ruled rows (hairline between rows; methods separated by vertical rules).

### Listing grid
Ruled grid, four across on tablet and up, two on phones; each cell is the photo (4:3.4, 4px radius, 1px hairline border, dimmed to brightness .82 on dark) over price (Figtree 600 1.25rem), a two-line title at weight 500 and muted details. Clock tag on ink with a vermilion dot (Error Pink ground in the last hour), "Featured" tag on Held Tint, both 2px radius.

### Steps
Plain Schibsted figures in vermilion (1.5rem) beside a heading and muted copy, ruled between steps (vertical rules on tablet and up). No tile behind the number.

### Listing page (buy column and seller row)
Wide screens: the photos and description scroll on the left; the right column (category, title, 2px vermilion top rule, price, Buy now with Save for later beside it (1.25fr / 1fr, stacked under 22rem), one muted line on when the seller is paid with a muted shield, then the seller row) stays in view until the page ends, and the footer keeps to its left (`html[data-rail]`, `--tb-rail-reserve`). A rail taller than the window scrolls inside itself. No order steps and no green on the buy panel: a visitor has not paid, so nothing is held. The seller is a ruled row between two hairlines, cells divided by vertical rules: a square 4px avatar (initials on Surface, even 7px gaps), the name beside a scalloped verified seal (Protect Green) over the join year, the rating star with Pro in an outlined gold badge, and a chat cell that washes to Surface and turns vermilion on hover; on the narrowest phones the rating takes a row of its own. The description and details sit under hairlines with Schibsted 1.5rem headings; details are a two-column grid with one vertical hairline and no rule under rows; body text is capped at 68ch. Notices are ruled lines, the risk warning a 2px pink top rule over a hairline. The gallery is one large photo (1px hairline, 4px, up to 38rem tall) with 72px thumbnails under it, the current one ringed in vermilion; physical items get a hover magnifier (240%, mouse only).

### Countdown cells
Time left is a row of ruled cells, number over unit: Figtree 600 1.25rem tabular over a 0.75rem muted unit, a 1px hairline between cells. In the last hour the digits turn Error Pink. Used in the bid bar and the room's header.

### Auction bid bar (listing page)
Auctions have no fixed column. A bar is fixed to the bottom of the screen (phones: above the 58px tab bar): a 2px vermilion top rule on the sheet colour, no shadow, laid out as a ruled grid of cells divided by hairlines: current price (Figtree 600, 1.5rem), time left (countdown cells), "See the bids" (a cell of its own: label, count in vermilion and an arrow, each between hairlines; open adds a vermilion line along its foot), a "Join the live room" cell for signed-in bidders, and the bid box (a ruled field with a vermilion Place bid block, square-cornered; a guest gets "Sign in to bid"). Between 48em and 75em with the room cell, the bid box takes a row of its own. The bar keeps its height: a bid's answer or a field error floats just above the bid box on a hairline-ruled strip. "See the bids" turns the bid-history list into a sheet over the page, directly above the bar (1px vermilion hairline on top, no shadow, 200ms rise); it is non-modal: focus goes to its close button, Escape closes it and focus returns to the button. The bar's real height is published as `--bar-h` for the sheet, the page's bottom room and scroll padding. Gutters follow the shell's own. On phones the bar collapses to a small square tab at the right edge, above the tab bar: a chevron and the price, a 2px vermilion top rule and a 1px hairline on its left, no rounded outline; pressing it opens the full-width bar (two columns of cells with hairlines between, the bid box on its own row), and a chevron closes it.

### Auction room
`/listings/:id/room`, signed-in users only (the seller watches read-only; a fixed-price listing has none). A header row (64px photo at 4px, a pink "Live" mark with a pulsing dot (five pulses, none under reduced motion), title, then time left and number of bidders as countdown cells divided by a hairline, flush with the column's right edge), then a stage on open ground between two hairlines: bidders as seats in an arc, one per alias, the leader's seat filled vermilion with ink text, the viewer's own ringed 3px in the text colour, the current price at the centre under the arc (Figtree 600). Under it, controls topped by a 2px vermilion rule: three quick-bid buttons as one ruled row of three cells (52px, control-border rules between and above and below; they only fill the bid field and open the same confirmation dialog), the bid field (a ruled underline) with a square vermilion Place bid block, and two cells divided by one rule, "Sit this one out" (turns off this page's announcements only; when on it shows vermilion text over a 2px foot line) and "Back to the listing". A standing line ("you lead" between green rules, outbid between pink rules) sits above. Beside it a "Live bids" ledger under a 2px hairline: rows between hairlines with a circular seat chip, who and when, and the amount (Figtree 600, 1.125rem); the newest row has a 3px vermilion bar on its left edge and a vermilion amount, and a row that arrives flashes once (not with reduced motion). The arc is decoration (aria-hidden); the list, the price and the controls carry the meaning.

### Checkout and order money panel
Checkout: the item and the delivery choices on the left as rows between hairlines (the chosen row has a vermilion bar on its left edge); on the right a summary column under a 2px vermilion rule: the label, the total once in Figtree 600, one line on how the money moves, the three steps as balls on a line with none marked (nothing is paid or held yet), the vermilion Continue button and the reserve note. The order page opens with the same panel: label, total, one sentence on where the money is, the day it left TrustBazaar when it has, and the steps with the REAL state (done and current in Protect Green, the rest empty rings; a cancelled order has none). Panels below it are ruled sections, not filled boxes; fields are a line under them; the Bought and Sold tabs are text with a vermilion underline on the current one.

### Glass window (home hero only)
A 4px frosted panel (`rgb(10 17 16 / .6)`, blur 20px, white 20% border) with a photograph over price, buy button, live clock and the three payment steps; a small dark "Payment held" card (`rgb(10 17 16 / .9)`, 4px) sits over its lower-left corner with a green tick.

### Timeline
A 16px circle per step: outline for pending, text-colour fill for done, Protect Green fill with a soft ring for the current step; rows ruled by hairlines.

### Navigation
- **Header:** sticky, hairline under, logotype at left. Signed in, the links are a ruled grid of icon cells (`navGrid`): 52 by 48px cells with 22px icons, a hairline before and between cells, Surface wash on hover, a 2px vermilion inset focus ring, the unread count a small vermilion badge on the cell's corner; names stay as screen-reader text and tooltips. The home header adds Sign in and the Sell button and has no search (the hero's search is the one action); other routes show the ruled search from 1024px. On phones the bell and account are 48px ruled cells with a hairline on the left, and the header stays on one line down to 320px.
- **Promise bar:** under the header, transparent, one line with a hairline below, 0.875rem; below 25rem a short sentence replaces the long one.
- **Footer:** transparent ground with a top hairline; three ruled columns (brand, Explore, Help) with 44px link targets that draw a vermilion underline on hover; under them a ruled language row: the label at the left, the language switch at the right as plain text with a 1px control-border line under it that turns vermilion on hover (the user app's language switch lives here, not in the header). On a listing the footer keeps to the left of the rail.
- **Phone tab bar:** fixed bottom, a 1px control-border line on top, equal 58px cells divided by hairlines, 22px icons over a 0.75rem label that never wraps; the current tab has a 2px vermilion line on the bar's top edge; Sell is the one vermilion tab, an outlined 22px square (4px) rather than a filled pill.

### Confirm dialog
A modal `dialog` on the sheet colour, width min(28rem, viewport minus 2rem), padding 1.5rem, no outline and no radius: a 2px vermilion rule on top and a 1px control-border line at its foot, over a 60% black backdrop. The heading is Schibsted 600, 1.5rem; paragraphs wrap with no lone last word. The actions sit under a hairline: the confirm is a 48px vermilion button (6px), Cancel is text with a line under it that turns vermilion on hover.

### Logotype
Outlined SVG in `public/brand/`: "Trust" in vermilion with a capital T, "bazaar" in ink (light) or white (reversed on dark), a coin in each "a"; the Bangla version carries the coin as its full stop. Never set in a live font.

## Do's and Don'ts

### Do:
- **Do** separate sections, rows and cells with 1px hairlines (#2a3b36) and gap-1px grids over the line colour; give only buttons and images a box, at 4px (6px for the larger buttons).
- **Do** reserve vermilion (#ff6b35) for actions, live signals, step figures, focus underlines and the single 2px rule atop an action panel, with #0a1018 text on it.
- **Do** use Protect Green only for held or verified states, and Pro Gold only for Pro and the rating star.
- **Do** set headings in Schibsted Grotesk 600 and every number in Figtree with tabular numerals.
- **Do** draw a text field as a line with a vermilion underline on focus.
- **Do** keep tap targets at 44px minimum and design for 320px, phones under 768, tablets 768 to 1023, laptops 1024 and up.
- **Do** keep a still fallback for any animation and honour `prefers-reduced-motion`; give every inset-shadow mark a real border in forced-colours mode.
- **Do** keep Bangla on Hind Siliguri with the TB Figures digits first in the stack, at line height 1.7.

### Don't:
- **Don't** fill a card, outline a box or round a panel anywhere in the user app; use a rule. Buttons and images are the only boxes.
- **Don't** use the WebGL ground, backdrop blur or the glass sheen outside the home hero.
- **Don't** put white text on vermilion or use vermilion as a large background fill.
- **Don't** put the step numbers in a tile or circle, or turn the language switch, header links or tabs into pills or filled tiles.
- **Don't** use Protect Green or Error Pink as decoration, or show green on a buy panel before money is held.
- **Don't** add a shadow to a bar, sheet, dialog or cell; shadows belong to the hero and the two floating overlays.
- **Don't** set a number in Schibsted Grotesk.
- **Don't** convey state by colour alone; the timeline pairs fill with text weight and the clock pairs colour with its label.
