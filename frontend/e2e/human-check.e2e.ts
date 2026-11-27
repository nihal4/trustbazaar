// The human check against the real backend (SEC-ABU-02; I-64): after three recent failures on a login, Unit 1 asks
// for the proof-of-work on every further attempt. The page answers it by itself, so the person sees only the usual
// "not correct" message, and the right password then signs in, all under the pages' real security policy.
import { expect, test } from '@playwright/test';
import { fixtures } from './fixtures';

const f = fixtures();

test('SEC-ABU-02 I-64 a login asked for the human check: the page solves it, without a policy violation', async ({ page }) => {
  const proofs: string[] = [];
  const statuses: number[] = [];
  const violations: string[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/api/v1/auth/signin') && r.headers()['x-human-proof']) proofs.push(r.headers()['x-human-proof']);
  });
  page.on('response', (r) => {
    if (r.url().endsWith('/api/v1/auth/signin')) statuses.push(r.status());
  });
  page.on('console', (m) => {
    if (m.type() === 'error' && /Content Security Policy|Trusted Type/i.test(m.text())) violations.push(m.text());
  });

  await page.goto('/signin');
  await page.getByLabel('Mobile number or e-mail').fill(f.seller.local);
  await page.getByRole('button', { name: 'Continue' }).click();
  for (let i = 0; i < 4; i++) {
    await page.getByLabel('Password', { exact: true }).fill(`not the password ${i}`);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toHaveText('The number, e-mail or password is not correct.');
    await expect.poll(() => statuses.filter((s) => s !== 428).length).toBe(i + 1);
  }
  expect(statuses).toContain(428); // the server did ask
  expect(proofs.length).toBeGreaterThan(0); // and the page answered

  await page.getByLabel('Password', { exact: true }).fill(f.seller.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/signin/);
  expect(statuses.at(-1)).toBeLessThan(300);
  expect(violations).toEqual([]);
});
