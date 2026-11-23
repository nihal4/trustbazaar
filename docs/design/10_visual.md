# Visual design: Daylight (U10)

Status: built (U10-01 to U10-10, 2026-11-24); section 8 is checked by the sweep and `src/shared/visual.test.ts`. The images in `10_visual/` are previews of the mockups, rendered in the browser of the build container, which falls back to system fonts. The real pages use the fonts named here. The originals are on the "TrustBazaar design: Daylight" canvas (ask Sabikun Nahar Sinthia for access).

This document changes how the site **looks**. It does not change what any screen does, which APIs it calls or which requirements it meets. Where a screen's behaviour is described below, it is the behaviour Unit 8 already built, restated so the acceptance criteria can be checked against it.

## 1. Principles

1. **The item first.** Photos are large, on a quiet background. Page chrome stays out of the way.
2. **One strong colour.** Plum marks actions and the payment promise. Everything else is ink, white and a soft lilac grey, so a button is never hard to find (contrast matters more than hue).
3. **The price tag is the recurring shape.** It appears in the logo, on the price of every photo, and as the "Your money waits with us" promise.
4. **Say the promise once, where it matters.** It goes on the home page, the listing, checkout and the order, not on every card. Every seller has passed the ID check, so cards do not repeat "verified".
5. **Bangla is not a translation afterthought.** Every screen is designed and checked in Bangla too, with Bangla line heights and Bangla digits where the catalogue uses them.
6. **No borrowed brands.** No bKash, Nagad or Daraz logos, colours or page designs. Payment methods are named in text.

## 2. Colour

| Token | Hex | Role | Contrast |
|---|---|---|---|
| `plum` | `#4B2378` | Primary buttons, the promise tag, checks, selected controls, focus ring colour | White on plum 11.6:1 |
| `plum-dark` | `#3A1A5E` | Text on lilac, pressed state | 10.8:1 on lilac |
| `lilac` | `#E9DDF6` | Soft highlight: "You are the highest bidder", focus halo, status badges | |
| `peach` | `#FFC9B0` | Featured price tag only, with plum text | Plum on peach 7.9:1 |
| `peach-cream` | `#FFF1EA` | Promise panels, the home hero, the sign-in side | Ink on it 15.5:1 |
| `mist` | `#F3F1F5` | Photo backgrounds, chips, panels, icon buttons | Ink 15.2:1, muted 5.7:1 |
| `mist-2` | `#EEEBF1` | Alternate photo background in grids | |
| `ink` | `#1E1A26` | Text, the Search button, links (underlined), dark chips | 17.1:1 on white |
| `muted` | `#625C6E` | Secondary text | 6.4:1 on white |
| `subtle` | `#706A7C` | Placeholders, counts | 5.2:1 on white |
| `line` | `#E6E1EC` | Dividers and card outlines (decorative only) | |
| `control` | `#857D92` | Borders of inputs, checkboxes, radios | 3.9:1 on white (WCAG 1.4.11) |
| `danger` | `#B42318` | Errors, auctions ending within the hour (with the time in words) | 6.6:1 on white |

The canvas showed yellow, green and blue accents first. The user turned them down on 2026-11-23 (Decisions log).

## 3. Type

- **Schibsted Grotesk** (variable, 400 to 900) for Latin text. **Hind Siliguri** (400, 500, 600, 700) for Bangla. Both are OFL-1.1, self-hosted from `@fontsource-variable/schibsted-grotesk` and `@fontsource/hind-siliguri`. They replace Noto Sans Bengali and the system font.
- Only the Latin subsets and the Bengali subset are shipped, with `font-display: swap`.
- Scale in px (line height): 13 (1.4), 15 (1.5) body, 17 (1.45), 21 (1.25), 28 (1.15), 34 (1.1), 44 to 58 (1.0) for the home headline and prices.
- Headings use weights 800 to 850 with tracking from -0.02 to -0.045 em in Latin. Bangla uses weight 700, no negative tracking and line height of at least 1.3 for headings and 1.6 for body text.
- Prices use tabular figures. Countdowns use tabular figures and never shift width.
- No all-capital labels, no eyebrow labels above headings, no monospace for data.

