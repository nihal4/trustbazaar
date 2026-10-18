# TrustBazaar documents

| Document | Source | PDF |
|---|---|---|
| Software Requirements Specification, v2.0 | `srs.tex` | `srs.pdf` |
| Project Proposal (revised) | `proposal.tex` | `proposal.pdf` |
| Supplementary Market Analysis: *Trust in Bangladesh's Second-Hand Online Market* | `supplementary/main.tex` | `supplementary/market_analysis.pdf` |
| System Design Document, Unit 1: Identity & Access | `design/01_identity_access.tex` | `design/01_identity_access.pdf` |
| System Design Document, Unit 2: Order, Payment & Escrow | `design/02_orders_payments.tex` | `design/02_orders_payments.pdf` |
| System Design Document, Unit 3: Auction Engine; Listings, Search & Fixed-Price | `design/03_listings_auctions.tex` | `design/03_listings_auctions.pdf` |
| System Design Document, Unit 4: Delivery & Handover | `design/04_delivery.tex` | `design/04_delivery.pdf` |
| System Design Document, Unit 5: Game-Account Escrow | `design/05_game_accounts.tex` | `design/05_game_accounts.pdf` |
| System Design Document, Unit 6: Chat & Notifications | `design/06_chat_notifications.tex` | `design/06_chat_notifications.pdf` |
| System Design Document, Unit 7: Disputes, Trust & Safety, Staff Tools | `design/07_disputes_trust_staff.tex` | `design/07_disputes_trust_staff.pdf` |
| System Design Document, Unit 8: Frontend | `design/08_frontend.tex` | `design/08_frontend.pdf` |
| System Design Document, Unit 9: Integration | `design/09_integration.tex` | `design/09_integration.pdf` |

## Building

All three documents build with `latexmk` (TeX Live 2022 or later):

```bash
cd docs
latexmk -pdf srs.tex
latexmk -pdf proposal.tex

cd supplementary
python3 make_figures.py      # optional: regenerates figs/ (needs matplotlib)
latexmk -pdf main.tex        # produces main.pdf; the committed copy is market_analysis.pdf
```

## Notes

- **Requirement identifiers.** SRS v2.0 uses area-based identifiers (for example `FR-AUC-03`, `SEC-AUTH-01`). Appendix D of the SRS maps every v1.1 number (`FR-1` to `FR-103`, `NFR-1` to `NFR-23`) to its new identifier.
- **Supplementary report sources.** The file names are offset from the section numbers: `main.tex` holds Sections 1–2, `section2.tex` is Section 3, `section3.tex` is Section 4, `section4.tex` is Section 5 and `section5.tex` is Section 6.
- **Diagrams.** The supplementary report's TikZ diagrams are in `supplementary/diagrams/`.
