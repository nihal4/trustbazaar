// The accounts and ids the backend stack wrote (backend/test/e2e/stack.ts), and signing in as each of them.
import { createHmac } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { APIRequestContext, Page } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));

export interface Fixtures {
  web: string;
  buyer: { local: string; password: string; userId: string };
  seller: { local: string; password: string; userId: string };
  bidder: { local: string; password: string; userId: string };
  operator: { email: string; password: string; totpSecret: string };
  operator2: { email: string; password: string; totpSecret: string };
  administrator: { email: string; password: string; totpSecret: string };
  listingId: string;
  orderId: string;
  auctionId: string;
  disputeListingId: string;
  gameListingId: string;
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
  await page.getByRole('button', { name: 'Continue' }).click(); // the password is asked after the number or e-mail (U10-25)
  await page.getByLabel('Password', { exact: true }).fill(who.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/signin'));
}

export async function signInStaff(page: Page, who: { email: string; password: string; totpSecret: string }) {
  await page.goto('/staff/signin');
  await page.getByLabel('Work e-mail').fill(who.email);
  await page.getByLabel('Password').fill(who.password);
  await page.getByRole('button', { name: 'Continue' }).click();
  // a code works once: if this window's code was used by an earlier sign-in, wait for the next one
  for (let attempt = 0; ; attempt++) {
    await page.getByLabel('Authenticator code').fill(totp(who.totpSecret));
    await page.getByRole('button', { name: 'Sign in' }).click();
    const left = await Promise.race([
      page.waitForURL((u) => !u.pathname.startsWith('/staff/signin')).then(() => true),
      page
        .getByRole('alert')
        .waitFor()
        .then(() => false),
    ]);
    if (left) return;
    if (attempt === 1) throw new Error('the staff sign-in refused two authenticator codes');
    await page.waitForTimeout(30_000 - (Date.now() % 30_000) + 500);
  }
}

/** The first match of `pattern` in the newest simulated SMS or e-mail (EMAIL_MODE and SMS_MODE log) to `to`, read as staff. */
export async function sentTo(request: APIRequestContext, to: string, pattern: RegExp): Promise<string> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const res = await request.get(`/api/v1/staff/dev-mailbox?to=${encodeURIComponent(to)}`);
    if (!res.ok()) throw new Error(`dev mailbox: ${res.status()}`);
    const { items } = (await res.json()) as { items: { text: string }[] };
    for (const m of items) {
      const match = pattern.exec(m.text);
      if (match) return match[1] ?? match[0];
    }
    if (Date.now() > deadline) throw new Error(`nothing matching ${pattern} was sent to ${to}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

export const codeSentTo = (request: APIRequestContext, to: string) => sentTo(request, to, /\b(\d{6})\b/);

/** A photo-like PNG (a gradient, so it is not a blank image), `n` changing its colours. */
export function photo(n: number, width = 800, height = 600): { name: string; mimeType: string; buffer: Buffer } {
  return { name: `photo-${n}.png`, mimeType: 'image/png', buffer: png(width, height, n) };
}

function png(w: number, h: number, n: number): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = ((x * 255) / w + n * 60) & 255;
      raw[o + 1] = ((y * 255) / h) & 255;
      raw[o + 2] = ((x + y) * 3 + n * 90) & 255;
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function crc32(b: Buffer): number {
  let c = ~0;
  for (const byte of b) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