## 4. Shape, space, motion

- Radius: 999 px for buttons, chips and search fields; 12 px for inputs; 14 to 18 px for photos and cards; 20 to 32 px for large panels.
- Spacing on a 4 px grid. Page gutters are 56 px on desktop and 16 px on phones. Sections are 44 to 56 px apart.
- Shadows only on floating things: menus, the map card and the sticky bar on phones. Cards are flat.
- Motion only answers an action: opening, confirming, the outbid notice. Everything respects `prefers-reduced-motion`.

## 5. Logo

A price tag pointing left, in ink, with a peach hole and a peach check. The wordmark "trustbazaar" sits beside it in Schibsted Grotesk 800, lower case, tracking -0.035 em. On dark backgrounds (the staff console) the tag turns white. The mark is an inline SVG in the shell, so it needs no request.

## 6. Components (Mantine 8.3)

The theme sets `primaryColor: 'plum'` (a ten-shade scale built around `#4B2378`), `defaultRadius: 'md'`, the fonts above and the colours of section 2. Mantine's run-time `<style>` is off, and its CSS ships as a static file (Decisions log).

| Component | Built from | Notes |
|---|---|---|
| Buttons | `Button` | `filled` plum is the main action, one per view. `outline` with the `control` border. `light` on mist. Pill radius, 48 px tall (44 px minimum touch target). |
| Search field | `TextInput` with sections | Pill-shaped, 2 px ink border. The area picker and the Search button sit inside it on desktop. |
| Listing card | own `ListingCard` on `Card` | Square photo on mist, the price tag bottom-left, save heart top-right (`ActionIcon`, labelled). Title in at most 2 lines, then area and age. "Featured" in text under featured cards. |
| Price tag | own `PriceTag` | White tag with a grey hole, or peach for featured. Taka sign, tabular figures. Also used large for the promise. |
| Countdown | own `Countdown` on `Badge` | Ink pill with a dot: red within the hour, lilac otherwise. The server clock, as in U8-04. |
| Promise note | own `PromiseNote` on `Paper` | Shield icon, a bold line and one sentence, on peach cream. |
| Filters | `Checkbox`, `RangeSlider`, `SegmentedControl`, `Select` | Checkbox and radio borders use `control`. |
| Choice cards | `Radio.Card` | Delivery and payment choices. The selected card gets a plum border. |
| Steps | `Stepper` (horizontal on phones for the order, vertical in the editor) | Used only where the content really is a sequence. |
| Tabs | `Tabs` | Listing details and account sections. |
| Tables | `Table` | Staff queues, with ages in tabular figures. |
| Dialogs | `Modal` | Replaces `ConfirmDialog` and `StepUpDialog`, with the same texts and focus rules. |
| Shell | `AppShell` | Desktop header, footer, phone tab bar (Home, Search, Sell, Inbox, Account) with Sell in plum. |

## 7. Screens and acceptance criteria

Each screen keeps its current route, data and behaviour. "Done" means every criterion below holds in English and in Bangla, at 1440, 360 and 320 pixels wide, unless a criterion says otherwise.

### 7.1 Home (`/`): `home-desktop.jpg`, `home-phone.jpg`, `home-phone-bn.jpg`

- AC-HOME-1: The first screen shows the headline, the search field and, on desktop, the promise tag with the two facts (ID checked; bKash, Nagad or card). On phones the promise is a plum panel under the search.
- AC-HOME-2: The category row shows the first ten top categories, with "Everything" as an ink chip first; each links to its search. On phones it scrolls sideways inside itself, never the page. (No counts: the API gives none; Decisions log, U10-03.)
- AC-HOME-3: "Auctions ending soon" shows up to 4 cards (3 on phones, sideways scroll), each with the countdown pill on the photo and the current bid with the number of bids.
- AC-HOME-4: "Newest listings" is a 5-column grid at 1440 px and 2 columns on phones, with a link to all of them. Every card follows the listing card of section 6, without the save heart and the listing's age, which the API does not offer (Decisions log, U10-03). Featured listings keep their own section with the note "Sellers paid to show these listings here." (FR-MON-05).
- AC-HOME-5: The "Selling something?" strip has the three steps and "Start selling" linking to `/sell/new`.
- AC-HOME-6: LCP stays under 2.5 s on the Lighthouse run of U8-11 (NFR-PERF-07).

