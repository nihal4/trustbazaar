// Noto Sans Bengali, self-hosted (font-src 'self'), loaded only when the language is Bangla
// (section 6.1; Decisions log, U8-01). Two weights: regular for text, bold for headings and buttons.
// The faces cover the Bengali block only, so Latin text keeps the system font.
import regular from '@fontsource/noto-sans-bengali/files/noto-sans-bengali-bengali-400-normal.woff2?url';
import bold from '@fontsource/noto-sans-bengali/files/noto-sans-bengali-bengali-700-normal.woff2?url';

export const BANGLA_FONT = 'Noto Sans Bengali';
const BENGALI_RANGE = 'U+0951-0952, U+0964-0965, U+0980-09FE, U+1CD0-1CF9, U+200C-200D, U+20B9, U+25CC, U+A8F1';

let added = false;

/** Adds and starts loading the two faces, once per document. Does nothing where FontFace is missing. */
export function loadBanglaFont(fonts: FontFaceSet | undefined = globalThis.document?.fonts): void {
  if (added || !fonts || typeof FontFace === 'undefined') return;
  added = true;
  for (const [url, weight] of [[regular, '400'], [bold, '700']] as const) {
    const face = new FontFace(BANGLA_FONT, `url(${url}) format('woff2')`, {
      weight, style: 'normal', display: 'swap', unicodeRange: BENGALI_RANGE,
    });
    fonts.add(face);
    face.load().catch(() => {
      // the system font stays; Bangla text is still readable
    });
  }
}
