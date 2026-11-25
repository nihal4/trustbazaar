---
version: 1
slug: "frontend-src-features-search-searchpage-tsx"
primary_target: "frontend/src/features/search/SearchPage.tsx"
related_targets: []
---

# Surface: TrustBazaar search (the buyer's results screen)

Scope: `frontend/src/features/search/SearchPage.tsx` and its stylesheet, plus the shared `Dropdown` and the header search; mode Operate, inheriting the home page's world (green-black dark theme, Schibsted Grotesk, vermilion as the one hot colour, ruled hairline grid, 4px radii; see DESIGN.md and the home contract in `.impeccable/surfaces/frontend-index-html.md`). Audience: buyers in Bangladesh on mid-range phones; job: narrow thousands of used listings to a few and open one. Constraints: Bangla and English equal, 44px targets, CSP/Trusted Types, WCAG 2.2 AA, 320px.

## Direction contract

THESIS: Search is a ruled ledger of results, not a marketplace grid of cards: lines separate, nothing is boxed.
OWN-WORLD: The home page's: ground #0A1110, hairline #2A3B36, text #F1F5F3, vermilion #FF6B35 for the one action and the focus mark, protect green only for held or verified, Schibsted Grotesk 600 headings, Figtree text and figures. Controls without boxes: the search bar is a row between two lines, each filter is a row between hairlines with an orange chevron, the dropdown opens as square ruled rows with an orange tick on the chosen one; active filters are outlined chips with an orange cross.
STORY: The buyer types, narrows with a few ruled filters, sees a ruled grid of listings with price first, and opens one. On phones the filters are a sheet that slides up over the page with the one action fixed at its bottom.
FIRST VIEWPORT: Title and one line, the search bar (one row, one orange Search button), then on wide screens the filter rail on the left (under a hairline) and Results with the ruled card grid on the right; on phones the bar, a ruled 'Show filters' row, then the results.
FORM: Inherited from the home world, pinned by the user in words: 'i want them ruled grid as the home page, the result grid looks nice' and 'the drop down now looks good'. seed: none (pinned).
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
