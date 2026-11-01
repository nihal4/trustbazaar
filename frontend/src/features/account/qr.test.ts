import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { qrPath } from './QrCode';
import { groupSecret } from './MfaSettings';

const URI = 'otpauth://totp/TrustBazaar:rahim%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=TrustBazaar';

describe('the enrolment QR code', () => {
  it('FR-ACC-06 it is a square with the quiet zone and the finder patterns in three corners', () => {
    const { size, d } = qrPath(URI);
    const dark = new Set([...d.matchAll(/M(\d+) (\d+)/g)].map((m) => `${m[1]},${m[2]}`));
    const n = size - 8;                       // modules without the 4-module quiet zone on each side
    expect(n % 4).toBe(1);                    // QR sizes are 17 + 4 x version
    expect(n).toBeGreaterThanOrEqual(21);
    for (const [r, c] of [[4, 4], [4, 4 + n - 7], [4 + n - 7, 4]]) {
      for (let i = 0; i < 7; i++) {
        expect(dark.has(`${c + i},${r}`)).toBe(true);           // top edge of each finder pattern
        expect(dark.has(`${c},${r + i}`)).toBe(true);           // left edge
      }
    }
    for (let i = 0; i < size; i++) expect(dark.has(`${i},0`) || dark.has(`0,${i}`)).toBe(false);   // quiet zone
  });

  it('FR-ACC-06 the key is shown in groups of four', () => {
    expect(groupSecret('JBSWY3DPEHPK3PXP')).toBe('JBSW Y3DP EHPK 3PXP');
    expect(groupSecret('ABCDE')).toBe('ABCD E');
  });
});

describe('where the QR library may be used', () => {
  it('DV-53 only the lazily loaded QR module imports qrcode-generator, so it stays out of the first load', () => {
    const src = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx|js)$/.test(f)) files.push(p);
      }
    };
    walk(src);
    const importers = files.filter((f) => /from ['"]qrcode-generator['"]|import\(['"]qrcode-generator['"]\)/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(src, f));
    expect(importers).toEqual(['features/account/QrCode.tsx']);
    const mfa = readFileSync(join(src, 'features/account/MfaSettings.tsx'), 'utf8');
    expect(mfa).toMatch(/lazy\(\(\) => import\('\.\/QrCode'\)\)/);
    expect(mfa).not.toMatch(/^import .* from '\.\/QrCode'/m);
  });
});
