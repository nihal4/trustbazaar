import { randomInt, randomUUID } from 'crypto';
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const sharp = require('sharp') as typeof import('sharp').default;
import { DataSource } from 'typeorm';
import { seedAreas } from '../../src/areas-seed';
import { CONFIG_PORT } from '../../src/kernel/config-port';
import { startApp, TestApp } from '../support/app';
import { openAuction } from '../support/auctions';
import { IdentityFixtures } from '../support/identity';
import { b64, generateBuyerKey } from '../support/sealed';
import { fillPath, Route, routeName, routesOf } from '../support/routes';

// U1-10: the negative authorisation tests of SEC-SDL-09 for every protected endpoint of the running backend
// (docs/design/01_identity_access.pdf section 9; BUILDING.md section 6). The routes are read from the controllers,
// so a new endpoint is tested as soon as it exists: no session, an expired session and a lower role are checked on
// every one; another user's object on every user endpoint that takes an object, with a fixture of each kind. The
// guards run before validation, so the first three need no request bodies.

/** Parameters that are not ids: any value reaches the guards. */
const PARAM: Record<string, string> = { kind: 'doc_front', step: 'password_changed', type: 'dispute' };

/**
 * User endpoints that take an object any member may act on, so there is no other user's object to refuse. Each says
 * why; every other user endpoint with a parameter must be in the table of the last test.
 */
const OPEN_TO_MEMBERS: Record<string, string> = {
  'POST /auctions/:id/bids': 'any verified member bids on an open auction (FR-AUC-03)',
  'GET /auctions/:id/my-status': 'the caller\'s own standing on any auction (FR-AUC-12)',
  'POST /blocks/:userId': 'a member may block any other member (FR-CHT-08)',
  'DELETE /blocks/:userId': 'the caller\'s own block list (FR-CHT-08)',
  'GET /listings/:id/fulfilment-options': 'a buyer\'s quote for any active listing (FR-DLV-02)',
  'POST /listings/:id/threads': 'a buyer opens a thread on any active listing (FR-CHT-01)',
  'POST /kyc/files/:kind/view': 'the caller\'s own KYC files; the parameter is a file kind, not an object (SEC-DAT-04)',
};

