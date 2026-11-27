import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { draftListing, suite } from './setup';

// SEC-INP-05: the server never fetches a web address supplied by a user (no server-side request forgery).
const s = suite();
const SRC = join(__dirname, '..', '..', 'src');
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : n.endsWith('.ts') && !n.endsWith('.spec.ts') ? [join(d, n)] : []));

/** The only code that makes outbound requests: the Stripe adapter, to Stripe's fixed address; and the mock courier's
 *  simulator page, whose fetch runs in the browser of the person using it, against this API. */
const OUTBOUND = new Set(['modules/orders/adapters/stripe-provider.ts', 'modules/delivery/http/mock-courier.controller.ts']);

describe('SEC-INP-05 no fetching of user-supplied addresses', () => {
  let trap: Server;
  let hits = 0;
  let url = '';
  beforeAll(async () => {
    trap = createServer((_q, r) => {
      hits++;
      r.end('x');
    });
    await new Promise<void>((ok) => trap.listen(0, '127.0.0.1', ok));
    url = `http://127.0.0.1:${(trap.address() as AddressInfo).port}/probe.png`;
  });
  afterAll(() => new Promise<void>((ok) => trap.close(() => ok())));

  it('SEC-INP-05 an address in a listing, a chat message and a report is stored as text and never requested', async () => {
    const seller = await s.signedIn({ kyc: 'verified' });
    const id = await draftListing(s, seller.b, { description: `See the photo at ${url} before buying, it shows the box.` });
    await seller.b.request('PATCH', `/listings/${id}`, { title: `Lamp ${url}` });
    for (const n of [1, 2])
      await s.fx.query(`INSERT INTO listings.listing_photos (listing_id, position, storage_key, width, height) VALUES ($1, $2, $3, 1, 1)`, [
        id,
        n,
        `k${n}${Date.now()}`,
      ]);
    await s.fx.query(`UPDATE listings.listings SET status = 'active', published_at = now() WHERE id = $1`, [id]);
    const buyer = await s.signedIn({ kyc: 'verified' });
    const thread = (await (await buyer.b.post(`/listings/${id}/threads`, {})).json()) as { id: string };
    await buyer.b.post(`/threads/${thread.id}/messages`, { clientId: crypto.randomUUID(), text: `Is this it? ${url}` });
    await buyer.b.post(`/listings/${id}/reports`, { reason: 'misleading', text: `Compare with ${url}` });
    await new Promise((r) => setTimeout(r, 1500));
    expect(hits).toBe(0);
  });

  it('SEC-INP-05 no route takes an address to fetch: no body field is a URL to be loaded', () => {
    const named = walk(join(SRC, 'modules'))
      .filter((f) => /\.dto\.ts$|http\/.*\.ts$/.test(f))
      .flatMap((f) =>
        [...readFileSync(f, 'utf8').matchAll(/^\s+(\w*(?:url|Url|URL|uri|Uri|href|link|Link)\w*)[!?]?:/gm)].map((m) => `${relative(SRC, f)}: ${m[1]}`),
      );
    expect(named).toEqual([]);
  });

  it('SEC-INP-05 outbound requests are made only by the provider adapters', () => {
    const callers = walk(SRC)
      .filter((f) => /\bfetch\(|\bhttps?\.request\(|\bhttps?\.get\(|\baxios\b|\bgot\(|\bundici\b/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC, f));
    expect(callers.filter((f) => !OUTBOUND.has(f))).toEqual([]);
  });
});
