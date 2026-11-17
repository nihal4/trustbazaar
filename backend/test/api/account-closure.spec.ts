import { randomBytes, randomInt, randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { join } from 'path';
import { config } from '../../src/kernel/config/config';
import { EventBus, OutboxEvent } from '../../src/kernel/events/event-bus';
import { ClosureService } from '../../src/modules/identity/services/closure.service';
import { startApp, TestApp } from '../support/app';
import { IdentityFixtures } from '../support/identity';

// U1-09, first part: account closure and erasure (docs/design/01_identity_access.pdf section 6.10; FR-ACC-11,
// FR-PRV-04), against PostgreSQL and Redis: the step-up, every unit's blocking reasons, the closed account, the
// listings ended by Listings' consumer, and the daily erasure with its holds and the crypto-shredding of KYC files.
describe('account closure and erasure', () => {
  let t: TestApp;
  let fx: IdentityFixtures;
  let closure: ClosureService;
  let category: number;

  beforeAll(async () => {
    t = await startApp();
    fx = await IdentityFixtures.open();
    closure = t.app.get(ClosureService);
    [{ id: category }] = await fx.query<{ id: number }>(`INSERT INTO listings.categories (slug, name_en, name_bn, item_kind) VALUES ($1, 'c', 'বি', 'physical') RETURNING id`, [`close-${randomUUID().slice(0, 8)}`]);
  });
  afterAll(async () => {
    await fx?.close();
    await t?.close();
  });

  async function member() {
    const userId = await fx.user({ kyc: 'verified' });
    const sid = await fx.session({ userId });
    const ip = `203.0.113.${randomInt(1, 255)}, 10.4.${randomInt(0, 255)}.${randomInt(1, 255)}`;
    const call = async (method: string, path: string, stepUp = false) =>
      fetch(t.url(path), {
        method,
        headers: { ...fx.headers(sid, userId, 'user'), 'x-forwarded-for': ip, ...(stepUp ? { 'x-step-up': await fx.stepUpGrant(sid, 'account.close') } : {}) },
      });
    return { userId, sid, close: () => call('POST', '/me/close', true), call };
  }
  const row = async <T = Record<string, unknown>>(sql: string, p: unknown[]) => (await fx.query<T>(sql, p))[0];
  async function listing(sellerId: string, o: { status?: string; format?: 'fixed_price' | 'auction' } = {}) {
    const [{ id }] = await fx.query<{ id: string }>(
      `INSERT INTO listings.listings (seller_id, item_kind, sale_format, category_id, title, description, condition, no_visible_defects,
          fulfilment_options, area_district, approx_lat, approx_lng, price, quantity_total, quantity_available)
       VALUES ($1, 'physical', $3, $2, 'Lamp of a closing seller', 'A lamp listed by a seller who closes the account.', 'used', true,
          'pickup_only', 'Dhaka', 23.81, 90.41, $4, 1, 1) RETURNING id`,
      [sellerId, category, o.format ?? 'fixed_price', o.format === 'auction' ? null : 100000],
    );
    for (const n of [1, 2]) await fx.query(`INSERT INTO listings.listing_photos (listing_id, position, storage_key, width, height) VALUES ($1, $2, $3, 1, 1)`, [id, n, randomBytes(16).toString('hex')]);
    if ((o.status ?? 'active') !== 'draft') await fx.query(`UPDATE listings.listings SET status = 'active', published_at = now() WHERE id = $1`, [id]);
    if (o.status && o.status !== 'active' && o.status !== 'draft') await fx.query(`UPDATE listings.listings SET status = $2 WHERE id = $1`, [id, o.status]);
    return id;
  }
  /** Delivers the latest identity.account.closed of a user to a consumer, as the dispatcher would. */
  async function deliverClosed(userId: string, consumer: string) {
    const e = await row<{ id: string; payload: Record<string, unknown>; created_at: Date }>(
      `SELECT id::text, payload, created_at FROM identity.outbox WHERE event_type = 'identity.account.closed' AND aggregate_id = $1 ORDER BY id DESC LIMIT 1`, [userId]);
    const c = t.app.get(EventBus).consumersOf('identity.account.closed').find((x) => x.name === consumer)!;
    await c.handler({ outbox: 'identity', id: e.id, type: 'identity.account.closed', aggregateId: userId, payload: e.payload, createdAt: e.created_at, attempt: 1 } as OutboxEvent);
  }

  it('FR-ACC-11 closing needs a step-up; it closes the account, ends every session and the listings go', async () => {
    const u = await member();
    expect((await u.call('POST', '/me/close')).status).toBe(403);
    const active = await listing(u.userId);
    const draft = await listing(u.userId, { status: 'draft' });
    const ended = await listing(u.userId, { status: 'ended_unsold' });
    const r = await u.close();
    expect(r.status).toBe(204);
    expect(r.headers.get('set-cookie')).toContain('__Host-tb_at=;');
    const user = await row<{ account_status: string; closed_at: Date; erase_after: Date }>(`SELECT account_status, closed_at, erase_after FROM identity.users WHERE id = $1`, [u.userId]);
    expect(user.account_status).toBe('closed');
    expect(Math.round((user.erase_after.getTime() - user.closed_at.getTime()) / 86_400_000)).toBe(30); // CP-41
    expect(await row(`SELECT count(*)::int AS n FROM identity.sessions WHERE user_id = $1 AND ended_at IS NULL`, [u.userId])).toEqual({ n: 0 });
    expect(await row(`SELECT end_reason FROM identity.sessions WHERE id = $1`, [u.sid])).toEqual({ end_reason: 'closed' });
    expect((await u.call('GET', '/me')).status).toBe(401);
    expect(await row(`SELECT action FROM audit.events WHERE object_id = $1 AND action = 'identity.account.closed'`, [u.userId])).toBeDefined();

    await deliverClosed(u.userId, 'listings.closure');
    const statuses = await fx.query<{ id: string; status: string }>(`SELECT id, status FROM listings.listings WHERE id = ANY($1::uuid[])`, [[active, draft, ended]]);
    expect(Object.fromEntries(statuses.map((s) => [s.id, s.status]))).toEqual({ [active]: 'cancelled', [draft]: 'cancelled', [ended]: 'ended_unsold' });
    expect(await row(`SELECT reason FROM listings.status_history WHERE listing_id = $1 AND to_status = 'cancelled'`, [active])).toEqual({ reason: 'account closed' });
  });

  it('FR-ACC-11 closure is refused, with every reason, while an order, a leading bid, a dispute or a KYC review is open', async () => {
    const u = await member();
    const other = await fx.user({ kyc: 'verified' });
    const [{ id: orderId }] = await fx.query<{ id: string }>(
      `INSERT INTO orders.orders (kind, listing_id, item_kind, buyer_id, seller_id, quantity, unit_price, item_price, fulfilment, delivery_fee, total,
          listing_snapshot, commission_bps, delivery_margin_bps, params_version, payment_due_at, status)
       VALUES ('fixed_price', $1, 'physical', $2, $3, 1, 100000, 100000, 'self_pickup', 0, 100000, '{"title":"x"}', 500, 1000, 1, now() + interval '1 hour', 'awaiting_payment') RETURNING id`,
      [randomUUID(), u.userId, other],
    );
    const auction = await listing(other, { format: 'auction' });
    await fx.query(`INSERT INTO auctions.auctions (listing_id, seller_id, start_price, inc_bps, inc_min, snipe_window, snipe_extension, starts_at, original_end_at, end_at, leader_id, leader_max, current_price, bid_count)
                    VALUES ($1, $3, 10000, 200, 5000, '2 minutes', '2 minutes', now() - interval '1 hour', now() + interval '1 day', now() + interval '1 day', $2, 20000, 10000, 1)`, [auction, u.userId, other]);
    await fx.query(`INSERT INTO identity.kyc_submissions (user_id, doc_type, doc_number_enc, doc_number_bidx, full_name_enc, dob_enc, key_version, is_adult, liveness_action)
                    VALUES ($1, 'nid', '\\x01', $2, '\\x01', '\\x01', 1, true, 'blink')`, [u.userId, randomBytes(32)]);
    const r = await u.close();
    const body = await r.json();
    expect(r.status).toBe(409);
    expect(body.type).toBe('/problems/account-not-closable');
    expect(body.errors.map((e: { reason: string }) => e.reason)).toEqual(['kyc-under-review', 'leading-bid', 'open-order']);
    expect(await row(`SELECT account_status FROM identity.users WHERE id = $1`, [u.userId])).toEqual({ account_status: 'active' });

    // the seller of an auction with bids, and a party to an open dispute
    expect(await closure.blockers(other, 'closure')).toEqual(['auction-with-bids', 'open-order']);
    await fx.query(`INSERT INTO disputes.disputes (order_id, buyer_id, seller_id, item_kind, type, description, item_price, amount_collected, seller_due_at)
                    VALUES ($1, $2, $3, 'physical', 'not_as_described', 'The lamp does not work at all.', 100000, 100000, now() + interval '2 days')`, [orderId, u.userId, other]);
    expect(await closure.blockers(other, 'erasure')).toEqual(['auction-with-bids', 'open-dispute', 'open-order']);
  });

  it('FR-PRV-04 the erasure job erases closed accounts past CP-41, crypto-shreds their KYC and deletes the files', async () => {
    const u = await fx.user({ kyc: 'verified' });
    const sub = await row<{ id: string }>(`INSERT INTO identity.kyc_submissions (user_id, doc_type, doc_number_enc, doc_number_bidx, full_name_enc, dob_enc, key_version, is_adult, liveness_action, status, decided_by, decided_at)
                    VALUES ($1, 'nid', '\\x01', $2, '\\x01', '\\x01', 1, true, 'blink', 'approved', $3, now()) RETURNING id`, [u, randomBytes(32), await fx.staff('operator')]);
    const key = randomBytes(24).toString('hex');
    await fx.query(`INSERT INTO identity.kyc_files (submission_id, kind, storage_key, wrapped_dek, key_version, sha256, mime, byte_size) VALUES ($1, 'doc_front', $2, '\\x01', 1, $3, 'image/jpeg', 10)`,
      [sub.id, key, randomBytes(32)]);
    const file = join(config().filesRoot, 'kyc', key);
    await fs.mkdir(join(config().filesRoot, 'kyc'), { recursive: true });
    await fs.writeFile(file, 'sealed');
    await fx.query(`UPDATE identity.users SET account_status = 'closed', closed_at = now() - interval '31 days', erase_after = now() - interval '1 day' WHERE id = $1`, [u]);
    // another closed account with a payout still to be sent is held, not erased
    const heldUser = await fx.user({ kyc: 'verified' });
    await fx.query(`UPDATE identity.users SET account_status = 'closed', closed_at = now() - interval '31 days', erase_after = now() - interval '1 day' WHERE id = $1`, [heldUser]);
    const buyer = await fx.user({ kyc: 'verified' });
    const [{ id: orderId }] = await fx.query<{ id: string }>(
      `INSERT INTO orders.orders (kind, listing_id, item_kind, buyer_id, seller_id, quantity, unit_price, item_price, fulfilment, delivery_fee, total,
          listing_snapshot, commission_bps, delivery_margin_bps, params_version, payment_due_at, status, paid_at, fulfilment_step, fulfilment_due_at, closed_at)
       VALUES ('fixed_price', $1, 'physical', $2, $3, 1, 100000, 100000, 'self_pickup', 0, 100000, '{"title":"x"}', 500, 1000, 1, now(), 'closed', now(), 'meetup_handover', now(), now()) RETURNING id`,
      [randomUUID(), buyer, heldUser],
    );
    await fx.query(`INSERT INTO payments.payouts (order_id, seller_id, amount, status, hold_reason, simulated) VALUES ($1, $2, 95000, 'held', 'fraud review', true)`, [orderId, heldUser]);
    expect(await closure.blockers(heldUser, 'erasure')).toEqual(['payout-pending']);
    expect(await closure.blockers(heldUser, 'closure')).toEqual([]);
    const run = await closure.eraseDue();
    expect(run.erased).toBeGreaterThanOrEqual(1);
    expect(run.held).toBeGreaterThanOrEqual(1);
    expect(await row(`SELECT erased_at FROM identity.users WHERE id = $1`, [heldUser])).toEqual({ erased_at: null });
    expect(await row(`SELECT display_name, phone_e164, email, password_hash, erased_at IS NOT NULL AS erased FROM identity.users WHERE id = $1`, [u])).toEqual({
      display_name: 'Deleted user', phone_e164: null, email: null, password_hash: null, erased: true,
    });
    expect(await row(`SELECT wrapped_dek, erased_at IS NOT NULL AS erased FROM identity.kyc_files WHERE storage_key = $1`, [key])).toEqual({ wrapped_dek: null, erased: true });
    await expect(fs.stat(file)).rejects.toThrow();
    expect(await row(`SELECT action FROM audit.events WHERE object_id = $1 AND action = 'identity.account.erased'`, [u])).toBeDefined();
  });
});
