import { randomInt, randomUUID } from 'crypto';
import { CONFIG_PORT, ConfigPort } from '../../src/kernel/config-port';
import { ORDERS_PORT, OrdersPort } from '../../src/modules/orders/ports';
import { startApp, TestApp } from '../support/app';
import { IdentityFixtures } from '../support/identity';

// U2-02: fixed-price checkout, the fulfilment choice and the order views over HTTP, and OrdersPort's auction
// orders, against PostgreSQL and Redis through the security pipeline (docs/design/02_orders_payments.pdf
// sections 3.1, 3.3, 5.3, 5.4). Listings are written as tb_app directly; their own rules are U3-02's tests.
describe('orders', () => {
  let t: TestApp;
  let fx: IdentityFixtures;
  let phones: number;
  let games: number;

  beforeAll(async () => {
    t = await startApp();
    fx = await IdentityFixtures.open();
    const tag = randomUUID().slice(0, 8);
    const cat = async (kind: string) =>
      (await fx.query<{ id: number }>(`INSERT INTO listings.categories (slug, name_en, name_bn, item_kind) VALUES ($1, 'c', 'বি', $2) RETURNING id`, [`o-${kind.replace('_', '-')}-${tag}`, kind]))[0].id;
    phones = await cat('physical');
    games = await cat('game_account');
  });
  afterAll(async () => {
    await fx?.close();
    await t?.close();
  });

  async function member(o: { kyc?: string; verifiedDaysAgo?: number } = {}) {
    const userId = await fx.user({ kyc: o.kyc });
    if (o.verifiedDaysAgo !== undefined) {
      await fx.query(
        `INSERT INTO identity.kyc_status_history (user_id, from_status, to_status, actor_type, at) VALUES ($1, 'pending_review', 'verified', 'system', now() - make_interval(days => $2))`,
        [userId, o.verifiedDaysAgo],
      );
    }
    const sid = await fx.session({ userId });
    const ip = `203.0.113.${randomInt(1, 255)}, 198.51.100.${randomInt(1, 255)}`;
    const call = (method: string, path: string, body?: unknown, extra: Record<string, string> = {}) =>
      fetch(t.url(path), {
        method,
        headers: { ...fx.headers(sid, userId, 'user'), 'x-forwarded-for': ip, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...extra },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    return { userId, sid, call };
  }

  /** An active listing, written as tb_app (two photos, published). */
  async function listing(sellerId: string, o: { price?: number; quantity?: number; fulfilment?: string; kind?: 'physical' | 'game_account'; format?: 'fixed_price' | 'auction' } = {}) {
    const kind = o.kind ?? 'physical';
    const format = o.format ?? 'fixed_price';
    const physical = kind === 'physical';
    const [{ id }] = await fx.query<{ id: string }>(
      `INSERT INTO listings.listings (seller_id, item_kind, sale_format, category_id, title, description, condition, no_visible_defects,
          fulfilment_options, weight_class, size_class, area_district, approx_lat, approx_lng, price, quantity_total, quantity_available)
       VALUES ($1, $2, $3, $4, 'Phone for the order tests', 'A phone in good condition, written by the order tests.', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14)
       RETURNING id`,
      [sellerId, kind, format, physical ? phones : games, physical ? 'used' : null, physical ? true : null, physical ? o.fulfilment ?? 'pickup_or_courier' : null,
       physical ? 'up_to_1kg' : null, physical ? 'small' : null, physical ? 'Dhaka' : null, physical ? 23.81 : null, physical ? 90.41 : null,
       format === 'fixed_price' ? o.price ?? 1_500_000 : null, o.quantity ?? 1],
    );
    if (physical) {
      for (const n of [1, 2]) {
        await fx.query(`INSERT INTO listings.listing_photos (listing_id, position, storage_key, width, height) VALUES ($1, $2, $3, 800, 600)`, [id, n, randomUUID().replace(/-/g, '')]);
      }
    }
    await fx.query(`UPDATE listings.listings SET status = 'active', published_at = now() WHERE id = $1`, [id]);
    return id;
  }
  const stock = async (id: string) =>
    (await fx.query<{ quantity_available: number; quantity_reserved: number }>(`SELECT quantity_available, quantity_reserved FROM listings.listings WHERE id = $1`, [id]))[0];
  const errorsOf = async (r: Response) => {
    const b = await r.json();
    return { type: b.type, errors: (b.errors ?? []).map((e: { field: string; reason: string }) => `${e.field}:${e.reason}`) };
  };

  it('FR-FIX-01 and FR-FIX-02 checkout reserves the units and creates the order, priced by the server', async () => {
    const seller = await member();
    const buyer = await member();
    const id = await listing(seller.userId, { price: 1_250_000, quantity: 3 });
    const before = Date.now();
    const r = await buyer.call('POST', '/orders', { listingId: id, quantity: 2, fulfilment: 'self_pickup' });
    expect(r.status).toBe(201);
    const o = await r.json();
    expect(o).toMatchObject({
      kind: 'fixed_price', role: 'buyer', status: 'awaiting_payment', quantity: 2, unitPrice: '1250000', itemPrice: '2500000', deliveryFee: '0', total: '2500000',
      fulfilment: 'self_pickup', fulfilmentOptions: ['self_pickup', 'courier'], escrow: null, listing: { id, title: 'Phone for the order tests' },
    });
    const holdMs = Date.parse(o.paymentDueAt) - before;
    const cp13 = (await t.app.get<ConfigPort>(CONFIG_PORT).current()).ms('CP-13'); // 15 minutes unless an administrator changed it
    expect(holdMs).toBeGreaterThan(cp13 - 60_000);
    expect(holdMs).toBeLessThanOrEqual(cp13 + 5_000);
    expect(await stock(id)).toEqual({ quantity_available: 1, quantity_reserved: 2 });
    const [row] = await fx.query(`SELECT commission_bps, delivery_margin_bps, params_version, listing_snapshot->>'price' AS snap_price FROM orders.orders WHERE id = $1`, [o.id]);
    expect(row).toEqual({ commission_bps: 500, delivery_margin_bps: 1000, params_version: expect.any(Number), snap_price: '1250000' });
    const [ev] = await fx.query(`SELECT event_type, payload FROM orders.outbox WHERE aggregate_id = $1`, [o.id]);
    expect(ev).toMatchObject({ event_type: 'orders.order.created', payload: { listingId: id, buyerId: buyer.userId, sellerId: seller.userId, quantity: 2, total: '2500000' } });
    const [audit] = await fx.query(`SELECT actor_type, actor_id FROM audit.events WHERE action = 'orders.order.created' AND object_id = $1`, [o.id]);
    expect(audit).toEqual({ actor_type: 'user', actor_id: buyer.userId });
  });

  it('SEC-PAY-06 the client never sends a price; an unknown field is refused', async () => {
    const seller = await member();
    const buyer = await member();
    const id = await listing(seller.userId);
    expect((await buyer.call('POST', '/orders', { listingId: id, quantity: 1, total: '1' })).status).toBe(400);
    expect(await stock(id)).toEqual({ quantity_available: 1, quantity_reserved: 0 });
  });

  it('FR-FIX-01 a seller cannot buy their own listing, and nothing stays reserved', async () => {
    const seller = await member();
    const id = await listing(seller.userId, { quantity: 2 });
    const r = await seller.call('POST', '/orders', { listingId: id, quantity: 1 });
    expect(r.status).toBe(403);
    expect((await errorsOf(r)).errors).toEqual(['listingId:own-listing']);
    expect(await stock(id)).toEqual({ quantity_available: 2, quantity_reserved: 0 });
  });

  it('FR-FIX-05 more than is available, an unknown listing and an auction are each a definite 409', async () => {
    const seller = await member();
    const buyer = await member();
    const id = await listing(seller.userId, { quantity: 2 });
    expect((await buyer.call('POST', '/orders', { listingId: id, quantity: 3 })).status).toBe(409);
    expect((await buyer.call('POST', '/orders', { listingId: randomUUID(), quantity: 1 })).status).toBe(409);
    const auction = await listing(seller.userId, { format: 'auction' });
    expect((await errorsOf(await buyer.call('POST', '/orders', { listingId: auction, quantity: 1 }))).type).toBe('/problems/not-available');
  });

  it('AC-2 twenty buyers racing for the last two units: exactly two orders, every request answered', async () => {
    const seller = await member();
    const id = await listing(seller.userId, { quantity: 2 });
    const buyers = await Promise.all(Array.from({ length: 20 }, () => member()));
    const answers = await Promise.all(buyers.map((b) => b.call('POST', '/orders', { listingId: id, quantity: 1 })));
    const codes = answers.map((a) => a.status).sort();
    expect(codes.filter((c) => c === 201)).toHaveLength(2);
    expect(codes.filter((c) => c === 409)).toHaveLength(18);
    expect(await stock(id)).toEqual({ quantity_available: 0, quantity_reserved: 2 });
    const [{ n }] = await fx.query<{ n: number }>(`SELECT count(*)::int AS n FROM orders.orders WHERE listing_id = $1`, [id]);
    expect(n).toBe(2);
  });

  it('I-52 the same Idempotency-Key gives the same order and reserves once', async () => {
    const seller = await member();
    const buyer = await member();
    const id = await listing(seller.userId, { quantity: 3 });
    const key = `o-${randomUUID()}`;
    const first = await buyer.call('POST', '/orders', { listingId: id, quantity: 1 }, { 'idempotency-key': key });
    const again = await buyer.call('POST', '/orders', { listingId: id, quantity: 1 }, { 'idempotency-key': key });
    expect([first.status, again.status]).toEqual([201, 200]);
    expect((await again.json()).id).toBe((await first.json()).id);
    expect(await stock(id)).toEqual({ quantity_available: 2, quantity_reserved: 1 });
  });

  it('FR-TNS-07 CP-27: a newly verified buyer has a per-order and an open-orders limit; later only the per-order one', async () => {
    const seller = await member();
    const fresh = await member({ verifiedDaysAgo: 3 });
    const big = await listing(seller.userId, { price: 6_000_000 }); // BDT 60,000, above BDT 50,000
    const r = await fresh.call('POST', '/orders', { listingId: big, quantity: 1 });
    expect(r.status).toBe(409);
    expect((await errorsOf(r)).errors).toEqual(['total:above-new-account-per-order-limit']);
    expect(await stock(big)).toEqual({ quantity_available: 1, quantity_reserved: 0 });
    const mid = await listing(seller.userId, { price: 4_000_000, quantity: 3 }); // BDT 40,000 each; open limit BDT 100,000
    expect((await fresh.call('POST', '/orders', { listingId: mid, quantity: 1 })).status).toBe(201);
    expect((await fresh.call('POST', '/orders', { listingId: mid, quantity: 1 })).status).toBe(201);
    expect((await errorsOf(await fresh.call('POST', '/orders', { listingId: mid, quantity: 1 }))).errors).toEqual(['total:above-new-account-open-limit']);

    const settled = await member({ verifiedDaysAgo: 60 });
    expect((await settled.call('POST', '/orders', { listingId: big, quantity: 1 })).status).toBe(201);
    const huge = await listing(seller.userId, { price: 20_000_100 }); // above BDT 200,000
    expect((await errorsOf(await settled.call('POST', '/orders', { listingId: huge, quantity: 1 }))).errors).toEqual(['total:above-per-order-limit']);
  });

  it('FR-DLV-02 the buyer chooses self pickup before paying; courier and game accounts wait for their units', async () => {
    const seller = await member();
    const buyer = await member();
    const id = await listing(seller.userId, { quantity: 2 });
    const o = await (await buyer.call('POST', '/orders', { listingId: id, quantity: 1 })).json();
    expect(o.fulfilment).toBeNull();
    const courier = await buyer.call('PUT', `/orders/${o.id}/fulfilment`, { fulfilment: 'courier' });
    expect(courier.status).toBe(409);
    expect(await errorsOf(courier)).toEqual({ type: '/problems/feature-off', errors: ['fulfilment:courier-not-yet-available'] });
    expect((await errorsOf(await buyer.call('PUT', `/orders/${o.id}/fulfilment`, { fulfilment: 'game_account' }))).errors).toEqual(['fulfilment:not-offered-by-listing']);
    expect((await seller.call('PUT', `/orders/${o.id}/fulfilment`, { fulfilment: 'self_pickup' })).status).toBe(403);
    const ok = await buyer.call('PUT', `/orders/${o.id}/fulfilment`, { fulfilment: 'self_pickup' });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ fulfilment: 'self_pickup', total: '1500000' });

    const pickupOnly = await listing(seller.userId, { fulfilment: 'pickup_only' });
    expect((await errorsOf(await buyer.call('POST', '/orders', { listingId: pickupOnly, quantity: 1, fulfilment: 'courier' }))).errors).toEqual(['fulfilment:not-offered-by-listing']);
    const game = await listing(seller.userId, { kind: 'game_account' });
    const g = await buyer.call('POST', '/orders', { listingId: game, quantity: 1 });
    expect(await errorsOf(g)).toEqual({ type: '/problems/feature-off', errors: ['listingId:game-accounts-not-yet-available'] });
    expect(await stock(game)).toEqual({ quantity_available: 1, quantity_reserved: 0 });
  });

  it('IF-UI-05 my orders as buyer and as seller, newest first; each party sees the order, nobody else', async () => {
    const seller = await member();
    const buyer = await member();
    const a = await listing(seller.userId);
    const b = await listing(seller.userId);
    const o1 = await (await buyer.call('POST', '/orders', { listingId: a, quantity: 1 })).json();
    const o2 = await (await buyer.call('POST', '/orders', { listingId: b, quantity: 1 })).json();
    const mine = await (await buyer.call('GET', '/orders')).json();
    expect(mine.items.map((i: { id: string }) => i.id)).toEqual([o2.id, o1.id]);
    expect(mine.nextCursor).toBeNull();
    const sold = await (await seller.call('GET', '/orders?role=seller')).json();
    expect(sold.items.map((i: { id: string; role: string }) => [i.id, i.role])).toEqual([[o2.id, 'seller'], [o1.id, 'seller']]);
    expect((await (await seller.call('GET', `/orders/${o1.id}`)).json()).role).toBe('seller');
    expect((await buyer.call('GET', '/orders?cursor=nonsense')).status).toBe(400);
  });

  it('SEC-SDL-09 another user, a lower role, no session and an expired session are refused', async () => {
    const seller = await member();
    const buyer = await member();
    const id = await listing(seller.userId, { quantity: 2 });
    const o = await (await buyer.call('POST', '/orders', { listingId: id, quantity: 1 })).json();
    const other = await member();
    expect((await other.call('GET', `/orders/${o.id}`)).status).toBe(404);
    expect((await other.call('PUT', `/orders/${o.id}/fulfilment`, { fulfilment: 'self_pickup' })).status).toBe(404);
    const unverified = await member({ kyc: 'unsubmitted' });
    expect((await unverified.call('POST', '/orders', { listingId: id, quantity: 1 })).status).toBe(403);
    expect((await fetch(t.url(`/orders/${o.id}`))).status).toBe(401);
    const sid = await fx.session({ userId: buyer.userId }, { idleSeconds: -60 });
    expect((await fetch(t.url(`/orders/${o.id}`), { headers: fx.headers(sid, buyer.userId, 'user') })).status).toBe(401);
    expect((await buyer.call('GET', `/orders/not-a-uuid`)).status).toBe(404);
  });

  it('FR-AUC-14 an auction order has the CP-10 window and no fulfilment yet; one live order per auction', async () => {
    const seller = await member();
    const winner = await member();
    const id = await listing(seller.userId, { format: 'auction' });
    const port = t.app.get<OrdersPort>(ORDERS_PORT);
    const before = Date.now();
    const o = await port.createAuctionOrder({ listingId: id, winnerId: winner.userId, price: 2_300_000n, kind: 'auction' });
    expect(o).toMatchObject({ kind: 'auction', role: 'buyer', total: '2300000', fulfilment: null, sellerId: seller.userId });
    const cp10 = (await t.app.get<ConfigPort>(CONFIG_PORT).current()).ms('CP-10');
    expect(Date.parse(o.paymentDueAt) - before).toBeGreaterThan(cp10 - 60_000); // CP-10: 24 hours by default
    await expect(port.createAuctionOrder({ listingId: id, winnerId: (await member()).userId, price: 2_000_000n, kind: 'second_chance' })).rejects.toThrow();
    expect((await (await winner.call('GET', `/orders/${o.id}`)).json()).listing.id).toBe(id);
    await expect(port.getOrderForParty(o.id, randomUUID())).rejects.toThrow();
  });

  it('IF-UI-05 paging never skips orders created within the same millisecond', async () => {
    const buyer = await member();
    const seller = await member();
    for (let i = 0; i < 51; i++) {
      await fx.query(
        `INSERT INTO orders.orders (kind, listing_id, item_kind, buyer_id, seller_id, quantity, unit_price, item_price, total, listing_snapshot,
            commission_bps, delivery_margin_bps, params_version, payment_due_at, created_at)
         VALUES ('fixed_price', $1, 'physical', $2, $3, 1, 100, 100, 100, '{"title":"Same millisecond"}', 500, 1000, 1, now(),
                 '2026-11-01 10:00:00.1231+00'::timestamptz + make_interval(secs => $4::double precision / 1000000))`,
        [randomUUID(), buyer.userId, seller.userId, i * 7],
      );
    }
    const first = await (await buyer.call('GET', '/orders?role=buyer')).json();
    const second = await (await buyer.call('GET', `/orders?role=buyer&cursor=${first.nextCursor}`)).json();
    expect([first.items.length, second.items.length, second.nextCursor]).toEqual([50, 1, null]);
    expect(new Set([...first.items, ...second.items].map((o: { id: string }) => o.id)).size).toBe(51);
  });
});
