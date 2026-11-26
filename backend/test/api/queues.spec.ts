import { randomInt, randomUUID } from 'crypto';
import type Redis from 'ioredis';
import { REDIS } from '../../src/kernel/redis.provider';
import { NOTIFICATION_PORT } from '../../src/modules/chat/ports';
import type { DirectMessages } from '../../src/modules/chat/services/direct-messages';
import { QueueService } from '../../src/modules/trust/services/queue.service';
import { startApp, TestApp } from '../support/app';
import { IdentityFixtures } from '../support/identity';

// U7-06: the staff console's eight queues (docs/design/07_disputes_trust_staff.pdf section 2.3; FR-OPS-01, FR-DSP-08,
// DV-52) and the daily alert about overdue disputes, against PostgreSQL and Redis through the real security pipeline.
describe('staff queues', () => {
  let t: TestApp;
  let fx: IdentityFixtures;
  let category: number;

  beforeAll(async () => {
    t = await startApp();
    fx = await IdentityFixtures.open();
    [{ id: category }] = await fx.query<{ id: number }>(
      `INSERT INTO listings.categories (slug, name_en, name_bn, item_kind) VALUES ($1, 'Phones', 'ফোন', 'physical') RETURNING id`,
      [`queues-${randomUUID().slice(0, 8)}`],
    );
  });
  afterAll(async () => {
    await fx?.close();
    await t?.close();
  });

  const call = (headers: Record<string, string>) => (method: string, path: string, body?: unknown) => fetch(t.url(path), {
    method, headers: { ...headers, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  async function member() {
    const userId = await fx.user();
    const sid = await fx.session({ userId });
    return { userId, call: call({ ...fx.headers(sid, userId, 'user'), 'x-forwarded-for': `203.0.113.${randomInt(1, 255)}, 198.51.100.${randomInt(1, 255)}` }) };
  }
  async function operator() {
    const staffId = await fx.staff('operator');
    const sid = await fx.session({ staffId });
    return { staffId, call: call(fx.headers(sid, staffId, 'staff')) };
  }
  /** A dispute under review on a delivered courier order (the seller has responded). */
  async function dispute() {
    const [buyer, seller] = [await member(), await member()];
    const [{ id: listingId }] = await fx.query<{ id: string }>(
      `INSERT INTO listings.listings (seller_id, item_kind, sale_format, category_id, title, description, condition, no_visible_defects,
          fulfilment_options, weight_class, size_class, area_district, approx_lat, approx_lng, price, quantity_total, quantity_available)
       VALUES ($1, 'physical', 'fixed_price', $2, 'Kettle for the queue tests', 'A kettle in good condition, written by the queue tests.', 'used', true,
          'pickup_only', 'up_to_1kg', 'small', 'Dhaka', 23.81, 90.41, 300000, 1, 1) RETURNING id`, [seller.userId, category]);
    const [{ id: orderId }] = await fx.query<{ id: string }>(
      `INSERT INTO orders.orders (kind, listing_id, item_kind, buyer_id, seller_id, quantity, unit_price, item_price, fulfilment, delivery_fee, total,
          listing_snapshot, commission_bps, delivery_margin_bps, params_version, payment_due_at, status, paid_at, fulfilment_step, fulfilment_due_at,
          fulfilment_done_at, delivery_event_at, delivery_event_source, delivery_quote_id)
       VALUES ('fixed_price', $1, 'physical', $2, $3, 1, 300000, 300000, 'courier', 0, 300000, '{"title":"Kettle"}', 500, 1000, 1, now(), 'paid', now(),
          'courier_pickup', now() + interval '3 days', now(), now(), 'courier_delivered', gen_random_uuid()) RETURNING id`, [listingId, buyer.userId, seller.userId]);
    await fx.query(`INSERT INTO payments.attempts (purpose, order_id, payer_id, provider, amount, status, expires_at, confirmed_at) VALUES ('order', $1, $2, 'bkash', 300000, 'succeeded', now(), now())`, [orderId, buyer.userId]);
    await fx.query(`INSERT INTO orders.escrows (order_id, release_policy, amount_collected, dispute_window_ends_at, auto_release_at) VALUES ($1, 'standard', 300000, now() + interval '3 days', now() + interval '5 days')`, [orderId]);
    const { disputeId } = (await (await buyer.call('POST', `/orders/${orderId}/disputes`, { type: 'damaged', description: 'The kettle leaks from the base when filled.' })).json()) as { disputeId: string };
    await seller.call('POST', `/disputes/${disputeId}/statements`, { text: 'It did not leak when I sold it.' });
    return { disputeId, orderId, buyer, seller };
  }
  type Page = { queue: string; items: { id: string; ageHours: number; overdue?: boolean; path: string; status: string; [k: string]: unknown }[] };

  it('FR-OPS-01 exactly eight queues: seven list their items, one waits for its owner (feature-off); nothing else exists', async () => {
    const op = await operator();
    for (const q of ['kyc', 'ownership_proofs', 'listings_review', 'reports', 'flagged_activity', 'disputes', 'payout_accounts']) {
      const r = await op.call('GET', `/staff/queues/${q}`);
      expect([q, r.status, ((await r.json()) as Page).queue]).toEqual([q, 200, q]);
    }
    for (const [q, reason] of [['payment_discrepancies', 'payment-discrepancies-not-yet-available']]) {
      const r = await op.call('GET', `/staff/queues/${q}`);
      expect([r.status, ((await r.json()) as { errors: unknown[] }).errors]).toEqual([409, [{ field: 'queue', reason }]]);
    }
    expect((await op.call('GET', '/staff/queues/orders')).status).toBe(404);
    const user = await member();
    expect((await user.call('GET', '/staff/queues/disputes')).status).toBe(401);
  });

  it('FR-DSP-08 DV-52 the disputes queue shows overdue disputes first, then the oldest, each with its age and where to act', async () => {
    const op = await operator();
    const older = await dispute();
    const late = await dispute();
    await fx.query(`UPDATE disputes.disputes SET decision_target_at = now() - interval '1 hour' WHERE id = $1`, [late.disputeId]);
    const page = (await (await op.call('GET', '/staff/queues/disputes')).json()) as Page;
    const mine = page.items.filter((i) => [older.disputeId, late.disputeId].includes(i.id));
    expect(mine.map((i) => [i.id, i.overdue])).toEqual([[late.disputeId, true], [older.disputeId, false]]);
    expect(page.items.findIndex((i) => i.overdue === false)).toBeGreaterThan(page.items.findIndex((i) => i.id === late.disputeId)); // every overdue one before any other
    const o = mine.find((i) => i.id === older.disputeId)!;
    expect(o).toMatchObject({ status: 'under_review', orderId: older.orderId, type: 'damaged', fourEyes: false, path: `/staff/disputes/${older.disputeId}/case-file` });
    expect(o.ageHours).toBeGreaterThanOrEqual(0);
    expect(Date.parse(o.since as string)).toBeLessThanOrEqual(Date.parse(mine[0].since as string)); // created first: older
  });

  it('FR-OPS-01 reports and flagged activity list their open items, oldest first, linked to their actions', async () => {
    const op = await operator();
    const [reporter, subject] = [await member(), await member()];
    const { reportId } = (await (await reporter.call('POST', '/reports', { targetType: 'user', targetId: subject.userId, category: 'abusive', text: 'Insulted me in the chat twice.' })).json()) as { reportId: string };
    const listingId = randomUUID();
    await fx.query(`INSERT INTO trust.signals (kind, source_ref, subject_user, detail) VALUES ('relisting', $1, $2, '{}')`, [`listing:${listingId}`, subject.userId]);
    const reports = (await (await op.call('GET', '/staff/queues/reports')).json()) as Page;
    expect(reports.items.find((i) => i.id === reportId)).toMatchObject({ status: 'open', assignedTo: null, subjectUser: subject.userId, text: 'Insulted me in the chat twice.', path: `/staff/reports/${reportId}/resolution` });
    const since = reports.items.map((i) => i.since as string);
    expect([...since].sort()).toEqual(since);
    const flagged = (await (await op.call('GET', '/staff/queues/flagged_activity')).json()) as Page;
    const signal = flagged.items.find((i) => i.subjectUser === subject.userId)!;
    expect(signal).toMatchObject({ kind: 'relisting', status: 'open', path: `/staff/signals/${signal.id}/review` });
  });

  it('FR-DSP-08 overdue disputes e-mail the active administrators once a day', async () => {
    const redis = t.app.get<Redis>(REDIS);
    for (const k of await redis.keys('disputes:overdue-alert:*')) await redis.del(k);
    const admin = await fx.staff('administrator');
    const [{ email }] = await fx.query<{ email: string }>(`SELECT email FROM identity.staff_accounts WHERE id = $1`, [admin]);
    const late = await dispute();
    await fx.query(`UPDATE disputes.disputes SET decision_target_at = now() - interval '1 hour' WHERE id = $1`, [late.disputeId]);
    const queues = t.app.get(QueueService);
    const mail = t.app.get<DirectMessages>(NOTIFICATION_PORT);
    expect(await queues.alertOverdue()).toBeGreaterThanOrEqual(1);
    expect(mail.sent.filter((m) => m.to === email)).toEqual([expect.objectContaining({ channel: 'email', template: 'disputes_overdue', vars: expect.objectContaining({ oldest_days: expect.any(String) }) })]);
    expect(await queues.alertOverdue()).toBe(0); // the same day: not again
    expect(mail.sent.filter((m) => m.to === email)).toHaveLength(1);
  });
});
