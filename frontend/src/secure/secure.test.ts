// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { configure, fireEvent, screen, waitFor, within } from '@testing-library/dom';
import { placeholders } from '../lib/i18n.js';
import { fingerprint, generateBuyerKey, open as openSealed, seal } from '../lib/sealed.js';
import en from '../messages/en/secure.json';
import bn from '../messages/bn/secure.json';
import { b64u, unb64u } from './dom';
import type { GameView, KeyStore } from './context';
import { start } from './main';

// The credential document, secure.html (section 3.1; Unit 5 sections 4 to 6; SEC-GAM-01, SEC-GAM-03; U8-07): the
// buyer's key made and kept in this browser, the seller sealing for it after comparing the fingerprint, the buyer
// opening the details with the takeover checklist, the report and the one re-key. Real HPKE through sealed.js; the
// key store is in memory instead of IndexedDB.

// Under jsdom on Node 20 the typed arrays sealed.js and @hpke/core make can belong to jsdom's realm, and Node 20's
// Web Crypto refuses them ("not instance of ArrayBuffer"); Node 22 and the browsers accept them. The test therefore
// hands Web Crypto copies in Node's realm: every byte argument, including those inside algorithm parameters (the
// HKDF salt and info, the AES-GCM nonce and additional data). Hoisted, so it is in place before sealed.js loads.
vi.hoisted(() => {
  const NodeBuffer = (globalThis as unknown as { Buffer: typeof import('node:buffer').Buffer }).Buffer; // Node's own global
  const bytes = (v: unknown): unknown => {
    if (ArrayBuffer.isView(v)) return NodeBuffer.from(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
    if (Object.prototype.toString.call(v) === '[object ArrayBuffer]') return NodeBuffer.from(new Uint8Array(v as ArrayBuffer));
    if (v && typeof v === 'object' && !('type' in v && 'algorithm' in v) && Object.getPrototypeOf(v) === Object.prototype) {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, bytes(x)]));
    }
    return v;
  };
  const subtle = globalThis.crypto.subtle;
  for (const name of ['importKey', 'encrypt', 'decrypt', 'digest', 'deriveBits', 'deriveKey', 'sign', 'verify'] as const) {
    const original = (subtle[name] as (...a: unknown[]) => Promise<unknown>).bind(subtle);
    Object.defineProperty(subtle, name, { configurable: true, value: (...args: unknown[]) => original(...args.map(bytes)) });
  }
});
configure({ asyncUtilTimeout: 3000 });
const ID = '7e1c2a3e-1111-4a5b-8c9d-0000000000aa';
const HOUR = 3_600_000;
const iso = (offset: number) => new Date(Date.now() + offset).toISOString();
const stops: (() => void)[] = [];
afterEach(() => {
  stops.splice(0).forEach((s) => s());
  document.body.replaceChildren();
});

interface Call {
  method: string;
  path: string;
  body: unknown;
}
type Answer = (c: Call) => Response | Promise<Response>;
const json = (status: number, body?: unknown) => () =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json' },
  });
const problem = (status: number, name: string, extra: Record<string, unknown> = {}) =>
  json(status, { type: `/problems/${name}`, title: name, status, ...extra });
