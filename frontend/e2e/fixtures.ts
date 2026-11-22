// The accounts and ids the backend stack wrote (backend/test/e2e/stack.ts), and signing in as each of them.
import { createHmac } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));

export interface Fixtures {
  web: string;
  buyer: { local: string; password: string; userId: string };
  seller: { local: string; password: string; userId: string };
  operator: { email: string; password: string; totpSecret: string };
  administrator: { email: string; password: string; totpSecret: string };
  listingId: string;
  orderId: string;
}
export const FIXTURES = process.env.E2E_FIXTURES ?? join(here, '.fixtures.json');
export const STATES = join(here, '.states');
export const fixtures = (): Fixtures => {
  if (!existsSync(FIXTURES)) throw new Error(`no fixtures at ${FIXTURES}: start the backend stack (backend/test/e2e/stack.ts)`);
  return JSON.parse(readFileSync(FIXTURES, 'utf8')) as Fixtures;
};

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 seconds), as authenticator apps compute it. */
export function totp(secret: string, at = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secret.replace(/=+$/, '').toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const h = createHmac('sha1', key).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

export async function signInMember(page: Page, who: { local: string; password: string }) {
  await page.goto('/signin');
  await page.getByLabel('Mobile number or e-mail').fill(who.local);
  await page.getByLabel('Password', { exact: true }).fill(who.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/signin'));
}

export async function signInStaff(page: Page, who: { email: string; password: string; totpSecret: string }) {
  await page.goto('/staff/signin');
  await page.getByLabel('Work e-mail').fill(who.email);
  await page.getByLabel('Password').fill(who.password);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Authenticator code').fill(totp(who.totpSecret));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/staff/signin'));
}
