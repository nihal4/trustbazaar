# Visual design: Daylight (U10)

Status: draft for review (U10-01). The images in `10_visual/` are previews of the mockups, rendered in the browser of the build container, which falls back to system fonts. The real pages use the fonts named here. The originals are on the "TrustBazaar design: Daylight" canvas (ask Sabikun Nahar Sinthia for access).

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

- AC-CHK-1: The item summary, then "How do you want to get it?" and "How do you want to pay?" as choice cards. Payment methods are named in text only, with no logos.
- AC-CHK-2: The summary column shows every line of the price breakdown and the total (FR-MON-10), then the pay button naming the amount and the method, then the promise note and the checkout hold (CP-13, 15 minutes).
- AC-CHK-3: The simulated-payment banner is on the page in ink with a "Demo" label (NFR-CMP-05).

### 7.6 Order and handover (`/orders/:id`): `order.jpg`, `order-phone.jpg`

- AC-ORD-1: The headline says what to do next. The money sentence comes first in plum and ink (NFR-USE-07).
- AC-ORD-2: The order's steps show done, current and next. The current step names its deadline.
- AC-ORD-3: The handover code is in six large boxes with the "show it only once you have the item" instruction (I-27). The meeting place card offers "Change".
- AC-ORD-4: "Message …" (plum) and "Something is wrong" (outline) are the two actions. The dispute, rating and early-release flows of U8-09 and U8-07 keep their screens in this style.

### 7.7 Sell (`/sell/new`, `/sell/:id`): `sell.jpg`

- AC-SELL-1: The editor shows its sections as a vertical step list (category, photos, details, price and sale type, area and delivery, check and publish). On phones it is a single column with a step counter.
- AC-SELL-2: The photo grid shows the cover badge, upload progress per photo and an "Add photos" tile with the accepted formats.
- AC-SELL-3: The commission note shows the rate in force (CP-25) and what the seller receives for the entered price.

### 7.8 Sign-in and account (`/signin`, `/register`, `/account/*`): `signin.jpg`

- AC-ACC-1: Sign-in and registration use the split layout on desktop (form left, peach side with the promise right). On phones it is the form only.
- AC-ACC-2: Fields have visible labels, errors under the field in danger red, and the human-check line under the button.
- AC-ACC-3: Account, security, MFA, notifications, messages and privacy pages use the same tabs, inputs and buttons, with no new layout of their own.

### 7.9 ID check (`kyc.html`): `kyc.jpg`

- AC-KYC-1: A slim header with "Save and finish later". The steps show above the camera.
- AC-KYC-2: The camera view darkens around a card-shaped frame, with the instruction in it. "Take photo" is the main action. The file upload is offered as "Camera not working? Upload a file", only where U8-03 allows it.
- AC-KYC-3: The side panel lists the photo rules and says who sees the ID.

### 7.10 Staff console (`staff.html`): `staff.jpg`

- AC-STF-1: A dark left navigation with the eight queues and their counts, approvals, and the administrators' section for administrators only.
- AC-STF-2: The queue table shows case, queue, reason, subject, amount and the age in tabular figures. Ages over 24 hours are in danger red, with the time in words.
- AC-STF-3: The console stays usable at 1280 px. On phones it falls back to stacked rows, as now.

## 8. Acceptance for the whole redesign (U10-10)

- AC-ALL-1: No screen scrolls sideways at 360 or 320 px (NFR-USE-05).
- AC-ALL-2: No serious or critical axe issue, and the contrasts of section 2 hold (NFR-USE-06).
- AC-ALL-3: No CSP or Trusted Types violation under the production headers, and no request to another origin (fonts included).
- AC-ALL-4: The first load of the home page stays within 170 KB of gzipped JavaScript, and the fonts load after first paint.
- AC-ALL-5: The five end-to-end journeys of U8-11 pass unchanged, apart from selectors that name the new components.
- AC-ALL-6: Every text is in both catalogues with the same keys and placeholders (NFR-USE-04).