### 7.2 Search (`/search`): `search.jpg`

- AC-SRCH-1: Desktop has the filter column on the left (category with counts, price range with two fields, condition, how you get it, area, sale type). On phones the filters open in a full-screen drawer with the number of active filters on its button.
- AC-SRCH-2: Active filters show as removable ink chips with "Clear all". Every filter stays in the URL as now.
- AC-SRCH-3: The results grid has 4 columns on desktop and 2 on phones. "Show more" loads the next cursor page.
- AC-SRCH-4: An empty result says what to change ("No phones under ৳10,000 in Mirpur. Widen the price or the area.").

### 7.3 Listing (`/listings/:id`): `listing.jpg`, `listing-phone.jpg`

- AC-LST-1: The photos come first: a large first photo with the rest in two columns on wide screens, a sideways strip one photo wide on phones (reachable by keyboard). A listing without photos gives the space to its text.
- AC-LST-2: The side column holds the category link, the title, the price at 40 px (or the auction panel), "Buy now for ৳…" (plum, full width), the promise note and the seller card: initials, name linking to the profile, the month they joined, "Identity verified", and "Message the seller" (outline). No sales count or rating: the listing does not carry them (Decisions log, U10-04).
- AC-LST-3: On phones the page is one column: title, photos, price and button, promise, seller, then the text. There is no sticky buy bar; the tab bar holds the bottom of the screen (Decisions log, U10-04).
- AC-LST-4: Description, details (as a two-column list) and clarifications are sections under the photos, all readable without tabs. The description is plain text, as now.
- AC-LST-5: Game-account listings keep their risk disclosure, styled as a promise-style note in the danger colour family.

### 7.4 Auction panel: `auction.jpg`

- AC-AUC-1: The panel's dark top bar names the auction and shows the time left on the server's clock, in danger colour in the last hour.
- AC-AUC-2: The current bid is the largest figure. "You are the highest bidder" and "You have been outbid" appear as lilac and danger banners, announced to screen readers as now.
- AC-AUC-3: The bid field shows the minimum (the CP-08 increment); the button says "Place bid" (or "Raise my maximum"), and the confirmation names the amount, as U8-04 built it. The Idempotency-Key is unchanged.
- AC-AUC-4: The proxy bid is a switch with its maximum field. Bid history shows masked names and "You".

### 7.5 Checkout (`/checkout/:listingId`): `checkout.jpg`

- AC-CHK-1: The item (photo, title, price for one), the quantity when more than one is for sale, and "How you get it" as choice cards; a game account shows its same-browser note instead.
- AC-CHK-2: The summary column shows the total (or the item total plus delivery), "Continue to payment", the reserve note and the payment promise. The payment method and the price breakdown (FR-MON-10) are on the order page, where the payment is taken (U8-05; Decisions log, U10-05).
- AC-CHK-3: The test-mode banner is on checkout and on the order page while payment is due, with its wording (NFR-CMP-05).

### 7.6 Order and handover (`/orders/:id`): `order.jpg`, `order-phone.jpg`

- AC-ORD-1: The head shows the item's photo, the order title, the status as a badge, the role and the listing link. The money sentence follows on peach cream (NFR-USE-07).
- AC-ORD-2: Three steps (payment, handover or delivery, done) show done, current and next, in words for screen readers; the deadlines that apply follow as cards.
- AC-ORD-3: The handover code is one large number in a box with the "show it only once you have the item" instruction (I-27), read aloud as one code.
- AC-ORD-4: "Message …" (plum) and "Something is wrong" (outline) are the two actions. The dispute, rating and early-release flows of U8-09 and U8-07 keep their screens in this style.

### 7.7 Sell (`/sell/new`, `/sell/:id`): `sell.jpg`

