import { randomInt, randomUUID } from 'crypto';
import { EventBus, OutboxEvent } from '../../src/kernel/events/event-bus';
import { DISCLOSURE_VERSION } from '../../src/modules/game-accounts/ports';
import { startApp, TestApp } from '../support/app';
import { IdentityFixtures } from '../support/identity';
import { b64, BuyerKey, generateBuyerKey, open, seal, unb64 } from '../support/sealed';

// U5-03, second part: the sealed handover (docs/design/05_game_accounts.pdf section 6; FR-GAM-09 to FR-GAM-11,
// FR-GAM-19, SEC-GAM-01, SEC-GAM-02), against PostgreSQL through the real security pipeline, with the mock payment
// provider. The credentials are sealed and opened for real, as sealed.js does it in the browsers (test/support/sealed.ts):
// the server stores and returns only what it cannot open. Events are handed to their consumers as the dispatcher would.
describe('the sealed handover: delivery, logged retrieval and the end of the handover', () => {
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
      [`handover-${randomUUID().slice(0, 8)}`],
    );
    [{ id: gameId }] = await fx.query<{ id: number }>(
      `INSERT INTO game_accounts.games (slug, name, platforms, code_placement, publisher_note) VALUES ($1, 'eFootball', '{android,ios}', 'the bio', 'Transfers break the terms.') RETURNING id`,
      [`ef-${randomUUID().slice(0, 8)}`],
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
    const call = (method: string, path: string, body?: unknown, extra: Record<string, string> = {}) =>
      fetch(t.url(path), {
        method,
        headers: { ...headers, ...extra, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    return { userId, sessionId, call };
  }
  type Member = Awaited<ReturnType<typeof member>>;
  const consume = (e: OutboxEvent) =>
    bus
      .consumersOf(e.type)
      .find((c) => c.name === 'game_accounts.handover')!
      .handler(e);
  const errors = async (r: Response) => ((await r.json()) as { errors?: unknown[] }).errors;

  /** A paid game-account order: the listing approved, the disclosure and the buyer's key, the mock payment, the request for credentials. */
  async function paidOrder(): Promise<{ seller: Member; buyer: Member; orderId: string; listingId: string; key: BuyerKey }> {
    const [seller, buyer] = [await member(), await member()];
    const [{ id: listingId }] = await fx.query<{ id: string }>(
      `INSERT INTO listings.listings (seller_id, item_kind, sale_format, category_id, title, description, price, quantity_total, quantity_available)
       VALUES ($1, 'game_account', 'fixed_price', $2, 'eFootball account, division 1', 'A division-1 account, written by the handover tests.', 250000, 1, 1) RETURNING id`,
      [seller.userId, category],
    );
    const player = String(randomInt(10_000_000, 99_999_999));
    await fx.query(
      `INSERT INTO game_accounts.details (listing_id, seller_id, game_id, platform, player_id, contents) VALUES ($1, $2, $3, 'ios', $4, 'Division 1, three epic players.')`,
      [listingId, seller.userId, gameId, player],
    );
    await fx.query(`UPDATE listings.listings SET status = 'active', published_at = now() WHERE id = $1`, [listingId]);
    await fx.query(`INSERT INTO game_accounts.claims (game_id, player_id_norm, listing_id) VALUES ($1, $2, $3)`, [gameId, player, listingId]);
    const { id: orderId } = (await (await buyer.call('POST', '/orders', { listingId, quantity: 1 })).json()) as { id: string };
    await buyer.call('POST', `/orders/${orderId}/game/acknowledge`, { version: DISCLOSURE_VERSION });
    const key = await generateBuyerKey();
    expect((await buyer.call('POST', `/orders/${orderId}/game/key`, { publicKey: b64(key.publicRaw) })).status).toBe(201);
    const p = (await (await buyer.call('POST', `/orders/${orderId}/payments`, { provider: 'bkash' }, { 'idempotency-key': randomUUID() })).json()) as {
      redirectUrl: string;
    };
    const page = new URL(p.redirectUrl);
    const form = await fetch(t.url(page.pathname.replace('/api/v1', '') + page.search), {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'outcome=succeeded',
    });
    const cb = new URL(form.headers.get('location')!);
    await fetch(t.url(cb.pathname.replace('/api/v1', '') + cb.search), { redirect: 'manual' });
    const [paid] = await fx.query<{ id: string; payload: Record<string, unknown> }>(
      `SELECT id::text, payload FROM orders.outbox WHERE aggregate_id = $1 AND event_type = 'orders.order.paid'`,
      [orderId],
    );
    await consume({ outbox: 'orders', id: paid.id, type: 'orders.order.paid', aggregateId: orderId, payload: paid.payload, createdAt: new Date(), attempt: 1 });
    return { seller, buyer, orderId, listingId, key };
  }
  const notices = (userId: string, code: string) =>
    fx.query<{ params: Record<string, unknown> }>(`SELECT params FROM notify.notifications WHERE user_id = $1 AND template_code = $2`, [userId, code]);
  const credentials = { loginId: 'player@example.com', password: 'Correct-Horse-Battery-9', recovery: ['8F2K-11QX', '9Z3M-22RW'], note: 'Linked to no phone.' };

  it("FR-GAM-09 FR-GAM-10 SEC-GAM-01 the seller seals the credentials for the buyer's current key; ten simultaneous deliveries store one; the first is Unit 2's fulfilment step", async () => {
    const { seller, buyer, orderId, key } = await paidOrder();
    expect(await notices(seller.userId, 'game.credentials_requested')).toEqual([{ params: { listing_title: 'eFootball account, division 1', hours: 24 } }]);
    expect((await buyer.call('GET', `/orders/${orderId}/game/buyer-key`)).status).toBe(403);
    const k = await seller.call('GET', `/orders/${orderId}/game/buyer-key`);
    const { keyVersion, publicKey } = (await k.json()) as { keyVersion: number; publicKey: string };
    expect([k.headers.get('cache-control'), keyVersion, publicKey]).toEqual(['no-store', 1, b64(key.publicRaw)]);

    const sealed = await seal(unb64(publicKey), orderId, keyVersion, credentials);
    expect(sealed.ciphertext.length).toBe(528); // one 512-byte block and the tag (DV-34)
    const short = await seal(unb64(publicKey), orderId, keyVersion, { ...credentials, password: 'abcde' });
    expect(short.ciphertext.length).toBe(sealed.ciphertext.length); // the password's length does not show
    expect(
      await errors(
        await seller.call('POST', `/orders/${orderId}/game/sealed`, {
          keyVersion: 1,
          enc: b64(sealed.enc),
          ciphertext: b64(new Uint8Array([...sealed.ciphertext, ...new Uint8Array(72)])),
        }),
      ),
    ) // 600 bytes: not 512 k + 16
      .toEqual([{ field: 'ciphertext', reason: 'not-padded' }]);
    expect(
      await errors(await seller.call('POST', `/orders/${orderId}/game/sealed`, { keyVersion: 2, enc: b64(sealed.enc), ciphertext: b64(sealed.ciphertext) })),
    ).toEqual([{ field: 'keyVersion', reason: 'stale-key-version' }]);
    expect(
      (await buyer.call('POST', `/orders/${orderId}/game/sealed`, { keyVersion: 1, enc: b64(sealed.enc), ciphertext: b64(sealed.ciphertext) })).status,
    ).toBe(403);

    const tries = await Promise.all(
      Array.from({ length: 10 }, () =>
        seller.call('POST', `/orders/${orderId}/game/sealed`, { keyVersion: 1, enc: b64(sealed.enc), ciphertext: b64(sealed.ciphertext) }),
      ),
    );
    expect(tries.map((r) => r.status).sort()).toEqual([201, ...Array(9).fill(409)]);
    expect(await fx.query(`SELECT count(*)::int AS n FROM game_accounts.sealed_credentials WHERE order_id = $1`, [orderId])).toEqual([{ n: 1 }]);
    expect(await fx.query(`SELECT fulfilment_done_at IS NOT NULL AS step FROM orders.orders WHERE id = $1`, [orderId])).toEqual([{ step: true }]);
    expect(await (await buyer.call('GET', `/orders/${orderId}/game`)).json()).toMatchObject({
      status: 'delivered',
      deliveredAt: expect.any(String),
      takeoverDueAt: expect.any(String),
    });
    expect(await notices(buyer.userId, 'game.credentials_delivered')).toEqual([{ params: { listing_title: 'eFootball account, division 1', hours: 24 } }]);
    expect(await errors(await seller.call('GET', `/orders/${orderId}/game/buyer-key`))).toEqual([{ field: 'handover', reason: 'credentials-not-expected' }]);
  });

  it("FR-GAM-11 SEC-GAM-02 only the buyer retrieves them, every retrieval is logged, and they open only in the buyer's browser for this order and key", async () => {
    const { seller, buyer, orderId, key } = await paidOrder();
    expect((await buyer.call('GET', `/orders/${orderId}/game/sealed`)).status).toBe(404); // nothing delivered yet
    const sealed = await seal(key.publicRaw, orderId, 1, credentials);
    expect(
      (await seller.call('POST', `/orders/${orderId}/game/sealed`, { keyVersion: 1, enc: b64(sealed.enc), ciphertext: b64(sealed.ciphertext) })).status,
    ).toBe(201);

    expect((await seller.call('GET', `/orders/${orderId}/game/sealed`)).status).toBe(403);
    expect((await (await member()).call('GET', `/orders/${orderId}/game/sealed`)).status).toBe(404);
    const answers = await Promise.all(Array.from({ length: 3 }, () => buyer.call('GET', `/orders/${orderId}/game/sealed`)));
    expect(answers.map((r) => [r.status, r.headers.get('cache-control')])).toEqual(Array(3).fill([200, 'no-store']));
    const got = (await answers[0].json()) as { keyVersion: number; enc: string; ciphertext: string };
    expect(await open(key.pair, orderId, got.keyVersion, unb64(got.enc), unb64(got.ciphertext))).toEqual(credentials);
    await expect(open(key.pair, randomUUID(), 1, unb64(got.enc), unb64(got.ciphertext))).rejects.toThrow(); // copied to another order
    await expect(open(key.pair, orderId, 2, unb64(got.enc), unb64(got.ciphertext))).rejects.toThrow(); // replayed under another key version
    await expect(open((await generateBuyerKey()).pair, orderId, 1, unb64(got.enc), unb64(got.ciphertext))).rejects.toThrow(); // another browser
    expect(
      await fx.query(`SELECT user_id, session_id, key_version, source_ip IS NOT NULL AS ip FROM game_accounts.access_log WHERE order_id = $1`, [orderId]),
    ).toEqual(Array(3).fill({ user_id: buyer.userId, session_id: buyer.sessionId, key_version: 1, ip: true }));
  });

  it('FR-GAM-19 FR-GAM-04 when the escrow ends the ciphertext is deleted, the handover ends and the player-ID claim is released', async () => {
    const { seller, buyer, orderId, listingId, key } = await paidOrder();
    const sealed = await seal(key.publicRaw, orderId, 1, credentials);
    await seller.call('POST', `/orders/${orderId}/game/sealed`, { keyVersion: 1, enc: b64(sealed.enc), ciphertext: b64(sealed.ciphertext) });
    const refunded: OutboxEvent = {
      outbox: 'orders',
      id: String(randomInt(1, 2 ** 31)),
      type: 'orders.escrow.refunded',
      aggregateId: orderId,
      payload: { orderId },
      createdAt: new Date(),
      attempt: 1,
    };
    await consume(refunded);
    await consume(refunded); // redelivered: no change
    expect(
      await fx.query(`SELECT enc, ciphertext, deleted_at IS NOT NULL AS deleted FROM game_accounts.sealed_credentials WHERE order_id = $1`, [orderId]),
    ).toEqual([{ enc: null, ciphertext: null, deleted: true }]);
    expect(await fx.query(`SELECT status FROM game_accounts.handovers WHERE order_id = $1`, [orderId])).toEqual([{ status: 'cancelled' }]); // never taken over
    expect(await fx.query(`SELECT order_id, release_reason FROM game_accounts.claims WHERE listing_id = $1`, [listingId])).toEqual([
      { order_id: orderId, release_reason: 'escrow_terminal' },
    ]);
    expect((await buyer.call('GET', `/orders/${orderId}/game/sealed`)).status).toBe(404);
    expect(
      await errors(await seller.call('POST', `/orders/${orderId}/game/sealed`, { keyVersion: 1, enc: b64(sealed.enc), ciphertext: b64(sealed.ciphertext) })),
    ).toEqual([{ field: 'handover', reason: 'credentials-not-expected' }]);
  });
});
