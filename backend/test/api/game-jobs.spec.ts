import { randomInt, randomUUID } from 'crypto';
import { EventBus, OutboxEvent } from '../../src/kernel/events/event-bus';
import { DISCLOSURE_VERSION } from '../../src/modules/game-accounts/ports';
import { GameJobsService } from '../../src/modules/game-accounts/services/game-jobs.service';
import { startApp, TestApp } from '../support/app';
import { IdentityFixtures } from '../support/identity';
import { FILE_VAULT as FILE_VAULT_TOKEN } from '../../src/modules/identity/ports';
import { b64, BuyerKey, generateBuyerKey, seal } from '../support/sealed';

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const sharp = require('sharp') as typeof import('sharp').default;

// U5-05: Unit 5's jobs (docs/design/05_game_accounts.pdf section 8; FR-GAM-15, DV-33, DV-37, DV-39, I-63), against
// PostgreSQL, run directly as the job runner would. Orders are paid through the mock provider; credentials are sealed
// for real (test/support/sealed.ts). Deadlines are moved into the past where the test cannot wait for them.
describe('game-account jobs: window end, overdue re-key, code expiry, retention', () => {
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
      [`gjobs-${randomUUID().slice(0, 8)}`],
    );
    [{ id: gameId }] = await fx.query<{ id: number }>(
      `INSERT INTO game_accounts.games (slug, name, platforms, code_placement, publisher_note) VALUES ($1, 'eFootball', '{android,ios}', 'the bio', 'Transfers break the terms.') RETURNING id`,
      [`ef3-${randomUUID().slice(0, 8)}`],
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

  const jobs = () => t.app.get(GameJobsService);

  it('FR-GAM-15 FR-GAM-16 when the window ends without completion or report, the takeover completes at the window\'s end and the protection period starts from it', async () => {
    const { seller, buyer, orderId } = await delivered();
    await buyer.call('POST', `/orders/${orderId}/game/takeover-steps/password`);
    await fx.query(`UPDATE game_accounts.handovers SET takeover_due_at = date_trunc('second', now()) - interval '10 minutes' WHERE order_id = $1`, [orderId]);
    const [{ due }] = await fx.query<{ due: Date }>(`SELECT takeover_due_at AS due FROM game_accounts.handovers WHERE order_id = $1`, [orderId]);
    expect(await jobs().completeDueTakeovers()).toBeGreaterThanOrEqual(1);
    expect(await jobs().completeDueTakeovers()).toBe(0); // nothing left: a second run changes nothing
    expect(await fx.query(`SELECT status, takeover_source, taken_over_at FROM game_accounts.handovers WHERE order_id = $1`, [orderId]))
      .toEqual([{ status: 'taken_over', takeover_source: 'window_end', taken_over_at: due }]); // the window's end, not the job's time
    expect(await fx.query(`SELECT delivery_event_source, delivery_event_at FROM orders.orders WHERE id = $1`, [orderId])).toEqual([{ delivery_event_source: 'game_takeover', delivery_event_at: due }]);
    const [{ release }] = await fx.query<{ release: Date }>(`SELECT auto_release_at AS release FROM orders.escrows WHERE order_id = $1`, [orderId]);
    expect(release.getTime() - due.getTime()).toBe(7 * 86_400_000); // CP-24 from the window's end
    for (const u of [buyer, seller]) expect(await notices(u.userId, 'game.takeover_completed')).toHaveLength(1);
  });

  it('DV-37 an unanswered re-key waits for Unit 7\'s game-account disputes (U7-10): the job leaves it and tries again', async () => {
    const { buyer, orderId } = await delivered();
    expect((await buyer.call('POST', `/orders/${orderId}/game/rekey`, { publicKey: b64((await generateBuyerKey()).publicRaw) })).status).toBe(201);
    await fx.query(`UPDATE game_accounts.handovers SET rekey_due_at = now() - interval '1 minute' WHERE order_id = $1`, [orderId]);
    expect(await jobs().disputeOverdueRekeys()).toBe(0);
    expect(await fx.query(`SELECT status FROM game_accounts.handovers WHERE order_id = $1`, [orderId])).toEqual([{ status: 'rekey_requested' }]); // rolled back with the dispute
    expect(await fx.query(`SELECT 1 FROM game_accounts.outbox WHERE aggregate_id = $1 AND event_type = 'game_accounts.rekey.overdue'`, [orderId])).toEqual([]);
  });

  it('DV-33 issued ownership codes past their validity are marked expired', async () => {
    const { listingId } = await paidOrder();
    const code = `TB-${randomInt(1000, 9999)}-${randomInt(1000, 9999)}`;
    await fx.query(`INSERT INTO game_accounts.ownership_proofs (listing_id, code, issued_at, expires_at) VALUES ($1, $2, now() - interval '8 days', now() - interval '1 day')`, [listingId, code]);
    expect(await jobs().expireCodes()).toBeGreaterThanOrEqual(1);
    expect(await fx.query(`SELECT status FROM game_accounts.ownership_proofs WHERE code = $1`, [code])).toEqual([{ status: 'expired' }]);
  });

  it('I-63 DV-39 at the end of retention the access log of a finished order and its listing\'s screenshot are purged; the records stay', async () => {
    const { seller, buyer, orderId, listingId, key } = await paidOrder();
    // the listing's proof, as approved in U5-02, with its screenshot in Unit 1's FileVault
    const vault = t.app.get<{ store: (f: { purpose: string; ownerId: string; bytes: Uint8Array }) => Promise<{ key: string; sha256: string }> }>(FILE_VAULT_TOKEN);
    const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#333' } }).png().toBuffer();
    const stored = await vault.store({ purpose: 'ownership_proof', ownerId: seller.userId, bytes: new Uint8Array(png) });
    const staffId = await fx.staff('operator');
    await fx.query(
      `INSERT INTO game_accounts.ownership_proofs (listing_id, code, issued_at, expires_at, status) VALUES ($1, $2, now() - interval '1 day', now() + interval '6 days', 'issued')`,
      [listingId, `TB-${randomInt(1000, 9999)}-${randomInt(1000, 9999)}`],
    );
    await fx.query(`UPDATE game_accounts.ownership_proofs SET status = 'submitted', submitted_at = now(), screenshot_key = $2, screenshot_sha256 = decode($3, 'hex') WHERE listing_id = $1 AND status = 'issued'`, [listingId, stored.key, stored.sha256]);
    await fx.query(`UPDATE game_accounts.ownership_proofs SET status = 'approved', reviewed_by = $2, reviewed_at = now(), live_check = 'matched' WHERE listing_id = $1 AND status = 'submitted'`, [listingId, staffId]);
    const sealed = await seal(key.publicRaw, orderId, 1, credentials);
    await seller.call('POST', `/orders/${orderId}/game/sealed`, { keyVersion: 1, enc: b64(sealed.enc), ciphertext: b64(sealed.ciphertext) });
    await buyer.call('GET', `/orders/${orderId}/game/sealed`);
    await consume({ outbox: 'orders', id: String(randomInt(1, 2 ** 31)), type: 'orders.escrow.refunded', aggregateId: orderId, payload: { orderId }, createdAt: new Date(), attempt: 1 });

    expect(await jobs().purge()).toBe(0); // within retention: nothing goes
    expect(await fx.query(`SELECT count(*)::int AS n FROM game_accounts.access_log WHERE order_id = $1`, [orderId])).toEqual([{ n: 1 }]);
    expect(await jobs().purge({ accessLog: '-1 second', soldScreenshot: '-1 second', otherScreenshot: '-1 second' })).toBeGreaterThanOrEqual(1); // as if 2 years had passed
    expect(await fx.query(`SELECT count(*)::int AS n FROM game_accounts.access_log WHERE order_id = $1`, [orderId])).toEqual([{ n: 0 }]);
    expect(await fx.query(`SELECT status, screenshot_key, screenshot_purged_at IS NOT NULL AS purged FROM game_accounts.ownership_proofs WHERE listing_id = $1`, [listingId]))
      .toEqual([{ status: 'approved', screenshot_key: null, purged: true }]);
    expect(await fx.query(`SELECT status FROM game_accounts.handovers WHERE order_id = $1`, [orderId])).toEqual([{ status: 'cancelled' }]); // the handover stays as the record
    await expect(fx.query(`DELETE FROM game_accounts.access_log`)).rejects.toThrow(/permission denied/); // only purge_due deletes
  });
});
