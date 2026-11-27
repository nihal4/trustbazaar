// NFR-PERF-07 (U8-11; section 8): Lighthouse's mobile profile (simulated 4G and a slowed processor) on the home,
// listing and checkout pages of the production build; each must reach Largest Contentful Paint within 2.5 seconds.
// The checkout is measured signed in, with the buyer's cookies from the end-to-end setup.
//
//   node e2e/lighthouse.mjs        (E2E_BASE_URL, default http://localhost:8080; run after `npm run e2e`)
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import lighthouse from 'lighthouse';
import * as chromeLauncher from 'chrome-launcher';

const here = dirname(fileURLToPath(import.meta.url));
const base = process.env.E2E_BASE_URL ?? 'http://localhost:8080';
const fx = JSON.parse(readFileSync(process.env.E2E_FIXTURES ?? join(here, '.fixtures.json'), 'utf8'));
const buyer = JSON.parse(readFileSync(join(here, '.states', 'buyer.json'), 'utf8'));
const cookie = buyer.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
const LIMIT = 2500;
const pages = [
  ['home', '/', null],
  ['listing', `/listings/${fx.listingId}`, null],
  ['checkout', `/checkout/${fx.listingId}`, cookie],
];

const chrome = await chromeLauncher.launch({ chromePath: chromium.executablePath(), chromeFlags: ['--headless=new', '--no-sandbox'] });
let failed = 0;
try {
  for (const [name, path, cookies] of pages) {
    const r = await lighthouse(`${base}${path}`, {
      port: chrome.port,
      onlyCategories: ['performance'],
      output: 'json',
      logLevel: 'error',
      ...(cookies ? { extraHeaders: { Cookie: cookies } } : {}),
    });
    const lcp = r.lhr.audits['largest-contentful-paint'].numericValue;
    const ok = lcp <= LIMIT;
    if (!ok) failed++;
    console.log(
      `${ok ? 'PASS' : 'FAIL'}  ${name}: LCP ${Math.round(lcp)} ms (limit ${LIMIT}), performance score ${Math.round(r.lhr.categories.performance.score * 100)}`,
    );
  }
} finally {
  await chrome.kill();
}
process.exit(failed ? 1 : 0);
