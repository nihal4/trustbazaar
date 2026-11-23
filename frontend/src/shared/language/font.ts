// The site's fonts, self-hosted (font-src 'self') and loaded after the page's first paint and largest paint, once the
// window's load event has passed and the browser is idle (docs/design/10_visual.md, sections 3 and 8, AC-ALL-4; Decisions log, U8-01, U10-01
// and U10-10). Until they arrive the text shows in the system font and then swaps, so the fonts never hold up the
// listing photo or any other first content (NFR-PERF-07).
// - Schibsted Grotesk, variable 400 to 900, the Latin and Latin Extended subsets, for every page;
// - Hind Siliguri, regular and bold, the Bengali block only, when the language is Bangla.
import latin from '@fontsource-variable/schibsted-grotesk/files/schibsted-grotesk-latin-wght-normal.woff2?url';
import latinExt from '@fontsource-variable/schibsted-grotesk/files/schibsted-grotesk-latin-ext-wght-normal.woff2?url';
import regular from '@fontsource/hind-siliguri/files/hind-siliguri-bengali-400-normal.woff2?url';
import bold from '@fontsource/hind-siliguri/files/hind-siliguri-bengali-700-normal.woff2?url';

export const LATIN_FONT = 'Schibsted Grotesk Variable';
export const BANGLA_FONT = 'Hind Siliguri';
const LATIN_RANGE = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';
const LATIN_EXT_RANGE = 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF';
const BENGALI_RANGE = 'U+0951-0952, U+0964-0965, U+0980-09FE, U+1CD0-1CF9, U+200C-200D, U+20B9, U+25CC, U+A8F1';

type Face = { family: string; url: string; weight: string; range: string; format: string };
const LATIN: Face[] = [
  { family: LATIN_FONT, url: latin, weight: '400 900', range: LATIN_RANGE, format: 'woff2-variations' },
  { family: LATIN_FONT, url: latinExt, weight: '400 900', range: LATIN_EXT_RANGE, format: 'woff2-variations' },
];
const BANGLA: Face[] = [
  { family: BANGLA_FONT, url: regular, weight: '400', range: BENGALI_RANGE, format: 'woff2' },
  { family: BANGLA_FONT, url: bold, weight: '700', range: BENGALI_RANGE, format: 'woff2' },
];

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

export function loadLatinFont(fonts: FontFaceSet | undefined = globalThis.document?.fonts): void {
  afterLoad(() => add(LATIN, fonts));
}

export function loadBanglaFont(fonts: FontFaceSet | undefined = globalThis.document?.fonts): void {
  afterLoad(() => add(BANGLA, fonts));
}
