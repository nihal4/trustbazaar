---
name: TrustBazaar
description: Bottle-green-black marketplace for Bangladesh where the page shows the held-money mechanism live; one vermilion action colour, sections ruled by hairlines instead of boxes.
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
  error-pink: "#ff6f8e"
  error-ground: "#2b1219"
  on-vermilion: "#0a1018"
  hero-start: "#0a1110"
  hero-mid: "#10231f"
  hero-end: "#3a1d12"
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
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "6px 6px 6px 16px"
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

The system is ruled, not boxed. Below the hero there are no filled cards: sections are separated by 1px hairlines, and grids are cells in the page colour over a 1px gap that shows the hairline colour. Depth comes from lines and tone, not shadow. The one exception is the hero, which carries a moving WebGL gradient ground and a frosted-glass product window with a passing sheen; these exist only on the home hero and are not part of the shared system.

Colour has jobs. Vermilion is for actions, the live signal, step figures and the single rule on the held-money cell. Protect Green marks money that is held and sellers that are verified. Error Pink is only for errors and the last-hour auction clock.

**Key Characteristics:**
- Dark theme on the user app (`data-theme="dark"`); the console, ID check and credentials pages stay on the light tokens.
- Ruled Grid: hairlines and cells, no filled cards; radii nearly square (4px boxes, 6px controls).
- Schibsted Grotesk 600 for headlines, Figtree for text and every figure.
- Hero fills the first screen alone; its moving ground falls back to a still CSS gradient.
- 44px minimum tap targets; reduced motion switches every animation off.

## Colors

A bottle-green black ground with one vermilion voice and a green that only ever means "protected".