- AC-SELL-1: A new or draft listing shows three steps (the item; its photos, or the game account's details; publishing), done, now or still to come, in words as well: in a column beside the panels on wide screens, in a row on phones. The sections stay as they are (Decisions log, U10-06).
- AC-SELL-2: The photos are square tiles, the first marked "Cover" and a "Shows defects" tag where it applies, each with its remove button; the file input sits in a dashed "Add photos" tile with the accepted formats; the upload progress is announced as now.
- AC-SELL-3: The commission note shows the rate in force (CP-25) and what the seller receives for the entered price.

### 7.8 Sign-in and account (`/signin`, `/register`, `/account/*`): `signin.jpg`

- AC-ACC-1: Sign-in and registration use the split layout on desktop, under the site's header: the form left, a peach-cream panel with the promise right, which stays in view while the registration form scrolls. On phones it is the form only (Decisions log, U10-07).
- AC-ACC-2: Fields have visible labels, errors under the field in danger red (with the summary at the top as before), and the human-check line "Protected by a short check in your browser. No puzzles." under the main button.
- AC-ACC-3: Account, security (with the authenticator app), notifications, messages and privacy pages share one row of tabs, the current one marked in words as well as colour (`aria-current`), and the same inputs, panels and pill buttons, with no new layout of their own. On phones the tab row scrolls on its own, never the page.

### 7.9 ID check (`kyc.html`): `kyc.jpg`

- AC-KYC-1: A slim header with "Finish later", back to the account page (nothing is kept: the images stay only in the page until they are sent, U8-03). On narrow phones the logo's word and the document's name give way to it. Four steps (your details, your document, selfies, send) show above the camera, done, now or still to come in words as well, with "Step n of N" under them (Decisions log, U10-08).
- AC-KYC-2: The camera view sits in a dark stage, darkened around a card-shaped frame (the passport page's for a passport, an oval for selfies), with the instruction in it. "Take the photo" is the main action. The file is offered as a dashed "Choose a photo of the document" tile only where U8-03 allows it: for a document, after the camera was refused, missing or failed.
- AC-KYC-3: From the details step on, the side panel lists the photo rules, says who sees the ID, and that the expected review time is shown after sending. On the first step the same text is in the page, so the panel is not shown.

The credential screens (`secure.html`, no React and no shared code, SEC-GAM-03) repeat the tokens and fonts in their own stylesheet, with a slim header carrying the logo. The key's fingerprint and the login details stay in a monospace face, so 0 and O or l and 1 cannot be confused (Decisions log, U10-08).

### 7.10 Staff console (`staff.html`): `staff.jpg`

- AC-STF-1: A dark navigation with, for operators, the eight queues and the number of cases waiting in each (from the queues' own answers, refreshed every minute; "200+" when a queue answer is full, none when a queue is not available), then approvals and terms; for administrators, approvals and the administrators' section. Beside the page from 60rem, above it on smaller screens. The site header with the language switch stays above (Decisions log, U10-09).
- AC-STF-2: Each queue is a table of case, what it is, amount, waiting time and who has it, with the claim or open action. Ages are in tabular figures, and ages of a day or more are in danger red, with the time in words; overdue cases also say "Overdue" and carry a red edge.
- AC-STF-3: The console stays usable at 1280 px. On phones each row stacks, every cell under its column's name.

## 8. Acceptance for the whole redesign (U10-10)

- AC-ALL-1: No screen scrolls sideways at 360 or 320 px (NFR-USE-05), in English and, at 320 px, in Bangla.
- AC-ALL-2: No serious or critical axe issue, and the contrasts of section 2 hold (NFR-USE-06).
- AC-ALL-3: No CSP or Trusted Types violation under the production headers, and no request to another origin (fonts included).
- AC-ALL-4: The first load of the home page stays within 170 KB of gzipped JavaScript, and the fonts load after first paint: in the React documents `language/font.ts` adds them once the window's load event has passed and the browser is idle, never through a stylesheet (Decisions log, U10-10).
- AC-ALL-5: The five end-to-end journeys of U8-11 pass unchanged, apart from selectors that name the new components.
- AC-ALL-6: Every text is in both catalogues with the same keys and placeholders (NFR-USE-04).
