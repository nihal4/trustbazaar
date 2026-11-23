// Every route, as each kind of visitor reaches it (U8-11; docs/design/08_frontend.pdf sections 7 and 12): no sideways scroll
// at 360 by 740 and at 320 (NFR-USE-05 and the WCAG reflow width), no axe-core issue rated serious or critical
// (NFR-USE-06), and no Content Security Policy or Trusted Types violation (SEC-WEB-01). Plus the first-load
// JavaScript budget DV-53 on the home, listing and checkout pages (NFR-PERF-07). For the redesign (U10-10;
// docs/design/10_visual.md, section 8): every route again in Bangla at 320, and no request to another origin, fonts
// included (AC-ALL-1, AC-ALL-3).
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { fixtures, STATES } from './fixtures';

const f = fixtures();
type Role = 'guest' | 'buyer' | 'operator' | 'administrator';
const ROUTES: Record<Role, string[]> = {
  guest: ['/', '/search', '/search?q=Samsung', `/listings/${f.listingId}`, '/signin', '/register', '/reset', '/help/terms', '/help/privacy', '/no-such-page', '/staff/signin'],
  buyer: [
    '/account', '/account/security', '/account/privacy', '/account/payout', '/account/kyc', '/orders', `/orders/${f.orderId}`, `/checkout/${f.listingId}`,
    '/messages', '/notifications', '/seller', '/sell/new', `/secure/orders/${f.orderId}/key`,
  ],
  operator: [
    '/staff/queues/disputes', '/staff/queues/reports', '/staff/queues/flagged_activity', '/staff/queues/kyc', '/staff/queues/listings_review',
    '/staff/queues/ownership_proofs', '/staff/queues/payout_accounts', '/staff/queues/payment_discrepancies', '/staff/approvals', '/staff/terms',
  ],
  administrator: ['/staff', '/admin', '/staff/approvals', '/admin/config', '/admin/staff', '/admin/reference', '/admin/audit'],
};
const WIDTHS = [{ width: 360, height: 740, lang: 'en' }, { width: 320, height: 640, lang: 'en' }, { width: 320, height: 640, lang: 'bn' }] as const;

/** Collects the page's policy violations: the browser's events and its console reports; and any request that leaves
 *  the site (AC-ALL-3). */
async function watchPolicies(page: Page): Promise<string[]> {
  const seen: string[] = [];
  const site = new URL(f.web ?? 'http://localhost:8080').origin;
  page.on('request', (r) => { const u = new URL(r.url()); if (/^https?:$/.test(u.protocol) && u.origin !== site) seen.push(`request to ${u.origin}`); });
  page.on('console', (m) => { if (m.type() === 'error' && /Content Security Policy|Trusted Type/i.test(m.text())) seen.push(m.text()); });
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      (window as unknown as { __tbViolations: string[] }).__tbViolations ??= [];
      (window as unknown as { __tbViolations: string[] }).__tbViolations.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  return seen;
}
async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.locator('h1').first().waitFor({ state: 'visible' });
  await expect(page.getByRole('status').filter({ hasText: /^Loading/ })).toHaveCount(0);
}
async function sideways(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth <= w) return [];
    return Array.from(document.querySelectorAll('body *'))
      .filter((el) => el.getBoundingClientRect().right > w + 1)
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}.${(el as HTMLElement).className} right=${Math.round(el.getBoundingClientRect().right)}`);
  });
}

for (const role of Object.keys(ROUTES) as Role[]) {
  test.describe(`as ${role}`, () => {
    if (role !== 'guest') test.use({ storageState: join(STATES, `${role}.json`) });
    for (const path of ROUTES[role]) {
      test(`NFR-USE-05 NFR-USE-06 SEC-WEB-01 ${path}: no sideways scroll at 360 and 320 (also in Bangla), no serious accessibility issue, no policy violation`, async ({ page }) => {
        const console = await watchPolicies(page);
        for (const size of WIDTHS) {
          await page.setViewportSize({ width: size.width, height: size.height });
          await page.evaluate((l) => { try { localStorage.setItem('tb-lang', l); } catch { /* a page without storage stays in English */ } }, size.lang).catch(() => {});
          await page.goto(path);
          await settle(page);
          // the credential page takes its language from the account's preference, not from this device
          if (!path.startsWith('/secure/')) expect(await page.locator('html').getAttribute('lang')).toBe(size.lang);
          expect(await sideways(page), `sideways scroll at ${size.width} (${size.lang})`).toEqual([]);
          if (size.width === 360 && size.lang === 'en') {
            const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
            const serious = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
              .map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
            expect(serious, 'axe-core serious or critical issues').toEqual([]);
          }
          const events = await page.evaluate(() => (window as unknown as { __tbViolations?: string[] }).__tbViolations ?? []);
          expect([...events, ...console], 'policy violations').toEqual([]);
        }
      });
    }
  });
}

test.describe('first load', () => {
  test.use({ storageState: join(STATES, 'buyer.json') });
  for (const path of ['/', `/listings/${f.listingId}`, `/checkout/${f.listingId}`]) {
    test(`NFR-PERF-07 DV-53 ${path}: at most 170 KB of compressed JavaScript on the first load`, async ({ page }) => {
      const scripts = new Map<string, number>();
      page.on('response', async (r) => {
        if (r.request().resourceType() !== 'script' || !r.ok()) return;
        try { scripts.set(r.url(), gzipSync(await r.body()).length); } catch { /* a navigation may cancel it */ }
      });
      await page.setViewportSize({ width: 360, height: 740 });
      await page.goto(path);
      await settle(page);
      const total = [...scripts.values()].reduce((a, b) => a + b, 0);
      expect(total, `first-load JavaScript (gzip) ${Math.round(total / 1024)} KB over ${scripts.size} files`).toBeLessThanOrEqual(170 * 1024);
    });
  }
});
