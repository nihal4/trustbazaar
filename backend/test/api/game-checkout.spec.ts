import { randomInt, randomUUID, webcrypto } from 'crypto';
import { EventBus, OutboxEvent } from '../../src/kernel/events/event-bus';
import { DISCLOSURE_VERSION } from '../../src/modules/game-accounts/ports';
import { startApp, TestApp } from '../support/app';
import { IdentityFixtures } from '../support/identity';

// U5-03, first part: buying a game account up to payment (docs/design/05_game_accounts.pdf sections 3 and 6.2;
// FR-GAM-05, FR-GAM-06, FR-GAM-07, FR-GAM-10, I-29), against PostgreSQL through the real security pipeline, with the
// mock payment provider. The buyer's key is generated as the browser does it (Web Crypto, P-256, non-extractable private
// key). Events are handed to their consumers as the outbox dispatcher would.
describe('buying a game account: disclosure, the buyer\'s key, payment and the request for credentials', () => {
  let t: TestApp;
  let fx: IdentityFixtures;
  let bus: EventBus;
  let category: number;
  let gameId: number;

  beforeAll(async () => {
    t = await startApp();
    fx = await IdentityFixtures.open();
    bus = t.app.get(EventBus);
    [{ id: category }] = await fx.query<{ id: number }>(
      `INSERT INTO listings.categories (slug, name_en, name_bn, item_kind) VALUES ($1, 'Game accounts', 'গেম অ্যাকাউন্ট', 'game_account') RETURNING id`,
      [`checkout-${randomUUID().slice(0, 8)}`],
    );
    [{ id: gameId }] = await fx.query<{ id: number }>(
      `INSERT INTO game_accounts.games (slug, name, platforms, code_placement, publisher_note) VALUES ($1, 'Free Fire', '{android}', 'the bio', 'Transfers break the terms.') RETURNING id`,
      [`ff-${randomUUID().slice(0, 8)}`],
    );
  });
  afterAll(async () => {
    await fx?.close();
    await t?.close();
  });

  async function member() {
    const userId = await fx.user();
    const sessionId = await fx.session({ userId });
    const headers = { ...fx.headers(sessionId, userId, 'user'), 'x-forwarded-for': `203.0.113.${randomInt(1, 255)}, 198.51.100.${randomInt(1, 255)}` };
    const call = (method: string, path: string, body?: unknown, extra: Record<string, string> = {}) => fetch(t.url(path), {
      method, headers: { ...headers, ...extra, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { userId, sessionId, call };
  }
  /** An approved game-account listing: active, with its details and the player-ID claim (U5-02). */
  async function listing(sellerId: string) {
    const [{ id }] = await fx.query<{ id: string }>(
      `INSERT INTO listings.listings (seller_id, item_kind, sale_format, category_id, title, description, price, quantity_total, quantity_available)
       VALUES ($1, 'game_account', 'fixed_price', $2, 'Free Fire account, heroic', 'A heroic-rank account, written by the checkout tests.', 400000, 1, 1) RETURNING id`,
      [sellerId, category],
    );
    const player = String(randomInt(10_000_000, 99_999_999));
    await fx.query(`INSERT INTO game_accounts.details (listing_id, seller_id, game_id, platform, player_id, contents) VALUES ($1, $2, $3, 'android', $4, 'Heroic rank, five legendary skins.')`, [id, sellerId, gameId, player]);
    await fx.query(`UPDATE listings.listings SET status = 'active', published_at = now() WHERE id = $1`, [id]);
    await fx.query(`INSERT INTO game_accounts.claims (game_id, player_id_norm, listing_id) VALUES ($1, $2, $3)`, [gameId, player, id]);
    return id;
  }
  /** The browser's key pair (FR-GAM-07): the raw public point, base64url. */
  async function browserKey() {
    const pair = await webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
    return Buffer.from(await webcrypto.subtle.exportKey('raw', pair.publicKey)).toString('base64url');
  }
  async function pay(redirectUrl: string) {
    const page = new URL(redirectUrl);
    const form = await fetch(t.url(page.pathname.replace('/api/v1', '') + page.search), {
      method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'outcome=succeeded',
    });
    const cb = new URL(form.headers.get('location')!);
    expect((await fetch(t.url(cb.pathname.replace('/api/v1', '') + cb.search), { redirect: 'manual' })).status).toBe(303);
  }
  const errors = async (r: Response) => ((await r.json()) as { errors?: unknown[] }).errors;
  const consume = (consumer: string, e: OutboxEvent) => bus.consumersOf(e.type).find((c) => c.name === consumer)!.handler(e);
  const outboxEvent = async (outbox: 'orders' | 'game_accounts', orderId: string, type: string): Promise<OutboxEvent> => {
    const [r] = await fx.query<{ id: string; payload: Record<string, unknown> }>(`SELECT id::text, payload FROM ${outbox}.outbox WHERE aggregate_id = $1 AND event_type = $2`, [orderId, type]);
    return { outbox, id: r.id, type, aggregateId: orderId, payload: r.payload, createdAt: new Date(), attempt: 1 };
  };

  it('FR-GAM-05 FR-GAM-07 FR-GAM-10 the buyer accepts the disclosure and registers the browser\'s key; only then is payment taken, and the seller is asked for the credentials', async () => {
    const [seller, buyer] = [await member(), await member()];
    const listingId = await listing(seller.userId);
    const r = await buyer.call('POST', '/orders', { listingId, quantity: 1 });
    expect(r.status).toBe(201);
    const order = (await r.json()) as { id: string; fulfilment: string; deliveryFee: string; total: string };
    expect(order).toMatchObject({ fulfilment: 'game_account', deliveryFee: '0', total: '400000' }); // FR-GAM-06: no delivery fee

    expect(await errors(await buyer.call('POST', `/orders/${order.id}/payments`, { provider: 'bkash' }))).toEqual([{ field: 'game', reason: 'checkout-not-ready' }]);
    expect(await errors(await buyer.call('POST', `/orders/${order.id}/game/key`, { publicKey: await browserKey() }))).toEqual([{ field: 'disclosure', reason: 'not-acknowledged' }]);
    expect(await errors(await buyer.call('POST', `/orders/${order.id}/game/acknowledge`, { version: DISCLOSURE_VERSION + 1 }))).toEqual([{ field: 'version', reason: 'not-current' }]);
    expect((await seller.call('POST', `/orders/${order.id}/game/acknowledge`, { version: DISCLOSURE_VERSION })).status).toBe(403); // the buyer's
    const ack = await buyer.call('POST', `/orders/${order.id}/game/acknowledge`, { version: DISCLOSURE_VERSION });
    expect([ack.status, await ack.json()]).toEqual([200, expect.objectContaining({ status: 'preparing', keyVersion: 0, disclosure: { currentVersion: 1, acknowledgedVersion: 1, acknowledgedAt: expect.any(String) } })]);
    expect((await buyer.call('POST', `/orders/${order.id}/game/acknowledge`, { version: DISCLOSURE_VERSION })).status).toBe(200); // again: harmless
    expect(await errors(await buyer.call('POST', `/orders/${order.id}/payments`, { provider: 'bkash' }))).toEqual([{ field: 'game', reason: 'checkout-not-ready' }]); // no key yet

    const notOnCurve = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64url');
    expect(await errors(await buyer.call('POST', `/orders/${order.id}/game/key`, { publicKey: notOnCurve }))).toEqual([{ field: 'publicKey', reason: 'not-a-p256-point' }]);
    const key = await buyer.call('POST', `/orders/${order.id}/game/key`, { publicKey: await browserKey() });
    expect([key.status, key.headers.get('cache-control'), await key.json()]).toEqual([201, 'no-store', { keyVersion: 1 }]);
    expect(await errors(await buyer.call('POST', `/orders/${order.id}/game/key`, { publicKey: await browserKey() }))).toEqual([{ field: 'publicKey', reason: 'key-fixed' }]);
    expect(await fx.query(`SELECT version, session_id FROM game_accounts.buyer_keys WHERE order_id = $1`, [order.id])).toEqual([{ version: 1, session_id: buyer.sessionId }]);

    const p = await buyer.call('POST', `/orders/${order.id}/payments`, { provider: 'bkash' }, { 'idempotency-key': randomUUID() });
    expect(p.status).toBe(201);
    await pay(((await p.json()) as { redirectUrl: string }).redirectUrl);
    const paid = await outboxEvent('orders', order.id, 'orders.order.paid');
    expect(paid.payload).toMatchObject({ itemKind: 'game_account', fulfilmentStep: 'credentials_delivered', fulfilmentDueAt: expect.any(String) });
    await consume('game_accounts.handover', paid);
    await consume('game_accounts.handover', paid); // redelivered: no change
    const view = (await (await seller.call('GET', `/orders/${order.id}/game`)).json()) as Record<string, unknown>;
    expect(view).toMatchObject({ role: 'seller', status: 'awaiting_credentials', keyVersion: 1, credentialsDueAt: paid.payload.fulfilmentDueAt });
    expect(JSON.stringify(view)).not.toMatch(/publicKey|fingerprint/); // the server never shows a key or a fingerprint
    expect((await outboxEvent('game_accounts', order.id, 'game_accounts.credentials.requested')).payload).toEqual({ dueAt: expect.any(String) });
    expect(await fx.query(`SELECT order_id FROM game_accounts.claims WHERE listing_id = $1`, [listingId])).toEqual([{ order_id: order.id }]);
    expect((await (await member()).call('GET', `/orders/${order.id}/game`)).status).toBe(404);
  });

  it('FR-GAM-07 an order cancelled before payment cancels its handover; its key can no longer be set', async () => {
    const [seller, buyer] = [await member(), await member()];
    const listingId = await listing(seller.userId);
    const order = (await (await buyer.call('POST', '/orders', { listingId, quantity: 1 })).json()) as { id: string };
    await buyer.call('POST', `/orders/${order.id}/game/acknowledge`, { version: DISCLOSURE_VERSION });
    await consume('game_accounts.handover', { outbox: 'orders', id: '1', type: 'orders.order.cancelled', aggregateId: order.id, payload: { orderId: order.id, reason: 'payment_window_expired' }, createdAt: new Date(), attempt: 1 });
    expect(await fx.query(`SELECT status, cancelled_at IS NOT NULL AS cancelled FROM game_accounts.handovers WHERE order_id = $1`, [order.id])).toEqual([{ status: 'cancelled', cancelled: true }]);
    expect(await errors(await buyer.call('POST', `/orders/${order.id}/game/key`, { publicKey: await browserKey() }))).toEqual([{ field: 'publicKey', reason: 'key-fixed' }]);
  });
});
