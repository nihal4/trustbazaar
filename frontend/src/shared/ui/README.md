# The design system (`shared/ui`)

Every kind of thing on the site exists **once** here, with variants, and a page chooses a variant. This is what keeps one change of a token a change of the whole site, and what keeps the site looking like one thing.

| Component | Variants and sizes |
|---|---|
| `Button`, `IconButton` | `primary`, `secondary`, `quiet`, `danger`, `link` (`inline` in a sentence); sizes `md` (44 px) and `lg` (56 px); `loading`; `as={Link}` makes a link that looks like a button |
| `Field`, `Input`, `Select`, `Textarea`, `TextField` | the underline look (default) or `look="box"`; `block` fills its container; a label, a hint and an error tied to the control |
| `Radio`, `Checkbox` | a round ring with a dot, and a square box; the whole row is the target |
| `Notice` | `info`, `success`, `warning`, `error`; an error is announced at once |
| `Tag`, `Count` | tones `neutral`, `hot`, `ok`, `error`; a count caps at 99+ |
| `Avatar` | `sm`, `md`, `lg`; initials in any script |
| `Panel`, `Section`, `Card` | a panel is `section` (a rule on top), `boxed` or `emphasis` (a 2 px vermilion rule); a card can be a link |
| `FactList` | 1 to 4 columns, fewer on a phone |
| `Stepper` | `look`: `rule` (default), `line` (balls on a line: an order's money), `rows` (a ruled list with a ball), `onDark`; a row, or a column on a phone; the steps and their states come in as data |
| `Table` | stacks into blocks on a phone |
| `Tabs`, `Tab` | links; the current one has `aria-current` and a vermilion rule |
| `ActionList`, `ActionCell` | a ruled list of rows with an arrow at the end of each (`primary`, `quiet`; `as` makes a link; `compact`); a cell outside a list is a ruled cell of its own |
| `Popup`, `PopupActions`, `ConfirmDialog` | a dialog over a blurred page; `hidden` keeps what was typed; `PopupActions` is the ruled cells at its foot |
| `Calendar` | a month grid with a month and a year to choose; the language comes in as props |

## The rules

- **Presentational only.** No API, router, react-query, language layer, features or staff code (`npm run deps` fails on it). Words and data arrive as props; what a role sees is decided by a view-model function in the feature (for example `features/orders/progress.ts`) and passed in.
- **Tokens only.** Colours, sizes, gaps, corners and durations come from `shared/tokens.css`.
- **Accessible by construction.** A control has a visible label; an icon-only button has a name; targets are 44 px; focus is visible. Tests are named after `NFR-USE-06`.
- **A story for each**, in the same folder (`npm run storybook`, in `frontend/`), in dark and light, English and Bangla.
- **Add a variant** here rather than a one-off in a page's stylesheet ([docs/HOW-TO.md](../../../../docs/HOW-TO.md)).

The components were chosen from an inventory of what the site had (143 variants of 13 kinds); the approved set is [docs/design/11_inventory/canonical-set.html](../../../../docs/design/11_inventory/canonical-set.html).