describe('negative authorisation (SEC-SDL-09)', () => {
  let t: TestApp;
  let fx: IdentityFixtures;
  let routes: Route[];

  beforeAll(async () => {
    t = await startApp();
    fx = await IdentityFixtures.open();
    routes = routesOf(t.app);
  });
  afterAll(async () => {
    await fx?.close();
    await t?.close();
  });

  // each request from its own address, so the rate limits (SEC-ABU-01) never answer first
  let next = randomInt(0, 50_000);
  const ip = () => {
    const n = next++ % 65_000;
    return `203.0.113.${randomInt(1, 255)}, 10.${120 + (n >> 16)}.${(n >> 8) & 255}.${n & 255}`;
  };
  const kindOf = (r: Route) => r.policy?.kind;
  const userRoutes = () => routes.filter((r) => kindOf(r) === 'signed-in' || kindOf(r) === 'verified');
  const staffRoutes = () => routes.filter((r) => kindOf(r) === 'staff');
  const protectedRoutes = () => [...userRoutes(), ...staffRoutes()];
  const send = (r: Route, headers: Record<string, string> = {}, path = fillPath(r.path, (p) => PARAM[p] ?? randomUUID())) =>
    fetch(t.url(path), { method: r.method, headers: { 'x-forwarded-for': ip(), ...headers } });
  /** Each route's answer, as 'METHOD /path status'; the expectation lists the same routes with the expected status. */
  async function answers(list: Route[], headersFor: (r: Route) => Promise<Record<string, string>> | Record<string, string>) {
    const out: string[] = [];
    for (const r of list) out.push(`${routeName(r)} ${(await send(r, await headersFor(r))).status}`);
    return out;
  }
  const expecting = (list: Route[], status: (r: Route) => number) => list.map((r) => `${routeName(r)} ${status(r)}`);

  async function user(o: Parameters<IdentityFixtures['user']>[0] = { kyc: 'verified' }, s: Parameters<IdentityFixtures['session']>[1] = {}) {
    const userId = await fx.user(o);
    const sid = await fx.session({ userId }, s);
    return { userId, sid, headers: fx.headers(sid, userId, 'user') };
  }
  async function staff(role: 'operator' | 'administrator', s: Parameters<IdentityFixtures['session']>[1] = {}) {
    const staffId = await fx.staff(role);
    const sid = await fx.session({ staffId }, s);
    return { staffId, sid, headers: fx.headers(sid, staffId, 'staff') };
  }

  it('SEC-SDL-09 DC-7 every route declares who may call it, and the backend has protected routes of each kind', () => {
    expect(routes.filter((r) => !r.policy).map(routeName)).toEqual([]);
    expect(userRoutes().length).toBeGreaterThan(80);
    expect(staffRoutes().length).toBeGreaterThan(60);
  });

  it('SEC-SDL-09 no session: every user and staff endpoint answers 401', async () => {
    const list = protectedRoutes();
    expect(await answers(list, () => ({}))).toEqual(expecting(list, () => 401));
  });

  it('SEC-SDL-09 an expired session: every user and staff endpoint answers 401', async () => {
    const u = await user({ kyc: 'verified' }, { idleSeconds: -60 });
    const op = await staff('operator', { idleSeconds: -60 });
    const admin = await staff('administrator', { idleSeconds: -60 });
    const list = protectedRoutes();
    const headersFor = (r: Route) => {
      if (kindOf(r) !== 'staff') return u.headers;
      return r.policy?.kind === 'staff' && r.policy.roles.includes('administrator') ? admin.headers : op.headers;
    };
    expect(await answers(list, headersFor)).toEqual(expecting(list, () => 401));
  });

  it('SEC-SDL-09 an access token past its lifetime: every user endpoint answers 401', async () => {
    const userId = await fx.user({ kyc: 'verified' });
    const sid = await fx.session({ userId });
    const list = userRoutes();
    expect(await answers(list, () => fx.headers(sid, userId, 'user', { ttlSeconds: -1 }))).toEqual(expecting(list, () => 401));
  });

  it('SEC-SDL-09 a lower role: an unverified user on every verified endpoint, an operator on every administrator endpoint, 403', async () => {
    const unverified = await user({ kyc: 'unsubmitted' });
    const op = await staff('operator');
    const verifiedOnly = routes.filter((r) => kindOf(r) === 'verified');
    const adminOnly = routes.filter((r) => r.policy?.kind === 'staff' && r.policy.roles.length > 0 && !r.policy.roles.includes('operator'));
    expect(verifiedOnly.length).toBeGreaterThan(10);
    expect(adminOnly.length).toBeGreaterThan(10);
    expect(await answers(verifiedOnly, () => unverified.headers)).toEqual(expecting(verifiedOnly, () => 403));
    expect(await answers(adminOnly, () => op.headers)).toEqual(expecting(adminOnly, () => 403));
  });

  it('SEC-SDL-09 I-51 a user session on every staff endpoint, and a staff session on every user endpoint, answer 401', async () => {
    const u = await user();
    const admin = await staff('administrator');
    const [s, us] = [staffRoutes(), userRoutes()];
    expect(await answers(s, () => u.headers)).toEqual(expecting(s, () => 401));
    expect(await answers(us, () => admin.headers)).toEqual(expecting(us, () => 401));
  });

  it('SEC-SDL-09 another user\'s object: every user endpoint that takes one refuses a member who is not a party', async () => {
    const seller = await user();
    const buyer = await user();
    const stranger = await user();
    const call = (who: { headers: Record<string, string> }, method: string, path: string, body?: unknown, extra: Record<string, string> = {}) => {
      const form = body instanceof FormData;
      return fetch(t.url(path), {
        method,
        headers: { ...who.headers, 'x-forwarded-for': ip(), ...(body !== undefined && !form ? { 'content-type': 'application/json' } : {}), ...extra },
        body: body === undefined ? undefined : form ? body : JSON.stringify(body),
      });
    };
    const formOf = (fields: Record<string, string | Buffer>) => {
      const f = new FormData();
      for (const [k, v] of Object.entries(fields)) {
        if (typeof v === 'string') f.append(k, v);
        else f.append(k, new Blob([new Uint8Array(v)], { type: 'image/jpeg' }), 'photo.jpg');
      }
      return f;
    };

    // the seller's objects: listings, an address, a session; the buyer's: an order, a thread, a dispute, a rating
    const [{ id: category }] = await fx.query<{ id: number }>(
      `INSERT INTO listings.categories (slug, name_en, name_bn, item_kind) VALUES ($1, 'Lamps', 'বাতি', 'physical') RETURNING id`, [`authz-${randomUUID().slice(0, 8)}`]);
    const listing = async (status: 'draft' | 'active') => {
      const [{ id }] = await fx.query<{ id: string }>(
        `INSERT INTO listings.listings (seller_id, item_kind, sale_format, category_id, title, description, condition, no_visible_defects,
            fulfilment_options, weight_class, size_class, area_district, approx_lat, approx_lng, price, quantity_total, quantity_available)
         VALUES ($1, 'physical', 'fixed_price', $2, 'Brass desk lamp', 'A brass desk lamp, written by the authorisation test.', 'used', true,
            'pickup_or_courier', 'up_to_1kg', 'small', 'Dhaka', 23.81, 90.41, 1500000, 1, 1) RETURNING id`, [seller.userId, category]);
      for (const n of [1, 2]) await fx.query(`INSERT INTO listings.listing_photos (listing_id, position, storage_key, width, height) VALUES ($1, $2, $3, 800, 600)`, [id, n, randomUUID().replace(/-/g, '')]);
      if (status === 'active') await fx.query(`UPDATE listings.listings SET status = 'active', published_at = now() WHERE id = $1`, [id]);
      return id;
    };
    const draft = await listing('draft');
    const active = await listing('active');
    const [{ id: photo }] = await fx.query<{ id: string }>(`SELECT id::text FROM listings.listing_photos WHERE listing_id = $1 LIMIT 1`, [draft]);
    const [{ id: order }] = await fx.query<{ id: string }>(
      `INSERT INTO orders.orders (kind, listing_id, item_kind, buyer_id, seller_id, quantity, unit_price, item_price, fulfilment, delivery_fee, total,
          listing_snapshot, commission_bps, delivery_margin_bps, params_version, payment_due_at, status, paid_at, fulfilment_step, fulfilment_due_at)
       VALUES ('fixed_price', $1, 'physical', $2, $3, 1, 1500000, 1500000, 'self_pickup', 0, 1500000, '{"title":"Brass desk lamp"}', 500, 1000, 1,
               now(), 'paid', now(), 'meetup_handover', now() + interval '3 days') RETURNING id`, [active, buyer.userId, seller.userId]);
    const thread = await (await call(buyer, 'POST', `/listings/${active}/threads`, {})).json();
    expect(thread.id).toEqual(expect.any(String));
    const [{ id: dispute }] = await fx.query<{ id: string }>(
      `INSERT INTO disputes.disputes (order_id, buyer_id, seller_id, item_kind, type, description, item_price, amount_collected, seller_due_at)
       VALUES ($1, $2, $3, 'physical', 'not_as_described', 'The lamp does not work at all.', 1500000, 1500000, now() + interval '2 days') RETURNING id`,
      [order, buyer.userId, seller.userId]);
    const [{ id: closedOrder }] = await fx.query<{ id: string }>(
      `INSERT INTO orders.orders (kind, listing_id, item_kind, buyer_id, seller_id, quantity, unit_price, item_price, fulfilment, delivery_fee, total,
          listing_snapshot, commission_bps, delivery_margin_bps, params_version, payment_due_at, status, paid_at, fulfilment_step, fulfilment_due_at)
       VALUES ('fixed_price', $1, 'physical', $2, $3, 1, 1500000, 1500000, 'self_pickup', 0, 1500000, '{"title":"Brass desk lamp"}', 500, 1000, 1,
               now(), 'paid', now(), 'meetup_handover', now() + interval '3 days')
       RETURNING id`, [randomUUID(), buyer.userId, seller.userId]);
    await fx.query(`INSERT INTO trust.rating_eligibility (order_id, buyer_id, seller_id, closed_at, rate_until, completed) VALUES ($1, $2, $3, now(), now() + interval '14 days', true)`,
      [closedOrder, buyer.userId, seller.userId]);
    const [{ id: rating }] = await fx.query<{ id: string }>(
      `INSERT INTO trust.ratings (order_id, rater_id, ratee_id, stars, text, edit_until) VALUES ($1, $2, $3, 5, 'Fine', now() + interval '1 day') RETURNING id`,
      [closedOrder, buyer.userId, seller.userId]);
    await seedAreas(t.app.get(DataSource)); // idempotent; a fresh database has none
    const [{ id: area }] = await fx.query<{ id: number }>(`SELECT id FROM delivery.areas WHERE active ORDER BY id LIMIT 1`, []);
    const address = await (await call(seller, 'POST', '/me/addresses', { kind: 'pickup', label: 'Shop', areaId: area, line1: 'House 12, Road 5', contactName: 'Karim Seller' })).json();
    expect(address.id).toEqual(expect.any(String));
    const auction = await openAuction(fx, seller.userId, category);

    /** Every user endpoint that takes an object: the seller's or the buyer's object, and a body that passes validation. */
    const key = await generateBuyerKey();
    const image = await sharp({ create: { width: 320, height: 240, channels: 3, background: 'white' } }).jpeg().toBuffer();
    const table: Record<string, { path: string; body?: unknown; form?: Record<string, string | Buffer> }> = {
      'POST /auctions/:id/second-chance/:oid/decision': { path: `/auctions/${auction}/second-chance/${randomUUID()}/decision`, body: { decision: 'accept' } },
      'DELETE /auth/sessions/:id': { path: `/auth/sessions/${seller.sid}` },
      'GET /disputes/:id': { path: `/disputes/${dispute}` },
      'POST /disputes/:id/evidence': { path: `/disputes/${dispute}/evidence`, form: { file: image } },
      'POST /disputes/:id/return-received': { path: `/disputes/${dispute}/return-received` },
      'POST /disputes/:id/statements': { path: `/disputes/${dispute}/statements`, body: { text: 'This is my statement about the lamp.' } },
      'POST /disputes/:id/withdraw': { path: `/disputes/${dispute}/withdraw` },
      'PATCH /listings/:id': { path: `/listings/${draft}`, body: { title: 'A different lamp' } },
      'POST /listings/:id/cancel': { path: `/listings/${active}/cancel` },
      'POST /listings/:id/clarifications': { path: `/listings/${active}/clarifications`, body: { body: 'The shade is green.' } },
      'POST /listings/:id/feature': { path: `/listings/${active}/feature`, body: { hours: 24, provider: 'stripe' } },
      'PUT /listings/:id/game-details': { path: `/listings/${draft}/game-details`, body: { gameId: 1, platform: 'PC', playerId: 'player-1', contents: 'Level 80 account with skins' } },
      'GET /listings/:id/ownership': { path: `/listings/${draft}/ownership` },
      'POST /listings/:id/ownership-code': { path: `/listings/${draft}/ownership-code` },
      'POST /listings/:id/ownership-proof': { path: `/listings/${draft}/ownership-proof`, form: { file: image } },
      'POST /listings/:id/photos': { path: `/listings/${draft}/photos`, form: { photo: image } },
      'DELETE /listings/:id/photos/:pid': { path: `/listings/${draft}/photos/${photo}` },
      'POST /listings/:id/publish': { path: `/listings/${draft}/publish`, body: {} },
      'DELETE /me/addresses/:id': { path: `/me/addresses/${address.id}` },
      'GET /orders/:id': { path: `/orders/${order}` },
      'POST /orders/:id/cancel': { path: `/orders/${order}/cancel`, body: { reason: 'Not mine to cancel' } },
      'POST /orders/:id/cancellation-requests': { path: `/orders/${order}/cancellation-requests`, body: { reason: 'Not mine to cancel' } },
      'POST /orders/:id/cancellation-requests/:rid/decision': { path: `/orders/${order}/cancellation-requests/${randomUUID()}/decision`, body: { decision: 'accept' } },
      'POST /orders/:id/confirm-receipt': { path: `/orders/${order}/confirm-receipt` },
      'GET /orders/:id/dispute-types': { path: `/orders/${order}/dispute-types` },
      'POST /orders/:id/disputes': { path: `/orders/${order}/disputes`, body: { type: 'not_as_described', description: 'The lamp does not work at all, not as described.' } },
      'PUT /orders/:id/fulfilment': { path: `/orders/${order}/fulfilment`, body: { fulfilment: 'self_pickup' } },
      'GET /orders/:id/game': { path: `/orders/${order}/game` },
      'POST /orders/:id/game/acknowledge': { path: `/orders/${order}/game/acknowledge`, body: { version: 1 } },
      'GET /orders/:id/game/buyer-key': { path: `/orders/${order}/game/buyer-key` },
      'POST /orders/:id/game/key': { path: `/orders/${order}/game/key`, body: { publicKey: b64(key.publicRaw) } },
      'POST /orders/:id/game/rekey': { path: `/orders/${order}/game/rekey`, body: { publicKey: b64(key.publicRaw) } },
      'POST /orders/:id/game/report-invalid': { path: `/orders/${order}/game/report-invalid`, body: {} },
      'POST /orders/:id/game/sealed': { path: `/orders/${order}/game/sealed`, body: { keyVersion: 1, enc: 'A'.repeat(87), ciphertext: 'A'.repeat(704) } },
      'GET /orders/:id/game/sealed': { path: `/orders/${order}/game/sealed` },
      'POST /orders/:id/game/takeover-steps/:step': { path: `/orders/${order}/game/takeover-steps/password_changed` },
      'GET /orders/:id/handover': { path: `/orders/${order}/handover` },
      'POST /orders/:id/handover-code': { path: `/orders/${order}/handover-code`, body: { code: '123456' } },
      'POST /orders/:id/meetup-proposals': { path: `/orders/${order}/meetup-proposals`, body: { meetAt: new Date(Date.now() + 86_400_000).toISOString() } },
      'POST /orders/:id/meetup-proposals/:pid/accept': { path: `/orders/${order}/meetup-proposals/${randomUUID()}/accept` },
      'POST /orders/:id/meetup-proposals/:pid/decline': { path: `/orders/${order}/meetup-proposals/${randomUUID()}/decline` },
      'POST /orders/:id/meetup-proposals/:pid/withdraw': { path: `/orders/${order}/meetup-proposals/${randomUUID()}/withdraw` },
      'POST /orders/:id/payments': { path: `/orders/${order}/payments`, body: { provider: 'stripe' } },
      'POST /orders/:id/rating': { path: `/orders/${closedOrder}/rating`, body: { stars: 5 } },
      'GET /orders/:id/receipt': { path: `/orders/${order}/receipt` },
      'POST /orders/:id/release-early': { path: `/orders/${order}/release-early` },
      'POST /orders/:id/return/received': { path: `/orders/${order}/return/received` },
      'PUT /orders/:id/shipment/pickup-address': { path: `/orders/${order}/shipment/pickup-address`, body: { addressId: address.id } },
      'GET /orders/:id/shipments': { path: `/orders/${order}/shipments` },
      'PATCH /ratings/:id': { path: `/ratings/${rating}`, body: { stars: 1 } },
      'POST /ratings/:id/reply': { path: `/ratings/${rating}/reply`, body: { text: 'Thank you.' } },
      'POST /threads/:id/images': { path: `/threads/${thread.id}/images`, form: { clientId: randomUUID(), image } },
      'POST /threads/:id/marks': { path: `/threads/${thread.id}/marks`, body: { delivered: 0, read: 0 } },
      'GET /threads/:id/messages': { path: `/threads/${thread.id}/messages` },
      'POST /threads/:id/messages': { path: `/threads/${thread.id}/messages`, body: { clientId: randomUUID(), text: 'Hello there' } },
      'POST /threads/:id/reports': { path: `/threads/${thread.id}/reports`, body: { category: 'abusive' } },
    };

    const withObject = userRoutes().filter((r) => r.path.includes(':')).map(routeName);
    expect(withObject.filter((n) => !(n in table) && !(n in OPEN_TO_MEMBERS))).toEqual([]); // a new endpoint needs its case here
    expect(Object.keys(table).filter((n) => !withObject.includes(n))).toEqual([]);

    // the featured-listing fee (CP-37) is checked before the listing: set it for this test, as featured.spec does
    const admin = await fx.staff('administrator');
    const setFee = async (fee: number | null) => {
      await fx.query(`SELECT staff.publish_config($1::jsonb, $2, $3)`, [
        JSON.stringify({ 'CP-37': { periods: ['24 hours', '48 hours'], fee_poisha: fee } }), admin, 'Featured fee for the authorisation tests']);
      (t.app.get(CONFIG_PORT) as unknown as { invalidate(): void }).invalidate();
    };
    await setFee(10_000);
    const ordered = userRoutes().filter((x) => routeName(x) in table);
    const refused: string[] = [];
    try {
      for (const r of ordered) {
        const c = table[routeName(r)];
        const extra: Record<string, string> = r.stepUp ? { 'x-step-up': await fx.stepUpGrant(stranger.sid, r.stepUp) } : {};
        const body = c.form ? formOf(c.form) : c.body ?? (r.method === 'GET' || r.method === 'DELETE' ? undefined : {});
        const res = await call(stranger, r.method, c.path, body, extra);
        refused.push(`${routeName(r)} ${[403, 404].includes(res.status) ? 'refused' : `${res.status} ${await res.text()}`}`);
      }
    } finally {
      await setFee(null);
    }
    expect(refused).toEqual(ordered.map((r) => `${routeName(r)} refused`));
    // and nothing of theirs changed
    expect(await fx.query(`SELECT ended_at FROM identity.sessions WHERE id = $1`, [seller.sid])).toEqual([{ ended_at: null }]);
    expect(await fx.query(`SELECT status, title FROM listings.listings WHERE id = ANY($1) ORDER BY status::text`, [[draft, active]]))
      .toEqual([{ status: 'active', title: 'Brass desk lamp' }, { status: 'draft', title: 'Brass desk lamp' }]);
    expect(await fx.query(`SELECT status::text FROM orders.orders WHERE id = $1`, [order])).toEqual([{ status: 'paid' }]);
    expect(await fx.query(`SELECT status::text, withdrawn_at FROM disputes.disputes WHERE id = $1`, [dispute])).toEqual([{ status: 'open', withdrawn_at: null }]);
    expect(await fx.query(`SELECT stars, reply_text FROM trust.ratings WHERE id = $1`, [rating])).toEqual([{ stars: 5, reply_text: null }]);
    expect(await fx.query(`SELECT deleted_at FROM delivery.saved_addresses WHERE id = $1`, [address.id])).toEqual([{ deleted_at: null }]);
    expect(await fx.query(`SELECT last_seq::int FROM chat.threads WHERE id = $1`, [thread.id])).toEqual([{ last_seq: 0 }]);
  });
});
