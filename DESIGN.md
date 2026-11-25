---
name: TrustBazaar
description: Night-market dark marketplace for Bangladesh where the page shows the held-money mechanism live; one vermilion action colour on ink-navy panels.
colors:
  night-ground: "#080d14"
  panel: "#0f1824"
  panel-raised: "#131f2e"
  hairline: "#213145"
  control-border: "#62768d"
  text: "#f2f5f9"
  text-muted: "#9fb0c3"
  hero-lede: "#b6c1cf"
  vermilion: "#ff6b35"
  vermilion-hover: "#ff8a5c"
  vermilion-text: "#ff7a45"
  peach-text: "#ffb08a"
  held-brown: "#2a1b14"
  held-brown-line: "#5a3320"
  protect-green: "#5dd39e"
  protect-green-ground: "#10281e"
  error-pink: "#ff6f8e"
  error-ground: "#2b1219"
  on-vermilion: "#0a1018"
  hero-start: "#0a1018"
  hero-mid: "#15263b"
  hero-end: "#3a1d12"
  paper: "#ffffff"
  ink: "#0f1720"
typography:
  display:
    fontFamily: "Gabarito Variable, TB Figures, Hind Siliguri, system-ui, sans-serif"
    fontSize: "clamp(2.5rem, 5.6vw, 4rem)"
    fontWeight: 500
    lineHeight: 1.06
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Gabarito Variable, TB Figures, Hind Siliguri, system-ui, sans-serif"
    fontSize: "clamp(1.75rem, 3.6vw, 2.5rem)"
    fontWeight: 500
    lineHeight: 1.1
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Gabarito Variable, TB Figures, Hind Siliguri, system-ui, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  price:
    fontFamily: "Gabarito Variable, TB Figures, Hind Siliguri, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "-0.02em"
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
  panel: "24px"
  card: "16px"
  control: "10px"
  inset: "8px"
  tag: "6px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  section: "64px"
  max-width: "82rem"
components:
  button-primary:
    backgroundColor: "{colors.vermilion}"
    textColor: "{colors.on-vermilion}"
    rounded: "{rounded.control}"
    height: "48px"
    padding: "0 24px"
  button-primary-hover:
    backgroundColor: "{colors.vermilion-hover}"
  search-hero:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "6px 6px 6px 16px"
  category-chip:
    backgroundColor: "{colors.panel-raised}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    height: "44px"
    padding: "0 16px"
  category-chip-all:
    backgroundColor: "{colors.held-brown}"
    textColor: "{colors.peach-text}"
  panel:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    rounded: "{rounded.panel}"
    padding: "40px"
  card:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    rounded: "{rounded.card}"
    padding: "24px"
  card-held:
    backgroundColor: "{colors.held-brown}"
    textColor: "{colors.text}"
    rounded: "{rounded.card}"
    padding: "24px"
  step-number:
    backgroundColor: "{colors.held-brown}"
    textColor: "{colors.peach-text}"
    rounded: "{rounded.control}"
    size: "40px"
  digit-cell:
    backgroundColor: "{colors.panel-raised}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    height: "48px"
---

# Design System: TrustBazaar

## Overview

**Creative North Star: "The Night Market"**

TrustBazaar is a marketplace for buyers in Bangladesh, in English and Bangla at equal weight. The shipped home page sets it as a night market: a near-black navy ground, panels one step lighter, and a single vermilion that does all the calling. The page proves safety by showing the mechanism (a real listing, a live clock, a "Payment held" card) rather than asserting it with a badge.

The system is flat. Every surface is a panel colour with a 1px hairline; depth comes from tone and the hairline, not from shadow. The one exception is the hero, which carries a moving WebGL gradient ground and a frosted-glass product window with a passing sheen. These two effects exist only on the home hero and are not part of the shared system.

Colour has jobs. Vermilion is for actions and the live signal. Protect-green marks money that is held and sellers that are verified. A brown tint marks the held-money card. Crimson-pink is only for errors and the last-hour auction clock.

