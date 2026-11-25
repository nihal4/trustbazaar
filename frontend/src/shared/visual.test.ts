import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { placeholders } from '../lib/i18n.js';

// The checks of the whole redesign that need no browser (U10-10; docs/design/10_visual.md, section 8): the colour
// pairs of section 2 keep their contrast (AC-ALL-2), the credential document repeats the same tokens (it may not
// import them, SEC-GAM-03), the fonts are self-hosted and swap in after first paint (AC-ALL-3, AC-ALL-4), and every
// catalogue has its Bangla twin with the same keys and placeholders (AC-ALL-6).

const SRC = join(__dirname, '..');
const read = (path: string) => readFileSync(join(SRC, path), 'utf8');

/** The custom properties of a stylesheet's first :root block, without the --tb- prefix. */
function tokens(css: string): Record<string, string> {
  const root = /:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
  return Object.fromEntries([...root.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1].replace(/^tb-/, ''), m[2].trim().toLowerCase()]));
}

/** WCAG 2.2 contrast ratio of two #rrggbb colours. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('the Daylight colours', () => {
  const t = tokens(read('shared/tokens.css'));

  it.each([
    ['text', 'bg', 4.5], ['muted', 'bg', 4.5], ['muted', 'surface', 4.5], ['text', 'surface', 4.5], ['text', 'cream', 4.5], ['muted', 'sheet', 4.5], ['accent-strong', 'accent-soft', 4.5], ['on-ink', 'text', 4.5], ['on-ink-accent', 'text', 4.5], ['error-text', 'error-bg', 4.5],
    ['accent-text', 'accent', 4.5], ['accent', 'bg', 4.5], ['accent', 'accent-soft', 4.5], ['error', 'bg', 4.5],
    ['success', 'bg', 4.5], ['border', 'bg', 3], ['focus', 'bg', 3],
  ] as const)('NFR-USE-06 --tb-%s on --tb-%s keeps at least %d:1 (AC-ALL-2)', (fg, bg, min) => {
    expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(min);
  });

  it('NFR-USE-06 the ink-navy, the text and the control border are the redesign v3 values', () => {
    expect([t.accent, t.text, t.muted, t.border, t.surface, t.line, t.error]).toEqual(['#0f1720', '#0f1720', '#5a6472', '#8590a0', '#f3f5f8', '#e2e6ec', '#b42318']);
  });

  it('SEC-GAM-03 the credential document repeats the same colours in its own stylesheet', () => {
    const s = tokens(read('secure/secure.css'));
    expect([s.bg, s.surface, s.cream, s.text, s.muted, s.border, s.line, s.accent, s.error, s.success])
      .toEqual([t.bg, t.surface, t.cream, t.text, t.muted, t.border, t.line, t.accent, t.error, t.success]);
  });
});

describe('the fonts', () => {
  const faces = (path: string) => [...readFileSync(require.resolve(path), 'utf8').matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]);

  it.each([
    '@fontsource-variable/figtree/wght.css', '@fontsource-variable/gabarito/wght.css', '@fontsource/hind-siliguri/bengali-400.css', '@fontsource/hind-siliguri/bengali-500.css',
    '@fontsource/hind-siliguri/bengali-600.css', '@fontsource/hind-siliguri/bengali-700.css',
  ])('NFR-PERF-07 %s swaps in after first paint and is served from the site (AC-ALL-3, AC-ALL-4)', (path) => {
    const all = faces(path);
    expect(all.length).toBeGreaterThan(0);
    for (const f of all) {
      expect(f).toMatch(/font-display:\s*swap/);
      for (const url of f.matchAll(/url\(([^)]+)\)/g)) expect(url[1]).not.toMatch(/^['"]?(https?:)?\/\//);
    }
  });

  it('NFR-USE-04 Bangla numbers are drawn by the figures face, first in the Bangla stack: the digits, the taka sign and the separators (AC-TYPE-1)', async () => {
    const { FIGURES_FONT, FIGURES_RANGE, MARKS_RANGE } = await import('./language/font');
    expect(read('shared/tokens.css')).toMatch(new RegExp(`:root:lang\\(bn\\) \\{\\s*--tb-font: '${FIGURES_FONT}', 'Hind Siliguri'`));
    expect(read('secure/secure.css')).toMatch(new RegExp(`:root:lang\\(bn\\) \\{ --font: '${FIGURES_FONT}', 'Hind Siliguri'`));
    // in English, after Figtree, which has no taka sign
    expect(read('shared/tokens.css')).toContain(`--tb-font: 'Figtree Variable', '${FIGURES_FONT}', 'Hind Siliguri'`);
    expect(FIGURES_RANGE).toBe('U+09E6-09EF, U+09F3');               // ০ to ৯ and ৳
    expect(MARKS_RANGE).toBe('U+002C, U+002E, U+003A');              // , . :
    for (const w of [400, 500, 600, 700]) {
      for (const part of ['digits', 'marks']) {
        const size = readFileSync(join(SRC, `shared/language/figures/figures-${part}-${w}.woff2`)).length;
        expect(size, `${part} ${w}`).toBeLessThan(4096);              // a cut of a few glyphs, not the whole face
      }
    }
  });

  it('NFR-PERF-07 the stylesheets import fonts only from the site\'s own packages', () => {
    for (const css of [read('shared/kit.css'), read('secure/secure.css')]) {
      for (const m of css.matchAll(/@import\s+['"]([^'"]+)['"]/g)) expect(m[1]).not.toMatch(/^(https?:)?\/\//);
    }
  });

  it('NFR-PERF-07 the React documents get their fonts from font.ts after the load event, not from a stylesheet (AC-ALL-4)', async () => {
    expect(read('shared/kit.css')).not.toMatch(/@fontsource|@font-face/);
    const added: FontFace[] = [];
    const fonts = { add: (f: FontFace) => added.push(f) } as unknown as FontFaceSet;
    const listeners: (() => void)[] = [];
    const win = { document: { readyState: 'loading' }, addEventListener: (_: string, l: () => void) => listeners.push(l), setTimeout: (f: () => void) => f() } as unknown as Window;
    class StandInFace { constructor(public family: string, public source: string, public d: FontFaceDescriptors) {} load() { return Promise.resolve(this); } }
    vi.stubGlobal('FontFace', StandInFace);
    try {
      const { afterLoad } = await import('./language/font');
      let ran = false;
      afterLoad(() => { ran = true; fonts.add(new FontFace('x', 'url(/x.woff2)', { display: 'swap' })); }, win);
      expect(ran).toBe(false);                       // nothing before the load event
      listeners.forEach((l) => l());
      expect(ran).toBe(true);
      expect((added[0] as unknown as StandInFace).d.display).toBe('swap');
    } finally {
      vi.unstubAllGlobals();
    }
    expect(read('shared/language/font.ts').match(/display: 'swap'/g)).toHaveLength(1);
  });
});

describe('the catalogues', () => {
  const dir = join(SRC, 'messages');
  const files = readdirSync(join(dir, 'en')).filter((f) => f.endsWith('.json'));

  it('NFR-USE-04 every English catalogue has a Bangla twin (AC-ALL-6)', () => {
    expect(readdirSync(join(dir, 'bn')).filter((f) => f.endsWith('.json')).sort()).toEqual([...files].sort());
  });

  it.each(files)('NFR-USE-04 %s: both languages have the same keys and placeholders (AC-ALL-6)', (file) => {
    const en = JSON.parse(readFileSync(join(dir, 'en', file), 'utf8')) as Record<string, string>;
    const bn = JSON.parse(readFileSync(join(dir, 'bn', file), 'utf8')) as Record<string, string>;
    expect(Object.keys(bn).sort()).toEqual(Object.keys(en).sort());
    for (const k of Object.keys(en)) expect(placeholders(bn[k]), `${file} ${k}`).toEqual(placeholders(en[k]));
  });
});
