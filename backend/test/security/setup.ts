import { randomInt, randomUUID } from 'crypto';
import type { Type } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const sharp = require('sharp') as typeof import('sharp').default;
import { authenticator } from 'otplib';
import { loadConfig, type TbConfig } from '../../src/kernel/config/config';
import { NOTIFICATIONS, ForwardedNotifications } from '../../src/modules/identity/adapters/notifications';
import { startApp, TestApp } from '../support/app';
import { Browser } from '../support/browser';
import { IdentityFixtures } from '../support/identity';

// The security test suite (U9-02; docs/design/09_integration.pdf section 7.4): one file per security requirement
// marked T, named after it, against the whole backend over HTTP with PostgreSQL and Redis, as the API tests run.
// Each file calls suite() once at its top level; the helpers below are what most of them need.

export interface Suite {
  t: TestApp;
  fx: IdentityFixtures;
  cfg: TbConfig;
  origin: string;
  /** A browser with its own client address (support/browser.ts); it answers the human check by itself. */
  browser: () => Browser;
  /** Messages the backend sent (log mode), to one address, optionally of one template. */
  sent: (to: string, template?: string) => { channel: string; to: string; template: string; vars: Record<string, string> }[];
  /** A member signed in through the real sign-in, and their browser. */
  signedIn: (o?: Parameters<IdentityFixtures['account']>[0]) => Promise<{ a: Awaited<ReturnType<IdentityFixtures['account']>>; b: Browser }>;
  /** A staff member signed in with password and TOTP through the real staff sign-in, and their browser. */
  signedInStaff: (role: 'operator' | 'administrator') => Promise<{ s: Awaited<ReturnType<IdentityFixtures['staffAccount']>>; b: Browser }>;
}

/** `routes`: test-only controllers added to the file's backend (one backend per file, see SEC-INF-05). */
export function suite(routes: Type<unknown>[] = []): Suite {
  const s = {} as Suite;
  beforeAll(async () => {
    s.t = await startApp(routes);
    s.fx = await IdentityFixtures.open();
    s.cfg = loadConfig(process.env);
    s.origin = s.cfg.publicOrigin;
    const notes = s.t.app.get<ForwardedNotifications>(NOTIFICATIONS);
    s.sent = (to, template) =>
      notes.sent.filter((m) => m.to.toLowerCase() === to.toLowerCase() && (template === undefined || m.template === template)) as ReturnType<Suite['sent']>;
  });
  afterAll(async () => {
    await s.fx?.close();
    await s.t?.close();
  });
  s.browser = () => new Browser(s.t, s.origin);
  s.signedIn = async (o) => {
    const a = await s.fx.account({ password: `pw ${randomUUID()}`, ...o });
    const b = s.browser();
    const r = await b.post('/auth/signin', { login: a.phone, password: a.password });
    if (r.status === 200) expect((await b.post('/auth/signin/mfa', { code: authenticator.generate(a.totpSecret!) })).status).toBe(204);
    else expect(r.status).toBe(204);
    return { a, b };
  };
  s.signedInStaff = async (role) => {
    const st = await s.fx.staffAccount(role);
    const b = new Browser(s.t, s.origin, '__Host-tb_scsrf');
    expect((await b.post('/staff/auth/signin', { email: st.email, password: st.password })).status).toBe(200);
    expect((await b.post('/staff/auth/mfa', { code: authenticator.generate(st.totpSecret!) })).status).toBe(204);
    return { s: st, b };
  };
  return s;
}

/** The problem document of a response: status, type, title and field errors. */
export async function problem(r: Response): Promise<{ status: number; type?: string; title?: string; errors?: { field: string; reason: string }[] }> {
  const b = (await r.json().catch(() => ({}))) as { type?: string; title?: string; errors?: { field: string; reason: string }[] };
  return { status: r.status, type: b.type, title: b.title, errors: b.errors };
}

/** A local mobile number no account has. */
export const newLocal = () => `019${String(randomInt(0, 1e8)).padStart(8, '0')}`;

let shade = 0;
/** A plain test image (each a slightly different colour), JPEG or PNG. */
export const image = (fmt: 'jpeg' | 'png' = 'jpeg', width = 640, height = 400) =>
  sharp({ create: { width, height, channels: 3, background: { r: (shade += 7) % 255, g: 90, b: 160 } } })[fmt]().toBuffer();