function backend(answers: Record<string, Answer>) {
  const calls: Call[] = [];
  const all: Record<string, Answer> = { 'GET /me/notification-preferences': json(200, { language: 'en' }), ...answers };
  const fetch = async (url: string | URL | Request, init: RequestInit = {}) => {
    const u = new URL(String(url), 'https://tb.test');
    const call = {
      method: (init.method ?? 'GET').toUpperCase(),
      path: u.pathname.replace(/^\/api\/v1/, ''),
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const a = all[`${call.method} ${call.path}`];
    return a ? a(call) : new Response(null, { status: 404 });
  };
  return { fetch: fetch as typeof globalThis.fetch, called: (k: string) => calls.filter((c) => `${c.method} ${c.path}` === k) };
}
function memoryKeys(): KeyStore & { map: Map<string, CryptoKeyPair> } {
  const map = new Map<string, CryptoKeyPair>();
  return {
    map,
    store: async (o, v, p) => {
      map.set(`${o}:${v}`, p);
    },
    load: async (o, v) => map.get(`${o}:${v}`) ?? null,
  };
}
async function open(path: string, be: ReturnType<typeof backend>, keys: KeyStore = memoryKeys()) {
  const root = document.createElement('div');
  document.body.append(root);
  const assigned: string[] = [];
  stops.push(await start(root, { fetch: be.fetch, keys, strict: true, location: { pathname: path, assign: (u) => assigned.push(u) } }));
  return { root, assigned };
}
const game = (g: Partial<GameView> = {}): GameView => ({
  orderId: ID,
  role: 'buyer',
  disclosure: { currentVersion: 1, acknowledgedVersion: 1, acknowledgedAt: iso(-HOUR) },
  status: 'preparing',
  keyVersion: 0,
  rekeysUsed: 0,
  credentialsDueAt: null,
  deliveredAt: null,
  takeoverDueAt: null,
  rekeyDueAt: null,
  takenOverAt: null,
  steps: { password: null, recovery_email: null, recovery_phone: null, social_logins: null, two_step: null },
  protectionEndsAt: null,
  ...g,
});
const G = `/orders/${ID}/game`;
/** A paragraph whose whole text matches, deadlines included (they are a span inside it). */
const para = (re: RegExp) => (_: string, el: Element | null) => el?.tagName === 'P' && re.test(el.textContent ?? '');

describe("the buyer's key", () => {
  it('FR-GAM-07 FR-GAM-08 SEC-GAM-01 the key pair is made here, kept in this browser, only the public point is sent, and the fingerprint is computed here', async () => {
    let current = game();
    const keys = memoryKeys();
    const be = backend({
      [`GET ${G}`]: () => json(200, current)(),
      [`POST ${G}/key`]: () => {
        current = game({ keyVersion: 1 });
        return json(201, { keyVersion: 1 })();
      },
    });
    await open(`/secure/orders/${ID}/key`, be, keys);
    expect(screen.getByText(/^Use this same browser on this device/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Create the key in this browser' }));
    expect(await screen.findByText('Your key is created. You can go back to the order and pay.')).toBeTruthy();
    const sent = be.called(`POST ${G}/key`)[0].body as { publicKey: string };
    expect(Object.keys(sent)).toEqual(['publicKey']);
    expect(sent.publicKey).toMatch(/^[A-Za-z0-9_-]{87}$/);
    const raw = unb64u(sent.publicKey);
    expect(raw.length).toBe(65);
    expect(raw[0]).toBe(4);
    const pair = keys.map.get(`${ID}:1`)!;
    expect(pair.privateKey.extractable).toBe(false);
    expect(screen.getByText(await fingerprint(raw)).textContent).toMatch(/^[0-9a-f]{4}(-[0-9a-f]{4}){4}$/);
    expect(screen.getByRole('link', { name: 'Back to the order' }).getAttribute('href')).toBe(`/orders/${ID}`);
  });

  it('FR-GAM-07 a key made in another browser is named as such; before the disclosure there is no key; a guest is sent to sign in', async () => {
    await open(`/secure/orders/${ID}/key`, backend({ [`GET ${G}`]: json(200, game({ keyVersion: 1 })) }));
    expect(screen.getByText(/^The key for this order was created in another browser\./)).toBeTruthy();
    document.body.replaceChildren();
    await open(
      `/secure/orders/${ID}/key`,
      backend({ [`GET ${G}`]: json(200, game({ disclosure: { currentVersion: 1, acknowledgedVersion: null, acknowledgedAt: null } })) }),
    );
    expect(screen.getByText(/^First confirm the notice/)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    document.body.replaceChildren();
    const { assigned } = await open(
      `/secure/orders/${ID}/key`,
      backend({ [`GET ${G}`]: json(401, {}), 'POST /auth/refresh': json(401, {}), 'GET /me': json(401, {}) }),
    );
    expect(assigned).toEqual([`/signin?next=${encodeURIComponent(`/secure/orders/${ID}/key`)}`]);
  });
});

describe('sealing and opening', () => {
  it("FR-GAM-08 FR-GAM-09 FR-GAM-11 FR-GAM-13 the seller sees the buyer's fingerprint and seals in the page; the buyer opens the same details beside the checklist", async () => {
    const buyer = await generateBuyerKey();
    // sealed.js itself first, so a failure of Web Crypto in this environment shows its own error
    const probe = await seal(unb64u(b64u(buyer.publicRaw)), ID, 1, { loginId: 'a', password: 'b', recovery: [], note: '' });
    expect(await openSealed(buyer.pair, ID, 1, probe.enc, probe.ciphertext)).toEqual({ loginId: 'a', password: 'b', recovery: [], note: '' });
    const keys = memoryKeys();
    await keys.store(ID, 1, buyer.pair);
    let sealed: { keyVersion: number; enc: string; ciphertext: string } | null = null;
    let current = game({ role: 'seller', status: 'awaiting_credentials', keyVersion: 1, credentialsDueAt: iso(5 * HOUR) });
    const seller = backend({
      [`GET ${G}`]: () => json(200, current)(),
      [`GET ${G}/buyer-key`]: json(200, { keyVersion: 1, publicKey: b64u(buyer.publicRaw) }),
      [`POST ${G}/sealed`]: (c) => {
        sealed = c.body as typeof sealed;
        current = game({ role: 'seller', status: 'delivered', keyVersion: 1, deliveredAt: iso(0), takeoverDueAt: iso(24 * HOUR) });
        return json(201, { deliveredAt: iso(0), takeoverDueAt: iso(24 * HOUR) })();
      },
    });
    await open(`/secure/orders/${ID}/deliver`, seller);
    expect(screen.getByText(await fingerprint(buyer.publicRaw))).toBeTruthy();
    expect(screen.getByText(para(/^Send them by .+\(in (5|4) h/))).toBeTruthy();
    const password = screen.getByLabelText('Password') as HTMLInputElement;
    for (const el of [screen.getByLabelText(/^Login/), password, screen.getByLabelText('Recovery or backup codes')]) {
      expect(el.getAttribute('autocomplete')).toBe('off');
      expect(el.getAttribute('spellcheck')).toBe('false');
    }
    fireEvent.click(screen.getByRole('button', { name: 'Lock and send' }));
    expect(screen.getByText('Enter the login and the password.')).toBeTruthy();
    fireEvent.input(screen.getByLabelText(/^Login/), { target: { value: 'x' } });
    fireEvent.input(password, { target: { value: 'p' } });
    fireEvent.input(screen.getByLabelText('A note for the buyer'), { target: { value: 'ক'.repeat(1000) } });
    fireEvent.input(screen.getByLabelText('Recovery or backup codes'), { target: { value: 'c'.repeat(2000) } });
    fireEvent.click(screen.getByRole('button', { name: 'Lock and send' }));
    expect(await screen.findByText('The details are too long. Shorten the note or the codes.')).toBeTruthy(); // DV-34: at most 4 KB
    expect(seller.called(`POST ${G}/sealed`)).toHaveLength(0);
    fireEvent.input(screen.getByLabelText('A note for the buyer'), { target: { value: '' } });
    fireEvent.input(screen.getByLabelText(/^Login/), { target: { value: ' player@example.com ' } });
    fireEvent.input(password, { target: { value: 'Correct-Horse-Battery-9' } });
    fireEvent.input(screen.getByLabelText('Recovery or backup codes'), { target: { value: '8F2K-11QX\n\n9Z3M-22RW' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lock and send' }));
    expect(await screen.findByText(/^The login details are sent\. Nothing you typed is kept/)).toBeTruthy();
    expect(screen.queryByLabelText('Password')).toBeNull();
    const body = seller.called(`POST ${G}/sealed`)[0].body as { keyVersion: number; enc: string; ciphertext: string };
    expect(body.keyVersion).toBe(1);
    expect(unb64u(body.ciphertext).length).toBe(512 + 16); // DV-34: padded to 512 bytes, plus the tag
    expect(new TextDecoder().decode(unb64u(body.ciphertext))).not.toContain('Correct-Horse');
    document.body.replaceChildren();

    let view = game({ status: 'delivered', keyVersion: 1, deliveredAt: iso(0), takeoverDueAt: iso(24 * HOUR) });
    const be = backend({
      [`GET ${G}`]: () => json(200, view)(),
      [`GET ${G}/sealed`]: () => json(200, sealed)(),
      [`POST ${G}/takeover-steps/password`]: () => {
        view = { ...view, steps: { ...view.steps, password: iso(0) } };
        return json(200, { step: 'password', takenOverAt: null })();
      },
    });
    await open(`/secure/orders/${ID}/credentials`, be, keys);
    const details = screen.getByRole('heading', { name: 'Login details' }).closest('section')!;
    expect(within(details).getByText('player@example.com')).toBeTruthy();
    expect(within(details).getByText('Correct-Horse-Battery-9')).toBeTruthy();
    expect(within(details).getByText('9Z3M-22RW')).toBeTruthy();
    expect(screen.getByText(para(/^Take over the account by .+\(in (1 day|23 h)/))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Done: Change the password' }));
    expect(await screen.findByText(/^done on /)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Done: Change the recovery e-mail' })).toBeTruthy();
    expect(be.called(`GET ${G}/sealed`)).toHaveLength(1); // each retrieval is logged: fetched once per page
  });

  it('FR-GAM-14 "the login details do not work" opens a dispute, with its consequence, and is gone once the recovery e-mail is confirmed', async () => {
    let view = game({ status: 'delivered', keyVersion: 1, takeoverDueAt: iso(24 * HOUR) });
    const be = backend({
      [`GET ${G}`]: () => json(200, view)(),
      [`GET ${G}/sealed`]: problem(404, 'not-found', { errors: [{ field: 'credentials', reason: 'none' }] }),
      [`POST ${G}/report-invalid`]: () => {
        view = game({ status: 'disputed', keyVersion: 1 });
        return json(201, { disputeId: 'd-1' })();
      },
    });
    await open(`/secure/orders/${ID}/credentials`, be);
    expect(screen.getByText('There are no login details to open.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'The login details do not work' }));
    expect(screen.getByText(/^This opens a dispute and the payment stays held/)).toBeTruthy();
    fireEvent.input(screen.getByLabelText('What went wrong (optional)'), { target: { value: 'too short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Report and open a dispute' }));
    expect(screen.getByText('Write at least 20 characters, or leave it empty.')).toBeTruthy();
    fireEvent.input(screen.getByLabelText('What went wrong (optional)'), { target: { value: 'The password is refused by the game.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Report and open a dispute' }));
    await waitFor(() => expect(screen.getByText(/^You reported that the login details do not work\./)).toBeTruthy());
    expect(be.called(`POST ${G}/report-invalid`)[0].body).toEqual({ description: 'The password is refused by the game.' });
    document.body.replaceChildren();

    await open(
      `/secure/orders/${ID}/credentials`,
      backend({
        [`GET ${G}`]: json(200, game({ status: 'delivered', keyVersion: 1, steps: { ...game().steps, password: iso(-HOUR), recovery_email: iso(-HOUR) } })),
        [`GET ${G}/sealed`]: problem(404, 'not-found', { errors: [{ field: 'credentials', reason: 'none' }] }),
      }),
    );
    expect(screen.queryByRole('button', { name: 'The login details do not work' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create a new key and ask again' })).toBeNull();
  });

  it('FR-GAM-12 a browser without the key asks once for the details again, with a new key kept here first', async () => {
    const other = await generateBuyerKey();
    const keys = memoryKeys();
    const be = backend({
      [`GET ${G}`]: json(200, game({ status: 'delivered', keyVersion: 1, takeoverDueAt: iso(24 * HOUR) })),
      [`GET ${G}/sealed`]: json(200, { keyVersion: 1, enc: b64u(other.publicRaw), ciphertext: b64u(new Uint8Array(528)) }),
      [`POST ${G}/rekey`]: json(201, { keyVersion: 2, redeliveryDueAt: iso(5 * HOUR) }),
    });
    await open(`/secure/orders/${ID}/credentials`, be, keys);
    expect(screen.getByText('This browser does not have the key for these login details.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Create a new key and ask again' }));
    expect(await screen.findByText(para(/^The seller has been asked to send the login details again by .+\(in (5|4) h/))).toBeTruthy();
    const sent = be.called(`POST ${G}/rekey`)[0].body as { publicKey: string };
    const stored = keys.map.get(`${ID}:2`)!;
    expect(b64u(new Uint8Array(await crypto.subtle.exportKey('raw', stored.publicKey)))).toBe(sent.publicKey);
  });
});

describe('the document', () => {
  it('SEC-GAM-03 NFR-USE-04 an unknown address says so; both languages have the same keys and placeholders', async () => {
    await open('/secure/orders/not-an-order/credentials', backend({}));
    expect(screen.getByRole('heading', { name: 'This page does not exist.' })).toBeTruthy();
    expect(Object.keys(bn).sort()).toEqual(Object.keys(en).sort());
    for (const k of Object.keys(en) as (keyof typeof en)[]) expect(placeholders(bn[k])).toEqual(placeholders(en[k]));
  });
});