### Primary
- **Vermilion** (`--tb-hot`, `--tb-action` in dark): the primary button ground, the search submit, the Sell call, the live-clock dot, the step figures, the held-money cell's top rule and the category strip's first-item underline. Text on it is Night Ink (#0a1018), never white.
- **Vermilion Hover** (#ff8a5c): hover on vermilion buttons; also the dark-theme focus ring.
- **Vermilion Text** (#ff7a45, `--tb-accent`): links and accent text on the dark ground.
- **Peach Text** (#ffb08a, `--tb-accent-strong`): strong accent text; also the pale stop of the shader.

### Secondary
- **Protect Green** (#5dd39e, `--tb-protect`, `--tb-success`): held and verified states only: the current timeline step, tick marks, the best bid, the "Payment held" tick. On Protect Green Ground (#10281e).

### Tertiary
- **Pro Gold** (#e8b84a, `--tb-gold`, defined in `features/listings/listings.module.css`): the Pro Seller badge and the seller's rating star, nothing else. Never an action colour.
- **Held Tint** (#2b1a12, `--tb-accent-soft`): the "Featured" tag on listings. A brown tint, not an orange fill.
- **Error Pink** (#ff6f8e, `--tb-error`) on Error Ground (#2b1219), text #ffb3c0: errors and the live auction dot.

### Neutral
- **Ground** (#0a1110, `--tb-bg`): the page and every ruled cell.
- **Panel** (#101a19, `--tb-sheet`, `--tb-ink`): the footer and the always-dark ink.
- **Surface** (#16221f, `--tb-surface`): hover wash on category items, photo wells.
- **Hairline** (#2a3b36, `--tb-line`): every rule, cell gap and strip edge.
- **Control Border** (#66807a, `--tb-border`): form control borders, 3:1 or better.
- **Text** (#f1f5f3) and **Text Muted** (#a2b5b0): body and secondary copy. Hero lede and proof line use #b8c7c2.
- **Hero Gradient** (#0a1110 to #10231f at 60% to #3a1d12, 135deg; `--tb-hero-from`, `--tb-hero-mid`, `--tb-hero-to`): the hero's still ground, under the WebGL canvas. The shader reads `--tb-glow-0` to `--tb-glow-3` (#0a1110, #10231f, #ff6b35, #ffb08a).
- **Paper** (#ffffff) and **Ink** (#0f1720): the light theme's ground and action, and the hero search field's white well.

### Named Rules
**The One Hot Colour Rule.** Vermilion is the only hot colour. It marks an action, a live signal or a single rule or figure; it is never a large fill and never carries white text.

**The Protect Green Rule.** Green means held or verified money and nothing else. Do not use it for "success" decoration or for brand accent.

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
- **Price** (Figtree 600, 1.25rem listing, 1.75rem hero window, tabular, -0.01em to -0.02em).
- **Figure** (Figtree 600, 1.5rem, tabular): live clock, bid amounts and the handover-code digits.
- **Label** (600, 0.875rem): captions, tags (0.75rem to 0.8125rem).

### Named Rules
**The Ticking Figures Rule.** Every number, static or ticking (clocks, prices, bids, codes), is Figtree with `tabular-nums`. Schibsted Grotesk sets words, and the step numerals only.

**The Bangla Face Rule.** In Bangla the stack becomes `TB Figures, Hind Siliguri, Figtree`, line height 1.7 for body and 1.3 to 1.4 for headings, headings drop to weight 500 with letter-spacing 0. Digits, the taka sign and the separators between them always come from TB Figures so numbers read in one face.

## Layout

One centred column, `max-width: 82rem`, with a fluid gutter of `clamp(1rem, 4vw, 3.5rem)` shared by header, main and footer. Home sections stack with a 4.5rem gap. The hero pads 20px on phones, 40px on tablets and 56px on laptops. Sections open with a 1px hairline and 1.5rem of padding before the heading.

Layout is a ruled grid: a `display: grid` with `gap: 1px` over a `--tb-line` background, cells in the page colour, edges closed by block borders. Cells carry padding on the inside edge only, so outer cells align to the column.

Breakpoints are fixed at three bands:
- **Phones, under 768px (48em):** one column; listing grid two across; the showcase one column; the category strip scrolls sideways; steps stacked with rules between.
- **Tablets, 768 to 1023px:** hero still one column; listing grid four across; showcase two columns with the payment cell spanning both; journey in a 2 by 2; selling heading and button on one row over the steps.
- **Laptop, 1024px and up (64em):** hero in two columns (5fr / 6fr, min height `min(40rem, 100svh - 7rem)`); showcase in twelve columns (5/7, then three spans of 4); journey in four ruled steps; selling steps in three ruled columns.

Narrow-phone adjustments at 30rem and 26rem (smaller tags, search icon hidden). Every button and stand-alone link is at least 44px tall. The live UI sits at the bottom of each cell so copy above aligns.

## Elevation & Depth

Flat, ruled. Surfaces carry no shadow and no fill: separation is a 1px hairline or a gap-1px cell grid. Listing cards lift 2px on hover and the photo zooms 1.03 inside its frame. Shadows exist only for the hero's floating pieces and the search field.

### Shadow Vocabulary
- **Hero window** (`inset 0 1px 0 rgb(255 255 255 / .3), 0 40px 80px -30px rgb(0 0 0 / .7)`): the glass window only.
- **Hero search** (`0 18px 40px -18px rgb(0 0 0 / .55)`): the white search well.
- **Held rule** (`inset 0 2px 0 var(--tb-hot)`): the one 2px vermilion top rule, on the held-money cell. Category first item uses the same device as an underline (`inset 0 -2px 0`).
- **Card / Lift** (`--tb-shadow-card`, `--tb-shadow-lift`): defined in the dark tokens, not used by the home.

### Named Rules
**The Ruled Grid Rule.** Lines, not boxes. Separate content with 1px hairlines (`--tb-line`) and ruled cells; do not fill a card, do not outline one with a box. A section, strip, list or code is a rule above it, rules between its cells, and nothing else.

**The Home-Only Glass Rule.** The WebGL gradient ground (four-colour mesh with grain, pointer-following light, still fallback) and the frosted-glass window with its 7-second sheen exist only on the home hero. New screens do not use backdrop blur, sheen or a moving ground.

## Shapes

Nearly square. **4px** for the few boxes left (hero, glass window, listing photos, floating payment card, hero submit button, Sell button), **6px** for controls (buttons in the shared theme, inputs, the hero search well), **2px** for small tags and example labels. Pills (999px) appear only for the language switch in the shared shell. Dots are circles. Tokens: `--tb-radius-panel` 4px, `--tb-radius-control` 6px.

## Components

### Buttons
- **Shape:** 4px radius on the home (6px in the shared theme), 48px tall, 24px horizontal padding.
- **Primary:** Vermilion ground (#ff6b35) with Night Ink text (#0a1018), weight 700.
- **Hover / Focus:** ground to #ff8a5c; the Sell button lifts 2px; active scales 0.97. Focus is a 2px ring in the focus colour (#ff8a5c in dark, 3px white on the Sell button).
- **Light theme:** the action is ink (#0f1720) with white text.

### Search
- **Hero field:** white well (96% opacity), 6px radius, 48px input, vermilion submit (4px) inside; the one action in the hero. Vermilion focus ring offset 3px.

### Category strip
A ruled row: 1px hairline above and below, 1px dividers between items, 52px tall, 24px padding, scrolls sideways. Hover washes to Surface. The first item ("All categories") is weight 650 with a 2px vermilion underline.

### Ruled cells (showcase)
- **Cell:** page-colour ground, no border, no radius, padding 1.75rem to 2rem on the inside edge, 12px internal gap, hairlines from the grid gap.
- **Held-money cell:** the same cell with one 2px vermilion top rule; no tint fill.
- **Handover code:** six cells ruled by 1px hairlines (52px tall, Figtree 600 1.5rem tabular), outer hairline all round.
- **Lists inside cells:** bids, timeline and methods are ruled rows (hairline between rows; methods separated by vertical rules).

### Listing grid
Ruled grid, four across on tablet and up, two on phones; each cell is the photo (4:3.4, 4px radius, 1px hairline border, slightly dimmed to brightness .92 on dark) over price (Figtree 600 1.25rem), a two-line title at weight 500 and muted details. Clock tag on ink with a vermilion dot (Error Pink ground in the last hour), "Featured" tag on Held Tint, both 2px radius.

### Steps
Plain Schibsted figures in vermilion (1.5rem) beside a heading and muted copy, ruled between steps (vertical rules on tablet and up). No tile behind the number.

### Listing page (buy column and seller row)
Wide screens: the photos and description scroll on the left; the right column (category, title, vermilion top rule, price, Buy now with Save for later beside it, one muted line on when the seller is paid, then the seller row) stays in view until the page ends, and the footer keeps to its left (`html[data-rail]`, `--tb-rail-reserve`). A rail taller than the window scrolls inside itself. No order steps and no green on the buy panel: a visitor has not paid, so nothing is held (the steps appear at checkout and on the order). The seller is a ruled row of cells: a square photo with even 7px gaps, the name beside a scalloped verified seal (Protect Green) over the join year, the rating star with Pro in gold, and a chat cell. The gallery is one large photo with 72px thumbnails under it; physical items get a hover magnifier (240%, mouse only).

### Auction bid bar (listing page)
Auctions have no fixed column. A bar is fixed to the bottom of the screen (phones: above the tab bar): a 2px vermilion top rule on the sheet colour, cells for the current price (Figtree 600, 1.5rem), the clock, "See the bids" with a count chip, and the bid box (a guest gets "Sign in to bid"). The bar keeps its height: a bid's answer or a field error floats just above the bid box. "See the bids" turns the bid-history list into a sheet over the page, directly above the bar (vermilion hairline on top, no shadow); it is non-modal: focus goes to its close button, Escape closes it and focus returns to the button. The bar's real height is published as `--bar-h` for the sheet, the page's bottom room and scroll padding. Gutters follow the shell's own (4vw up to 3.5rem, centred past the maximum width).

### Auction room
`/listings/:id/room`, signed-in users only (the seller watches read-only; a fixed-price listing has none). A header row (small photo, "Live" mark with a pulsing dot, title, time left, number of bidders), then a stage: bidders as seats in an arc, one per alias, the leader's seat in vermilion, the viewer's own ringed in the text colour, the current price at the centre under the arc (Figtree 600). Under it a vermilion top rule, three quick-bid buttons (they only fill the bid field and open the same confirmation dialog), the bid field with Place bid, and "Sit this one out" (turns off this page's announcements only). Beside it a ruled "Live bids" list; a row that arrives flashes once (not with reduced motion). The arc is decoration (aria-hidden); the list, the price and the controls carry the meaning. The bid bar of the listing has a "Join the live room" cell for signed-in bidders.

### Glass window (home hero only)
A 4px frosted panel (`rgb(10 17 16 / .72)`, blur 20px, white 20% border) with a photograph over price, buy button, live clock and the three payment steps; a small dark "Payment held" card (`rgb(10 17 16 / .9)`, 4px) sits over its lower-left corner with a green tick.

### Timeline
A 16px circle per step: outline for pending, text-colour fill for done, Protect Green fill with a soft ring for the current step; rows ruled by hairlines.

### Navigation
The home header carries the logotype, the language switch, Sign in and the Sell button; there is no header search on the home page, where the hero's search is the one action (other routes show a search field in the header). The footer is a transparent ground with a top hairline and three ruled columns with 44px link targets. On phones a bottom tab bar replaces header actions; its Sell tab uses the action colour.

### Logotype
Outlined SVG in `public/brand/`: "Trust" in vermilion with a capital T, "bazaar" in ink (light) or white (reversed on dark), a coin in each "a"; the Bangla version carries the coin as its full stop. Never set in a live font.

## Do's and Don'ts

### Do:
- **Do** separate sections and cells with 1px hairlines (#2a3b36) and gap-1px grids over the line colour; radii of 4 (boxes), 6 (controls).
- **Do** reserve vermilion (#ff6b35) for actions, live signals, step figures and the single held-money top rule, with #0a1018 text on it.
- **Do** use Protect Green only for held or verified states.
- **Do** set headings in Schibsted Grotesk 600 and every number in Figtree with tabular numerals.
- **Do** keep tap targets at 44px minimum and design for 320px, phones under 768, tablets 768 to 1023, laptops 1024 and up.
- **Do** keep a still fallback for any animation and honour `prefers-reduced-motion`.
- **Do** keep Bangla on Hind Siliguri with the TB Figures digits first in the stack, at line height 1.7.

### Don't:
- **Don't** fill a card or box a section on the home; use a rule.
- **Don't** use the WebGL ground, backdrop blur or the glass sheen outside the home hero.
- **Don't** put white text on vermilion or use vermilion as a large background fill.
- **Don't** put the step numbers in a tile or circle.
- **Don't** use Protect Green or Error Pink as decoration.
- **Don't** set a number in Schibsted Grotesk.
- **Don't** convey state by colour alone; the timeline pairs fill with text weight and the clock pairs colour with its label.
