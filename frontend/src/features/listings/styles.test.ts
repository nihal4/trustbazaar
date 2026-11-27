// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// NFR-MNT-07: every style class the listing, auction and room components use is defined in listings.module.css. (A cleanup of unused rules once
// removed a live one along with a dead one, and the seller's rating star lost its gold; tests do not parse CSS, so this one does.)
describe('the listing stylesheet', () => {
  it('NFR-MNT-07 defines every class the listing, auction and room components use', () => {
    const css = readFileSync(new URL('./listings.module.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const defined = new Set([...css.matchAll(/\.([a-zA-Z][\w]*)/g)].map((m) => m[1]));
    const files = ['ListingPage.tsx', 'AuctionPanel.tsx', 'AuctionRoom.tsx', 'Countdown.tsx', 'TitleParts.tsx'];
    const used = new Set(
      files.flatMap((f) => [...readFileSync(new URL(`./${f}`, import.meta.url), 'utf8').matchAll(/styles\.([a-zA-Z]\w*)/g)].map((m) => m[1])),
    );
    expect([...used].filter((c) => !defined.has(c))).toEqual([]);
  });
});