**Key Characteristics:**
- Dark theme on the user app (`data-theme="dark"`); the console, ID check and credentials pages stay on the light tokens.
- One surface system: panel colour plus a 1px inset hairline, three radii (24, 16, 10).
- Gabarito for headlines at weight 500, Figtree for text and every ticking figure.
- Hero fills the first screen alone; its moving ground falls back to a still CSS gradient.
- 44px minimum tap targets; reduced motion switches every animation off.

## Colors

A deep ink-navy ground with one vermilion voice and a green that only ever means "protected".

### Primary
- **Vermilion** (`--tb-hot`, `--tb-action` in dark): the primary button ground, the search submit, the Sell call, the live-clock dot and the header logotype's "Trust". Text on it is Night Ink (#0a1018), never white.
- **Vermilion Hover** (#ff8a5c): hover on vermilion buttons; also the dark-theme focus ring and the "bazaar" tint on dark inks.
- **Vermilion Text** (#ff7a45, `--tb-accent`): links and accent text on the dark ground.
- **Peach Text** (#ffb08a): text on the brown held tint (the "All categories" chip, step numbers).

### Secondary
- **Protect Green** (#5dd39e, `--tb-protect`, `--tb-success`): held and verified states only: the current timeline step, tick marks, the best bid, the "Payment held" tick. On Protect Green Ground (#10281e).

### Tertiary
- **Held Brown** (#2a1b14, `--tb-accent-soft`) with its line (#5a3320): the held-money card, step-number tiles, the "All categories" chip. A brown tint, not an orange fill.
- **Error Pink** (#ff6f8e, `--tb-error`) on Error Ground (#2b1219), text #ffb3c0: errors and the live auction dot.

### Neutral
- **Night Ground** (#080d14, `--tb-bg`): the page.
- **Panel** (#0f1824, `--tb-sheet`): cards, panels, the footer's ink.
- **Panel Raised** (#131f2e, `--tb-surface`): chips, digit cells, photo wells, tags.
- **Hairline** (#213145, `--tb-line`): the 1px outline of every panel and card.
- **Control Border** (#62768d, `--tb-border`): form control borders, 3:1 or better.
- **Text** (#f2f5f9) and **Text Muted** (#9fb0c3): body and secondary copy.
- **Hero Gradient** (#0a1018 to #15263b to #3a1d12, 135deg): the hero's still ground, under the WebGL canvas.
- **Paper** (#ffffff) and **Ink** (#0f1720): the light theme's ground and action, and the hero search field's white well.

### Named Rules
**The One Hot Colour Rule.** Vermilion is the only hot colour. It marks an action or a live signal; it is never decoration, never a large fill, and never carries white text.

**The Protect Green Rule.** Green means held or verified money and nothing else. Do not use it for "success" decoration or for brand accent.

**The Held Brown Rule.** The brown tint belongs to the held-money card and its step markers. It is how the escrow idea stays visually distinct from ordinary panels.

## Typography

**Display Font:** Gabarito Variable (with TB Figures, Hind Siliguri, system-ui)
**Body Font:** Figtree Variable (with TB Figures, Hind Siliguri, system-ui, Segoe UI, Roboto)
**Bangla:** Hind Siliguri (Bengali block, 400 to 700), loaded only when the language is Bangla, with the TB Figures face first in the Bangla stack.

**Character:** A rounded geometric display over a friendly humanist text face. Headlines stay at weight 500 and tighten with negative tracking; the figures that tick (clocks, prices, bids, codes) use tabular numerals.

### Hierarchy
- **Display** (500, clamp 2.5rem to 4rem, 1.06): the home hero headline only, three lines, balanced wrap.
- **Headline** (500, clamp 1.75rem to 2.5rem, 1.1): section headings; one line on wide screens, shrinking and wrapping on small ones.
- **Title** (500, 1.375rem, 1.2): bento card headings. Step headings in the journey use 1.25rem.
- **Price** (Gabarito 500, 1.25rem listing card, 1.75rem hero window, tabular): money on listings.
- **Lede** (400, 1.25rem, 1.5, max 34rem): the single line under the hero headline, in #b6c1cf.
- **Body** (400, 1rem, 1.5; card copy capped at 36ch): running text, in Text Muted on cards.
- **Figure** (Figtree 600, 1.5rem, tabular): live clock, bid amounts and the handover-code digits; Figtree rather than Gabarito so digits do not shift as they tick.
- **Label** (600, 0.875rem): captions, tags (0.75rem), chips.

### Named Rules
**The Ticking Figures Rule.** Anything that updates in place (countdowns, bids, codes) is Figtree with `tabular-nums`. Gabarito is for static display and prices.

**The Bangla Face Rule.** In Bangla the stack becomes `TB Figures, Hind Siliguri, Figtree`, line height 1.7 for body and 1.3 to 1.4 for headings, letter-spacing 0 on headings and prices. Digits, the taka sign and the separators between them always come from TB Figures so numbers read in one face.

## Layout

One centred column, `max-width: 82rem`, with a fluid gutter of `clamp(1rem, 4vw, 3.5rem)` shared by header, main and footer. Home sections stack with a 4rem gap. The hero panel pads 20px on phones, 40px on tablets and 56px on laptops.

Breakpoints are fixed at three bands:
- **Phones, under 768px (48em):** one column; listing grid two across; the "Safe" bento one column; the category strip and the new-listings rail scroll sideways with snap.
- **Tablets, 768 to 1023px:** hero still one column so the window has room for its payment steps; listing grid four across; bento two columns with the payment card spanning both; journey in a 2 by 2; selling box puts the heading and button on one row over three step columns.
- **Laptop, 1024px and up (64em):** hero in two columns (5fr / 6fr, min height `min(40rem, 100svh - 7rem)`); bento in twelve columns (5/7, then three spans of 4); journey in four steps on a line; rail becomes a four-column grid.

Narrow-phone adjustments at 30rem and 26rem (smaller tags, search icon hidden, logotype 30px). Every button and stand-alone link is at least 44px tall. Rows in a bento are equal height, with the live UI pinned to the bottom of each card so copy aligns.

## Elevation & Depth

Tonal layering with hairlines. Panels and cards are the panel colour with `box-shadow: inset 0 0 0 1px var(--tb-line)`; nothing lifts at rest. Listing cards lift 2px on hover and the photo zooms 1.03 inside its frame. Soft ambient shadows exist for floating pieces only.

### Shadow Vocabulary
- **Hairline** (`inset 0 0 0 1px var(--tb-line)`): every panel and card outline.
- **Card** (`0 1px 2px rgba(0,0,0,.4), 0 8px 24px -10px rgba(0,0,0,.6)`, `--tb-shadow-card`): dark-theme token for raised pieces.
- **Lift** (`0 2px 4px rgba(0,0,0,.4), 0 18px 40px -14px rgba(0,0,0,.7)`, `--tb-shadow-lift`).
- **Hero window** (`inset 0 1px 0 rgb(255 255 255 / .3), 0 40px 80px -30px rgb(0 0 0 / .7)`): the glass window only.

### Named Rules
**The One Surface Rule.** Panel colour plus a 1px hairline is the only surface. No second card style, no coloured borders except the held-money card's vermilion-tinted hairline.

**The Home-Only Glass Rule.** The WebGL gradient ground (four-colour mesh with grain, pointer-following light, still fallback) and the frosted-glass window with its 7-second sheen exist only on the home hero. New screens do not use backdrop blur, sheen or a moving ground.

## Shapes

Three radii, no others for containers: **24px** for panels (hero, selling box, journey), **16px** for cards (bento cards, listing photos, the glass window), **10px** for controls (buttons, search fields, chips, digit cells, step numbers). Inner insets use 8px (button inside the hero search) and 6px (tags and clock boxes). Pills (999px) appear only for the language switch in the shared shell. Dots are circles. Stated honestly: the `--tb-radius-panel` token is 16px (the card radius); the 24px panel radius is written directly in the home stylesheets.

## Components

### Buttons
- **Shape:** 10px radius, 48px tall, 24px horizontal padding.
- **Primary:** Vermilion ground (#ff6b35) with Night Ink text (#0a1018), weight 700.
- **Hover / Focus:** ground to #ff8a5c; the Sell button lifts 2px; active scales 0.97. Focus is a 2px ring in the focus colour (#ff8a5c in dark, 3px white on the Sell button).
- **Light theme:** the action is ink (#0f1720) with white text.

### Search
- **Hero field:** white well (96% opacity), 10px radius, 48px input, vermilion submit inside; it is the one action in the hero. Vermilion focus ring offset 3px.
- **Header field:** raised-panel ground, 46px, 1.5px border that turns to text colour on focus.

### Category chips
- **Style:** 44px tall, 10px radius, Panel Raised ground, weight 500. Hover tints to Held Brown and lifts 2px. "All categories" is Held Brown with Peach Text and a #5a3320 hairline.

### Cards / Containers
- **Bento card:** 16px, Panel ground, hairline, 24px padding, 12px internal gap.
- **Held-money card:** Held Brown ground with a vermilion-tinted hairline (`rgb(255 107 53 / .28)`); its muted text is #d6c3b8.
- **Listing card:** photo at 4:3.4 in a 16px frame with no border, price in Gabarito 1.25rem, title in two lines at weight 500. Clock tag on ink with a vermilion dot (error ground when the auction is in its last hour); "Featured" tag on peach tint. Photos are dimmed (brightness .78) on the dark page.

### Glass window (home hero only)
A 16px frosted panel (`rgb(10 16 24 / .72)`, blur 20px, white 20% border) with a photograph over price, buy button, live clock and the three payment steps; a small dark "Payment held" card sits over its lower-left corner with a green tick.

### Timeline and step markers
A 16px circle per step: outline for pending, white fill for done, Protect Green fill with a soft ring for the current step. Number tiles (40px, 10px radius, Held Brown, Peach Text) mark selling and journey steps.

### Navigation
Sticky header on the page ground with a hairline underline: the logotype, a centred search field, language switch (pill on raised panel), account link with an animated underline, and Sell. The footer is the ink panel (#0f1824 in dark) with 44px link targets. On phones a bottom tab bar replaces header actions; its Sell tab uses the action colour.

### Logotype
Outlined SVG in `public/brand/`: "Trust" in vermilion with a capital T, "bazaar" in ink (light) or white (reversed on dark), a coin in each "a"; the Bangla version carries the coin as its full stop. Never set in a live font.

## Do's and Don'ts

### Do:
- **Do** keep every surface to panel colour plus a 1px hairline, with radii of 24 (panels), 16 (cards) and 10 (controls).
- **Do** reserve vermilion (#ff6b35) for actions and live signals, with #0a1018 text on it.
- **Do** use Protect Green only for held or verified states, and Held Brown for the held-money card.
- **Do** set headings in Gabarito 500 and all ticking figures in Figtree with tabular numerals.
- **Do** keep tap targets at 44px minimum and design for 320px, phones under 768, tablets 768 to 1023, laptops 1024 and up.
- **Do** keep a still fallback for any animation and honour `prefers-reduced-motion`.
- **Do** keep Bangla on Hind Siliguri with the TB Figures digits first in the stack, at line height 1.7.

### Don't:
- **Don't** use the WebGL ground, backdrop blur or the glass sheen outside the home hero.
- **Don't** put white text on vermilion or use vermilion as a large background fill.
- **Don't** add a fourth radius or a second card style.
- **Don't** use Protect Green or Error Pink as decoration.
- **Don't** set a changing number in Gabarito.
- **Don't** let the held-money brown tint spread to ordinary cards.
- **Don't** convey state by colour alone; the timeline pairs fill with text weight and the clock pairs colour with its label.
