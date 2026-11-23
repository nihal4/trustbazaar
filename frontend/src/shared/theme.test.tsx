// @vitest-environment jsdom
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { cleanup, render } from '@testing-library/react';
import { Button, MantineProvider } from '@mantine/core';
import { MANTINE_PROVIDER_PROPS, theme } from './theme';

// The theme's CSS is static (docs/design/10_visual.md, section 6; Decisions log, U10-01): Mantine would otherwise
// add <style> elements at run time, which the pages' style-src 'self' and Trusted Types refuse.
// `npm run mantine:css` rewrites mantine-theme.css after a change to theme.ts.
const FILE = resolve(__dirname, 'mantine-theme.css');
const HEADER = '/* Generated from theme.ts by `npm run mantine:css` (theme.test.tsx). Do not edit. */\n';

/** The CSS Mantine would inject for this theme: its variables and its global classes. */
function generated(): string {
  const html = renderToStaticMarkup(<MantineProvider theme={theme} forceColorScheme="light" deduplicateCssVariables={false}><span /></MantineProvider>);
  const blocks = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1].replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&'));
  return HEADER + blocks.map((b) => b.replace(/}/g, '}\n')).join('\n');
}

afterEach(cleanup);

describe('Mantine theme', () => {
  it('SEC-WEB-01 the theme CSS shipped as a static file is the CSS Mantine would add at run time', () => {
    const css = generated();
    if (process.env.UPDATE_MANTINE_CSS) writeFileSync(FILE, css);
    expect(css).toContain('--mantine-color-plum-7: #4B2378');
    expect(readFileSync(FILE, 'utf8')).toBe(css);
  });

  it('SEC-WEB-01 the provider adds no <style> element to the page', () => {
    const { container } = render(<MantineProvider {...MANTINE_PROVIDER_PROPS}><Button>Sell an item</Button></MantineProvider>);
    expect(document.querySelectorAll('style')).toHaveLength(0);
    expect(container.querySelector('button')).not.toBeNull();
  });

  it('NFR-USE-06 the main colour, text and control borders keep their contrast on white', () => {
    const lum = (hex: string) => {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    const c = theme.colors!;
    expect(ratio(c.plum![7], '#FFFFFF')).toBeGreaterThanOrEqual(4.5);   // white text on buttons, plum links
    expect(ratio(c.gray![7], '#FFFFFF')).toBeGreaterThanOrEqual(4.5);   // muted text
    expect(ratio(c.gray![6], '#FFFFFF')).toBeGreaterThanOrEqual(4.5);   // placeholders
    expect(ratio(c.gray![7], c.gray![1])).toBeGreaterThanOrEqual(4.5);  // muted text on mist
    expect(ratio(c.red![6], '#FFFFFF')).toBeGreaterThanOrEqual(4.5);    // errors
    expect(ratio(c.gray![5], '#FFFFFF')).toBeGreaterThanOrEqual(3);     // input, checkbox and radio borders
  });
});
