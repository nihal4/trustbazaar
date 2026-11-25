// The site's fonts, self-hosted (font-src 'self') and loaded after the page's first paint and largest paint, once the
// window's load event has passed and the browser is idle (docs/design/10_visual.md, sections 3 and 8, AC-ALL-4; Decisions log, U8-01, U10-01
// and U10-10). Until they arrive the text shows in the system font and then swaps, so the fonts never hold up the
// listing photo or any other first content (NFR-PERF-07).
// - Figtree (text) and Gabarito (headlines), variable, the Latin and Latin Extended subsets, for every page (redesign v3, U10-21, dealt by taste-skill);
// - Hind Siliguri, 400 to 700, the Bengali block only, when the language is Bangla;
// - with it, the Bangla figures: the digits, the taka sign and the comma, full stop and colon between them, cut from
//   Noto Sans Bengali (figures/, scripts/subset-figures.py, SIL OFL 1.1). Hind draws the digit one as a small hook
//   high in its box, so "৳১৫,০০০" read as "৳ ৫,০০০"; the figures face comes first in the Bangla stack, so every
//   number is drawn by one face whose digits read clearly (Decisions log, U10-20). About 2.5 KB a weight. In
//   English it comes after Geist and draws only the taka sign, which Geist lacks.
import latin from '@fontsource-variable/figtree/files/figtree-latin-wght-normal.woff2?url';
import latinExt from '@fontsource-variable/figtree/files/figtree-latin-ext-wght-normal.woff2?url';
import displayLatin from '@fontsource-variable/gabarito/files/gabarito-latin-wght-normal.woff2?url';
import displayLatinExt from '@fontsource-variable/gabarito/files/gabarito-latin-ext-wght-normal.woff2?url';
import regular from '@fontsource/hind-siliguri/files/hind-siliguri-bengali-400-normal.woff2?url';
import medium from '@fontsource/hind-siliguri/files/hind-siliguri-bengali-500-normal.woff2?url';
import semibold from '@fontsource/hind-siliguri/files/hind-siliguri-bengali-600-normal.woff2?url';
import bold from '@fontsource/hind-siliguri/files/hind-siliguri-bengali-700-normal.woff2?url';
import digits400 from './figures/figures-digits-400.woff2?url';
import digits500 from './figures/figures-digits-500.woff2?url';
import digits600 from './figures/figures-digits-600.woff2?url';
import digits700 from './figures/figures-digits-700.woff2?url';
import marks400 from './figures/figures-marks-400.woff2?url';
import marks500 from './figures/figures-marks-500.woff2?url';
import marks600 from './figures/figures-marks-600.woff2?url';
import marks700 from './figures/figures-marks-700.woff2?url';

export const LATIN_FONT = 'Figtree Variable';
export const DISPLAY_FONT = 'Gabarito Variable';
export const BANGLA_FONT = 'Hind Siliguri';
export const FIGURES_FONT = 'TB Figures';
/** the Bangla digits ০ to ৯ and the taka sign ৳; the separators a number uses between them */
export const FIGURES_RANGE = 'U+09E6-09EF, U+09F3';
export const MARKS_RANGE = 'U+002C, U+002E, U+003A';
const LATIN_RANGE = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';
const LATIN_EXT_RANGE = 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF';
const BENGALI_RANGE = 'U+0951-0952, U+0964-0965, U+0980-09FE, U+1CD0-1CF9, U+200C-200D, U+20B9, U+25CC, U+A8F1';

type Face = { family: string; url: string; weight: string; range: string; format: string };
const LATIN: Face[] = [
  { family: LATIN_FONT, url: latin, weight: '100 900', range: LATIN_RANGE, format: 'woff2-variations' },
  { family: LATIN_FONT, url: latinExt, weight: '100 900', range: LATIN_EXT_RANGE, format: 'woff2-variations' },
  { family: DISPLAY_FONT, url: displayLatin, weight: '100 900', range: LATIN_RANGE, format: 'woff2-variations' },
  { family: DISPLAY_FONT, url: displayLatinExt, weight: '100 900', range: LATIN_EXT_RANGE, format: 'woff2-variations' },
];
const BANGLA: Face[] = [
  { family: BANGLA_FONT, url: regular, weight: '400', range: BENGALI_RANGE, format: 'woff2' },
  { family: BANGLA_FONT, url: medium, weight: '500', range: BENGALI_RANGE, format: 'woff2' },
  { family: BANGLA_FONT, url: semibold, weight: '600', range: BENGALI_RANGE, format: 'woff2' },
  { family: BANGLA_FONT, url: bold, weight: '700', range: BENGALI_RANGE, format: 'woff2' },
];
const FIGURES: Face[] = ([[400, digits400, marks400], [500, digits500, marks500], [600, digits600, marks600], [700, digits700, marks700]] as const)
  .flatMap(([weight, d, m]) => [
    { family: FIGURES_FONT, url: d, weight: String(weight), range: FIGURES_RANGE, format: 'woff2' },
    { family: FIGURES_FONT, url: m, weight: String(weight), range: MARKS_RANGE, format: 'woff2' },
  ]);

const added = new Set<string>();

/** Adds the faces once per document; each is fetched only when text in its range is on the page. */
function add(faces: Face[], fonts: FontFaceSet | undefined): void {
  if (!fonts || typeof FontFace === 'undefined' || added.has(faces[0].family)) return;
  added.add(faces[0].family);
  for (const f of faces) {
    const face = new FontFace(f.family, `url(${f.url}) format('${f.format}')`, { weight: f.weight, style: 'normal', display: 'swap', unicodeRange: f.range });
    fonts.add(face);   // not load(): the browser fetches a face only when text in its range is shown
  }
}

/** Runs once the window's load event has passed and the browser is next idle (at most a second later), so the
 *  page's largest paint comes first. */
export function afterLoad(run: () => void, win: Window | undefined = globalThis.window): void {
  if (!win) return;
  const idle = () => (typeof win.requestIdleCallback === 'function' ? win.requestIdleCallback(run, { timeout: 1000 }) : win.setTimeout(run, 200));
  if (win.document.readyState === 'complete') { idle(); return; }
  win.addEventListener('load', idle, { once: true });
}

/** Figtree has no taka sign; the figures face, after Figtree in the stack, draws "৳" in English too, so a price never
 *  falls back to whatever font the device has (only the digits file is fetched, when a price is shown). */
export function loadLatinFont(fonts: FontFaceSet | undefined = globalThis.document?.fonts): void {
  afterLoad(() => { add(LATIN, fonts); add(FIGURES, fonts); });
}

export function loadBanglaFont(fonts: FontFaceSet | undefined = globalThis.document?.fonts): void {
  afterLoad(() => { add(FIGURES, fonts); add(BANGLA, fonts); });   // add() runs each set once per document
}