/** A KYC submission (NID, both sides and two selfies) through the API; returns its id. */
export async function submitKyc(b: Browser, d: { docNumber?: string; fullName?: string } = {}): Promise<{ id: string; docNumber: string }> {
  const challenge = (await (await b.get('/kyc/liveness-challenge')).json()) as { challengeId: string };
  const docNumber = d.docNumber ?? String(randomInt(1e9, 1e10));
  const form = new FormData();
  form.set('docType', 'nid');
  form.set('docNumber', docNumber);
  form.set('fullName', d.fullName ?? `Test Person ${randomUUID().slice(0, 8)}`);
  form.set('dateOfBirth', '1995-04-12');
  form.set('challengeId', challenge.challengeId);
  for (const kind of ['doc_front', 'doc_back', 'selfie_neutral', 'selfie_action']) {
    form.set(kind, new Blob([new Uint8Array(await image())], { type: 'image/jpeg' }), `${kind}.jpg`);
  }
  const r = await b.upload('/kyc/submissions', form);
  if (r.status !== 202) throw new Error(`KYC submission refused: ${r.status} ${await r.text()}`);
  return { id: ((await r.json()) as { submissionId: string }).submissionId, docNumber };
}

/** A physical fixed-price draft listing of the member's, through the API, in a category of its own; returns its id. */
export async function draftListing(s: Suite, b: Browser, o: Record<string, unknown> = {}): Promise<string> {
  const [{ id: categoryId }] = await s.fx.query<{ id: number }>(
    `INSERT INTO listings.categories (slug, name_en, name_bn, item_kind) VALUES ($1, 'Test goods', 'পরীক্ষা', 'physical') RETURNING id`, [`sec-${randomUUID().slice(0, 8)}`]);
  const r = await b.post('/listings', {
    itemKind: 'physical', saleFormat: 'fixed_price', categoryId, title: 'A used desk lamp',
    description: 'A used desk lamp in good condition, written by the security tests.', condition: 'used', noVisibleDefects: true,
    fulfilmentOptions: 'pickup_only', weightClass: 'up_to_1kg', sizeClass: 'small', price: '150000', quantity: 1,
    area: { district: 'Dhaka', lat: 23.81049, lng: 90.41234 }, ...o,
  });
  if (r.status !== 201) throw new Error(`draft refused: ${r.status} ${await r.text()}`);
  return ((await r.json()) as { id: string }).id;
}

/** An active pickup listing at `price` poisha and the buyer's order awaiting payment, made through the API. */
export async function pendingOrder(s: Suite, price = 1_500_000): Promise<{ buyer: Awaited<ReturnType<Suite['signedIn']>>; sellerId: string; orderId: string; total: string }> {
  const sellerId = await s.fx.user({ kyc: 'verified' });
  const [{ id: categoryId }] = await s.fx.query<{ id: number }>(
    `INSERT INTO listings.categories (slug, name_en, name_bn, item_kind) VALUES ($1, 'Phones', 'ফোন', 'physical') RETURNING id`, [`pay-${randomUUID().slice(0, 8)}`]);
  const [{ id: listingId }] = await s.fx.query<{ id: string }>(
    `INSERT INTO listings.listings (seller_id, item_kind, sale_format, category_id, title, description, condition, no_visible_defects,
        fulfilment_options, area_district, approx_lat, approx_lng, price, quantity_total, quantity_available)
     VALUES ($1, 'physical', 'fixed_price', $2, 'Phone for the payment checks', 'A phone in good condition, written by the security tests.', 'used', true,
        'pickup_only', 'Dhaka', 23.81, 90.41, $3, 1, 1) RETURNING id`, [sellerId, categoryId, price]);
  for (const n of [1, 2]) await s.fx.query(`INSERT INTO listings.listing_photos (listing_id, position, storage_key, width, height) VALUES ($1, $2, $3, 1, 1)`, [listingId, n, randomUUID().replace(/-/g, '')]);
  await s.fx.query(`UPDATE listings.listings SET status = 'active', published_at = now() WHERE id = $1`, [listingId]);
  const buyer = await s.signedIn({ kyc: 'verified' });
  const r = await buyer.b.post('/orders', { listingId, quantity: 1, fulfilment: 'self_pickup' });
  if (r.status !== 201) throw new Error(`order refused: ${r.status} ${await r.text()}`);
  const o = (await r.json()) as { id: string; total: string };
  return { buyer, sellerId, orderId: o.id, total: o.total };
}

/** On the mock provider's page: choose the outcome; returns the callback the provider sends the browser to. */
export async function decideOnMockPage(s: Suite, redirectUrl: string, outcome: 'succeeded' | 'failed' = 'succeeded'): Promise<URL> {
  const page = new URL(redirectUrl);
  const form = await fetch(s.t.url(page.pathname.replace('/api/v1', '') + page.search), {
    method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `outcome=${outcome}`,
  });
  if (form.status !== 303) throw new Error(`mock page: ${form.status}`);
  return new URL(form.headers.get('location')!);
}
