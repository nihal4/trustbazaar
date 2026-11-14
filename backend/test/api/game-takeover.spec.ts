import { randomInt, randomUUID } from 'crypto';
import { EventBus, OutboxEvent } from '../../src/kernel/events/event-bus';
import { DISCLOSURE_VERSION, GAME_ACCOUNT_COMMANDS, GAME_ACCOUNT_QUERIES, GameAccountCommands, GameAccountQueries } from '../../src/modules/game-accounts/ports';
import { DataSource } from 'typeorm';
import { startApp, TestApp } from '../support/app';
import { IdentityFixtures } from '../support/identity';
import { b64, BuyerKey, generateBuyerKey, open, seal, unb64 } from '../support/sealed';

// U5-04: the takeover (docs/design/05_game_accounts.pdf sections 6.6 and 7; FR-GAM-12 to FR-GAM-16), against
// PostgreSQL through the real security pipeline, with the mock payment provider and real sealing (test/support/sealed.ts).
// Events are handed to their consumers as the outbox dispatcher would.
describe('the takeover: checklist, completion and protection, re-key, report', () => {
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
      [`takeover-${randomUUID().slice(0, 8)}`],
    );
    [{ id: gameId }] = await fx.query<{ id: number }>(
      `INSERT INTO game_accounts.games (slug, name, platforms, code_placement, publisher_note) VALUES ($1, 'eFootball', '{android,ios}', 'the bio', 'Transfers break the terms.') RETURNING id`,
      [`ef2-${randomUUID().slice(0, 8)}`],
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
  type Member = Awaited<ReturnType<typeof member>>;
  const consume = (e: OutboxEvent) => bus.consumersOf(e.type).find((c) => c.name === 'game_accounts.handover')!.handler(e);
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
    await fx.query(`INSERT INTO game_accounts.details (listing_id, seller_id, game_id, platform, player_id, contents) VALUES ($1, $2, $3, 'ios', $4, 'Division 1, three epic players.')`, [listingId, seller.userId, gameId, player]);
    await fx.query(`UPDATE listings.listings SET status = 'active', published_at = now() WHERE id = $1`, [listingId]);
    await fx.query(`INSERT INTO game_accounts.claims (game_id, player_id_norm, listing_id) VALUES ($1, $2, $3)`, [gameId, player, listingId]);
    const { id: orderId } = (await (await buyer.call('POST', '/orders', { listingId, quantity: 1 })).json()) as { id: string };
    await buyer.call('POST', `/orders/${orderId}/game/acknowledge`, { version: DISCLOSURE_VERSION });
    const key = await generateBuyerKey();
    expect((await buyer.call('POST', `/orders/${orderId}/game/key`, { publicKey: b64(key.publicRaw) })).status).toBe(201);
    const p = (await (await buyer.call('POST', `/orders/${orderId}/payments`, { provider: 'bkash' }, { 'idempotency-key': randomUUID() })).json()) as { redirectUrl: string };
    const page = new URL(p.redirectUrl);
    const form = await fetch(t.url(page.pathname.replace('/api/v1', '') + page.search), {
      method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'outcome=succeeded',
    });
    const cb = new URL(form.headers.get('location')!);
    await fetch(t.url(cb.pathname.replace('/api/v1', '') + cb.search), { redirect: 'manual' });
    const [paid] = await fx.query<{ id: string; payload: Record<string, unknown> }>(`SELECT id::text, payload FROM orders.outbox WHERE aggregate_id = $1 AND event_type = 'orders.order.paid'`, [orderId]);
    await consume({ outbox: 'orders', id: paid.id, type: 'orders.order.paid', aggregateId: orderId, payload: paid.payload, createdAt: new Date(), attempt: 1 });
    return { seller, buyer, orderId, listingId, key };
  }
  const notices = (userId: string, code: string) => fx.query<{ params: Record<string, unknown> }>(`SELECT params FROM notify.notifications WHERE user_id = $1 AND template_code = $2`, [userId, code]);
  const credentials = { loginId: 'player@example.com', password: 'Correct-Horse-Battery-9', recovery: ['8F2K-11QX', '9Z3M-22RW'], note: 'Linked to no phone.' };

  /** A paid order with the credentials delivered for the buyer's key. */
  async function delivered() {
    const o = await paidOrder();
    const sealed = await seal(o.key.publicRaw, o.orderId, 1, credentials);
    expect((await o.seller.call('POST', `/orders/${o.orderId}/game/sealed`, { keyVersion: 1, enc: b64(sealed.enc), ciphertext: b64(sealed.ciphertext) })).status).toBe(201);
    return o;
  }
  const step = (b: Member, orderId: string, s: string) => b.call('POST', `/orders/${orderId}/game/takeover-steps/${s}`);

  it('FR-GAM-13 FR-GAM-15 FR-GAM-16 the buyer confirms the five steps once each; ten simultaneous last confirmations give one completion, Unit 2\'s delivery event and the protection period', async () => {
    const { seller, buyer, orderId } = await delivered();
    const first = await step(buyer, orderId, 'password');
    expect([first.status, await first.json()]).toEqual([200, { step: 'password', takenOverAt: null }]);
    const [{ at }] = await fx.query<{ at: Date }>(`SELECT at FROM game_accounts.confirmations WHERE order_id = $1 AND step = 'password'`, [orderId]);
    expect((await step(buyer, orderId, 'password')).status).toBe(200); // again: the first time stays
    expect(await fx.query(`SELECT at, session_id FROM game_accounts.confirmations WHERE order_id = $1`, [orderId])).toEqual([{ at, session_id: buyer.sessionId }]);
    expect((await step(seller, orderId, 'recovery_email')).status).toBe(403);
    expect((await step(buyer, orderId, 'nothing')).status).toBe(404);
    for (const s of ['recovery_email', 'recovery_phone', 'social_logins']) expect((await step(buyer, orderId, s)).status).toBe(200);

    const last = await Promise.all(Array.from({ length: 10 }, () => step(buyer, orderId, 'two_step')));
    expect(last.map((r) => r.status).sort()).toEqual([200, ...Array(9).fill(409)]);
    const view = (await (await buyer.call('GET', `/orders/${orderId}/game`)).json()) as { status: string; takenOverAt: string; takeoverSource: string; protectionEndsAt: string; steps: Record<string, string | null> };
    expect(view).toMatchObject({ status: 'taken_over', takeoverSource: 'checklist' });
    expect(Object.values(view.steps).every((v) => typeof v === 'string')).toBe(true);
    expect(Date.parse(view.protectionEndsAt) - Date.parse(view.takenOverAt)).toBe(7 * 86_400_000); // CP-24
    expect(await fx.query(`SELECT delivery_event_source FROM orders.orders WHERE id = $1`, [orderId])).toEqual([{ delivery_event_source: 'game_takeover' }]);
    expect(await fx.query(`SELECT event_type FROM game_accounts.outbox WHERE aggregate_id = $1 AND event_type = 'game_accounts.takeover.completed'`, [orderId])).toHaveLength(1);
    for (const u of [buyer, seller]) expect(await notices(u.userId, 'game.takeover_completed')).toEqual([{ params: { listing_title: 'eFootball account, division 1', days: 7 } }]);
  });

  it('FR-GAM-14 the report waits for Unit 7\'s game-account disputes (U7-10) and changes nothing; after the recovery e-mail step it is refused', async () => {
    const { buyer, orderId } = await delivered();
    const r = await buyer.call('POST', `/orders/${orderId}/game/report-invalid`, {});
    expect([r.status, await errors(r)]).toEqual([409, [{ field: 'type', reason: 'game-account-disputes-not-yet-available' }]]);
    expect(await fx.query(`SELECT status FROM game_accounts.handovers WHERE order_id = $1`, [orderId])).toEqual([{ status: 'delivered' }]); // rolled back with the dispute
    const queries = t.app.get<GameAccountQueries>(GAME_ACCOUNT_QUERIES);
    expect(await queries.credentialsInvalidAllowed(orderId)).toBe(true);
    await step(buyer, orderId, 'recovery_email');
    expect(await queries.credentialsInvalidAllowed(orderId)).toBe(false);
    expect(await errors(await buyer.call('POST', `/orders/${orderId}/game/report-invalid`, {}))).toEqual([{ field: 'handover', reason: 'recovery-email-confirmed' }]);
    expect((await buyer.call('POST', `/orders/${orderId}/game/report-invalid`, { description: 'short' })).status).toBe(400);
  });

  it('FR-GAM-12 one re-key: the window stops, the seller seals again for the new key, the old ciphertext goes and a new window starts; a second re-key is refused', async () => {
    const { seller, buyer, orderId } = await delivered();
    const fresh = await generateBuyerKey();
    const r = await buyer.call('POST', `/orders/${orderId}/game/rekey`, { publicKey: b64(fresh.publicRaw) });
    expect([r.status, await r.json()]).toEqual([201, { keyVersion: 2, redeliveryDueAt: expect.any(String) }]);
    expect(await (await buyer.call('GET', `/orders/${orderId}/game`)).json()).toMatchObject({ status: 'rekey_requested', keyVersion: 2, rekeysUsed: 1, takeoverDueAt: null, rekeyDueAt: expect.any(String) });
    expect(await notices(seller.userId, 'game.rekey_requested')).toEqual([{ params: { listing_title: 'eFootball account, division 1', hours: 24 } }]);
    expect(await errors(await step(buyer, orderId, 'password'))).toEqual([{ field: 'handover', reason: 'takeover-not-in-progress' }]); // the window has stopped

    const k = (await (await seller.call('GET', `/orders/${orderId}/game/buyer-key`)).json()) as { keyVersion: number; publicKey: string };
    expect(k).toEqual({ keyVersion: 2, publicKey: b64(fresh.publicRaw) });
    const again = await seal(unb64(k.publicKey), orderId, 2, credentials);
    expect((await seller.call('POST', `/orders/${orderId}/game/sealed`, { keyVersion: 2, enc: b64(again.enc), ciphertext: b64(again.ciphertext) })).status).toBe(201);
    expect(await fx.query(`SELECT key_version, ciphertext IS NULL AS deleted FROM game_accounts.sealed_credentials WHERE order_id = $1 ORDER BY key_version`, [orderId]))
      .toEqual([{ key_version: 1, deleted: true }, { key_version: 2, deleted: false }]);
    const got = (await (await buyer.call('GET', `/orders/${orderId}/game/sealed`)).json()) as { keyVersion: number; enc: string; ciphertext: string };
    expect(await open(fresh.pair, orderId, got.keyVersion, unb64(got.enc), unb64(got.ciphertext))).toEqual(credentials);
    expect(await (await buyer.call('GET', `/orders/${orderId}/game`)).json()).toMatchObject({ status: 'delivered', takeoverDueAt: expect.any(String) });
    expect(await errors(await buyer.call('POST', `/orders/${orderId}/game/rekey`, { publicKey: b64((await generateBuyerKey()).publicRaw) }))).toEqual([{ field: 'handover', reason: 'rekey-used' }]);
  });

  it('FR-DSP-10 a withdrawn credentials_invalid dispute resumes the takeover (Unit 7\'s port)', async () => {
    const { buyer, orderId } = await delivered();
    await fx.query(`UPDATE game_accounts.handovers SET status = 'disputed', disputed_at = now() WHERE order_id = $1`, [orderId]); // as a report would (U7-10)
    expect(await errors(await step(buyer, orderId, 'password'))).toEqual([{ field: 'handover', reason: 'takeover-not-in-progress' }]);
    const commands = t.app.get<GameAccountCommands>(GAME_ACCOUNT_COMMANDS);
    await t.app.get(DataSource).transaction((m) => commands.disputeWithdrawn(orderId, m));
    expect(await fx.query(`SELECT status FROM game_accounts.handovers WHERE order_id = $1`, [orderId])).toEqual([{ status: 'delivered' }]);
    expect((await step(buyer, orderId, 'password')).status).toBe(200);
    await expect(t.app.get(DataSource).transaction((m) => commands.disputeWithdrawn(orderId, m))).rejects.toMatchObject({ problem: 'order-state' });
  });
});
