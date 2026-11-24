# Visual design, version 2: Money order (U10-11 to U10-19)

Status: in progress (U10-11, 2026-11-25). Replaces the Daylight world of `10_visual.md` screen by screen; until a
screen's task is done, that screen keeps its Daylight layout in the new colours and type. Section 8 of
`10_visual.md` (the whole-site acceptance criteria AC-ALL-1 to AC-ALL-6) still applies, with the values below.

Product truth lives in `PRODUCT.md` at the repository root. The direction was set with the user on 2026-11-24 with
two design skills: impeccable (product record, direction roll, finish review) and taste-skill (palette and type
dealer, no violet). The direction contract the finish review checks is in
`.impeccable/surfaces/frontend-index-html.md`.

## 1. The idea

**Every order is a money order.** Bangladesh Post's money order is how money was sent safely before mobile
money: paid in at the counter, held, paid out against a signature, with a counterfoil the sender keeps. TrustBazaar
does the same with escrow: the buyer's money is paid in, held, and paid out to the seller only when the buyer
confirms the handover. The world lends the app four things and only these (impeccable's Operate mode): type,
palette, density, and one signature move, the counterfoil. It never supplies the layout, the navigation or the
controls, which stay the standard ones.

What it refuses: a product grid with a generic "secure checkout" badge (the category default), and costume (ruled
ledger paper, rubber-stamp clip art, perforations on every box).

## 2. Colour (taste-skill deal: "teal on paper")

| Token | Value | Use |
|---|---|---|
| `--tb-bg` | `#F7F9F8` | paper: the page ground |
| `--tb-sheet` | `#FFFFFF` | the form: panels and fields on the paper |
| `--tb-surface` | `#EBF0EE` | second sheet: stubs, quiet panels, chips |
| `--tb-text` | `#0D2326` | ink, 15.5:1 on paper |
| `--tb-muted` | `#4A5F62` | secondary text, 5.9:1 on the surface |
| `--tb-border` | `#73878A` | control borders and the tear line, 3.3:1 on the surface |
| `--tb-line` | `#D3DDDB` | hairlines |
| `--tb-accent` | `#06525C` | petrol teal: the main action, links, selection, the postmark; white on it 8.9:1 |
| `--tb-accent-soft` | `#D9E8E8` | carbon copy: selected and current states |
| `--tb-accent-strong` | `#04363D` | text on the carbon copy, 10.4:1 |
| `--tb-error` | `#B42318` | errors and the last hour of an auction only |

Strategy: Restrained. One ink carries actions, selection and state; red never decorates. Success is the teal ink, not
green. No violet or lavender (taste-skill), no yellow or green (the user, U10-01).

## 3. Type

Geist (variable, self-hosted) for Latin and Hind Siliguri (400 to 700) for Bangla, loaded after the page's load event
(`language/font.ts`, AC-ALL-4). Headings 600, text 400, buttons and labels 600; amounts in tabular figures. Bangla line
height 1.7, no negative tracking.

## 4. Shape and depth

Radius 6 px for controls, 10 px for panels (`--tb-radius-control`, `--tb-radius-panel`); no pills, no shadows. Panels
are white sheets on the paper with a hairline; a state is a full border or a tint, never a bar down one side.

## 5. The mark

A money-order counterfoil in teal: the stub torn along a row of perforations and the form postmarked with a tick
(`shared/Logo.tsx`, and inline in `secure.html`), beside the wordmark "trustbazaar" in Geist.

## 6. The counterfoil (the signature)

`shared/Counterfoil.tsx`: a form split by a perforated tear line. The stub keeps the reference and the amount; the
form shows where the money is (paid in, held, paid out, each marked done, now or to come in words as well) and holds
the action; once the money is paid out, the stub carries a postmark with the date. Only the state change moves (the
stage box fills in 200 ms). It appears where money is decided: the listing's buy panel, checkout, the order, the
seller's payouts. `shared/PromiseNote.tsx` is its short form, a strip whose stub carries the postmark tick.

## 7. Screens (one task each; acceptance criteria are written by each task)

- U10-11: foundation (tokens, theme, fonts, mark, counterfoil, the shell in the new world).
- U10-12: home and search. U10-13: listing and auction. U10-14: checkout and orders. U10-15: sell editor and seller
  pages. U10-16: account, sign-in, notifications, chat and privacy. U10-17: ID check and credential pages. U10-18:
  staff console. U10-19: sweep, impeccable's finish review and `DESIGN.md`.

### AC-FND (U10-11)

- AC-FND-1: Every page uses the tokens of section 2; no violet, lilac or plum remains in the app's own styles, and
  the contrast pairs hold (`src/shared/visual.test.ts`).
- AC-FND-2: Geist and Hind Siliguri 400 to 700 are self-hosted and load after the load event; the credential page
  carries the same tokens and fonts in its own stylesheet.
- AC-FND-3: Controls have a 6 px radius and panels 10 px; there are no pill shapes or shadows in the app's own styles.
- AC-FND-4: The counterfoil shows where the money is in words as well as marks, and its postmark only once the money
  is paid out (`src/shared/counterfoil.test.tsx`); the payment promise is its short form.

### AC-HOME and AC-SRC (U10-12)

- AC-HOME-1: Beside the headline and the search (below them on phones) the counterfoil shows, in order, how the money
  moves: you pay TrustBazaar, we hold it, the seller is paid when you confirm. It is an explanation, so it shows no
  amount and claims no state; the facts (identity checked; bKash, Nagad or card) sit under the search.
- AC-HOME-2: A listing card shows the photo on the second sheet inside a hairline, the price first in tabular figures,
  then the title and the details; the time left of an auction (red in its last hour) and "Featured" are small boxes on
  the photo, in words.
- AC-HOME-3: Categories are boxed links on white, the current one in ink; sections are headed on a hairline; how
  selling works is one sheet with its three numbered steps (a real sequence).
- AC-SRC-1: The search field and its button match the home page's; from 60rem the filters stand on a white sheet.
- AC-SRC-2: The filters in use show as carbon-copy chips with a teal edge; an empty result is a dashed sheet.

The sample photos of the local stack (`backend/test/e2e/photos/`) were recoloured from lavender to the paper ground
and teal, and the home page's phone render (`hero-phone.webp`) is gone: the counterfoil carries the first screen.

### AC-LST (U10-13)

- AC-LST-1: A fixed-price item's buy panel is the counterfoil: the stub names the price (and how many are left), the
  amount stands on the stub and on the form, and the form says the money waits with us, shows in order how it moves
  (an explanation, so no state is claimed) and holds the buy button. The promise strip is not repeated beside it.
- AC-LST-2: The auction panel is a counterfoil too: its stub on the second sheet carries "Auction" and the time left
  in tabular figures (red in the last minutes, with the warning in words), above the tear line; the form carries the
  price first, the bid, the rules and the history. The promise's short form follows the panel.
- AC-LST-3: The photos sit on the second sheet inside a hairline; "Shows defects" is a box on the photo, in words; the
  seller's initials stand in a square stamp; the game-account warning uses the error tokens only.

### AC-ORD (U10-14)

- AC-ORD-1: At checkout the summary is the counterfoil: the stub says the total to pay (or the item total plus the
  delivery fee), the form carries the total in figures and, when it is final, in words (`shared/amountWords.ts`: the
  South Asian scale, "taka ... only" and "টাকা ... মাত্র"), how the money moves in order, and the button with the
  reservation note. The promise strip is not repeated beside it.
- AC-ORD-2: On the order, the steps and the money sentence become one counterfoil: the stub keeps the total; the form
  says in one sentence where the money is (NFR-USE-07; for a buyer who still has to pay, that it is not paid yet), the total in
  figures and words, and the steps (payment, handover or delivery, done) with the current one marked, in words too.
  Once the money has left TrustBazaar (paid out to the seller or refunded), the stub carries the postmark with the day
  in Dhaka.
- AC-ORD-3: The order's inputs and panels follow the foundation: 6 px controls on white, no inset shadows, no
  one-sided bars (a seller's reply to a rating is a boxed note), the game-account warning in the error tokens only.

### AC-SEL (U10-15)

- AC-SEL-1: The listing editor's steps are marked with the counterfoil's boxes (filled when done, carbon copy for the
  current step, open for the next), in words too; inputs and choices are 6 px controls on white with full 1 px
  borders; photo tiles sit in a hairline, the cover marked in ink and "Shows defects" in a bordered box; the add tile
  is dashed; no inset shadows and no monospace.
- AC-SEL-2: On the seller dashboard each statement is a counterfoil: the stub keeps the day it settled and, once its
  payout was sent, the postmark with that day; the form carries the order's title, the payout in figures and words,
  and the breakdown. In the list of payouts a sent payout carries the same stamp with its day. Rows are white sheets
  in a hairline.
