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
