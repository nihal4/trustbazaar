---
version: 1
slug: "frontend-index-html"
primary_target: "frontend/index.html"
related_targets: []
---

# Surface: the TrustBazaar user app (buyer first)

Scope: the user app (`frontend/index.html` and its routes), mode Operate; the KYC, credential and staff documents
inherit the same world later. Audience: buyers in Bangladesh on mid-range Android phones; job: find a used item and
pay a stranger safely. Constraints: Bangla and English equal; CSP `style-src 'self'`, Trusted Types, self-hosted
fonts; 170 KB first-load JS; LCP 2.5 s; WCAG 2.2 AA; no violet (taste-skill), no yellow or green (user, U10).

## Direction contract

THESIS: Every order is a money order. The buyer's money is paid in at the counter, held, and paid out to the seller only when the buyer signs for the item. Refuses the category default: a product grid with a generic "secure checkout" badge.

OWN-WORLD: Bangladesh Post money-order forms. Paper ground #F7F9F8, second sheet #EBF0EE, one petrol-teal ink #06525C for type rules and the main action; a pale carbon-copy teal for duplicates; red only for errors. Geist (Latin) and Hind Siliguri (Bangla), 400 and 500; amounts in tabular figures and, on the counterfoil, in words as on the form. Boxed fields on hairline rules, 6 px radius, no shadows, perforated tear lines.

STORY: The buyer sees the item and its price in figures and words, reads on the counterfoil that the money is held until they sign, buys, keeps their stub, and signs on handover; the seller sees when the money is paid out.

FIRST VIEWPORT: Top bar: logo, search, Sell, account. Listing page: photos left; right, the counterfoil panel: price in figures and words, three stubs (paid in, held, paid out), and the Buy button inside it. Home: search first, category row, listing grid, with the counterfoil promise as a single strip above the grid.

FORM: Postal money order, position 1 of my ordered list (shown as IMPECCABLE'S PICK and chosen by the user over the assigned stamp-paper direction), seed:8f0eb28bb01b944c. Signature move: the counterfoil, a panel split by a perforated tear line whose stub is postmarked with the date when the money is paid out; on listing, checkout, order and payout screens. Motion only on that state change, 200 ms.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

- The roll ran degraded (no catalogue challengers, no quality-bar boards).
- Teal sits next to the user's "not green" from U10; accepted by the user on 2026-11-24.
