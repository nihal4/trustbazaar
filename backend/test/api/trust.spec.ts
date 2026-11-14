import { randomInt, randomUUID } from 'crypto';
import { EventBus, OutboxEvent } from '../../src/kernel/events/event-bus';
import { NotificationConsumers } from '../../src/modules/chat/consumers/notification.consumers';
import { IDENTITY_QUERY, IdentityQuery } from '../../src/modules/identity/ports';
import { SANCTION_PORT, SanctionPort } from '../../src/modules/trust/ports';
import { startApp, TestApp } from '../support/app';
import { IdentityFixtures } from '../support/identity';

// U7-04: reports, the claim of a report case, sanctions, the restrictions Unit 1 enforces with them (I-43), and seller
// strikes (docs/design/07_disputes_trust_staff.pdf sections 3.1 and 6), against PostgreSQL through the real security
// pipeline. Events are handed to their consumers as the outbox dispatcher would hand them.
describe('trust and safety: reports, sanctions, strikes', () => {
  let t: TestApp;
  let fx: IdentityFixtures;
  let category: number;
  let bus: EventBus;
  let notices: NotificationConsumers;
  let sanctions: SanctionPort;
  let identity: IdentityQuery;

  beforeAll(async () => {
    t = await startApp();
    fx = await IdentityFixtures.open();
    bus = t.app.get(EventBus);
    notices = t.app.get(NotificationConsumers);
    sanctions = t.app.get<SanctionPort>(SANCTION_PORT);
    identity = t.app.get<IdentityQuery>(IDENTITY_QUERY);
    [{ id: category }] = await fx.query<{ id: number }>(
      `INSERT INTO listings.categories (slug, name_en, name_bn, item_kind) VALUES ($1, 'Phones', 'ফোন', 'physical') RETURNING id`,
      [`trust-${randomUUID().slice(0, 8)}`],
    );
  });
  afterAll(async () => {
    await fx?.close();
    await t?.close();
  });

  const call = (headers: Record<string, string>) => (method: string, path: string, body?: unknown) =>
    fetch(t.url(path), {
      method, headers: { ...headers, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  async function member() {
    const userId = await fx.user();
    const sid = await fx.session({ userId });
    const ip = `203.0.113.${randomInt(1, 255)}, 198.51.100.${randomInt(1, 255)}`;
    const c = call({ ...fx.headers(sid, userId, 'user'), 'x-forwarded-for': ip });
    return { userId, call: c, send: (thread: string, text: string) => c('POST', `/threads/${thread}/messages`, { clientId: randomUUID(), text }) };
  }
  async function operator() {
    const staffId = await fx.staff('operator');
    const sid = await fx.session({ staffId });
    return { staffId, call: call(fx.headers(sid, staffId, 'staff')) };
  }
  async function listing(sellerId: string) {
    const [{ id }] = await fx.query<{ id: string }>(
      `INSERT INTO listings.listings (seller_id, item_kind, sale_format, category_id, title, description, condition, no_visible_defects,
          fulfilment_options, weight_class, size_class, area_district, approx_lat, approx_lng, price, quantity_total, quantity_available)
       VALUES ($1, 'physical', 'fixed_price', $2, 'Phone for the trust tests', 'A phone in good condition, written by the trust tests.', 'used', true,
          'pickup_or_courier', 'up_to_1kg', 'small', 'Dhaka', 23.81, 90.41, 1500000, 1, 1) RETURNING id`,
      [sellerId, category],
    );
    for (const n of [1, 2]) {
      await fx.query(`INSERT INTO listings.listing_photos (listing_id, position, storage_key, width, height) VALUES ($1, $2, $3, 800, 600)`, [id, n, randomUUID().replace(/-/g, '')]);
    }
    await fx.query(`UPDATE listings.listings SET status = 'active', published_at = now() WHERE id = $1`, [id]);
    return id;
  }
  /** A paid order of the seller's, for a strike (strikes name a real order). */
  async function order(sellerId: string) {
    const buyerId = await fx.user();
    const [{ id }] = await fx.query<{ id: string }>(
      `INSERT INTO orders.orders (kind, listing_id, item_kind, buyer_id, seller_id, quantity, unit_price, item_price, fulfilment, delivery_fee, total,
          listing_snapshot, commission_bps, delivery_margin_bps, params_version, payment_due_at, status, paid_at, fulfilment_step, fulfilment_due_at)
       VALUES ('fixed_price', $1, 'physical', $2, $3, 1, 100000, 100000, 'self_pickup', 0, 100000, '{"title":"Item"}', 500, 1000, 1, now(), 'paid', now(), 'meetup_handover', now() + interval '3 days')
       RETURNING id`,
      [randomUUID(), buyerId, sellerId],
    );
    return id;
  }
  const event = (type: string, aggregateId: string, payload: Record<string, unknown>): OutboxEvent =>
    ({ outbox: type.split('.')[0], id: String(randomInt(1, 2 ** 31)), type, aggregateId, payload, createdAt: new Date(), attempt: 1 });
  /** Hands an event to one consumer, as the dispatcher would. */
  const consume = async (type: string, consumer: string, e: OutboxEvent) => {
    const c = bus.consumersOf(type).find((x) => x.name === consumer);
    if (!c) throw new Error(`${consumer} does not consume ${type}`);
    await c.handler(e);
  };
  const outbox = (aggregateId: string, type: string) =>
    fx.query<{ payload: Record<string, unknown> }>(`SELECT payload FROM disputes.outbox WHERE aggregate_id = $1 AND event_type = $2 ORDER BY id`, [aggregateId, type]);
  const sanctionRows = (userId: string) =>
    fx.query<{ kind: string; automatic: boolean; fraud: boolean; lifted: boolean; lift_approval_id: string | null }>(
      `SELECT kind, automatic, fraud, lifted_at IS NOT NULL AS lifted, lift_approval_id FROM trust.sanctions WHERE user_id = $1 ORDER BY starts_at`, [userId]);
  const errors = async (r: Response) => ((await r.json()) as { errors?: unknown[] }).errors;

  it('FR-TNS-01 a user reports a listing (about its seller) or a user, once per target; never oneself', async () => {
    const [seller, reporter] = [await member(), await member()];
    const listingId = await listing(seller.userId);
    const r = await reporter.call('POST', '/reports', { targetType: 'listing', targetId: listingId, category: 'counterfeit', text: 'The photos are from a shop website.' });
    expect(r.status).toBe(201);
    const { reportId } = (await r.json()) as { reportId: string };
    expect(await fx.query(`SELECT target_type, subject_user, status FROM trust.reports WHERE id = $1`, [reportId]))
      .toEqual([{ target_type: 'listing', subject_user: seller.userId, status: 'open' }]);
    const again = await reporter.call('POST', '/reports', { targetType: 'listing', targetId: listingId, category: 'fraudulent' });
    expect([again.status, await errors(again)]).toEqual([400, [{ field: 'target', reason: 'already-reported' }]]);
    expect((await reporter.call('POST', '/reports', { targetType: 'user', targetId: seller.userId, category: 'abusive' })).status).toBe(201);
    const own = await seller.call('POST', '/reports', { targetType: 'listing', targetId: listingId, category: 'fraudulent' });
    expect([own.status, await errors(own)]).toEqual([400, [{ field: 'target', reason: 'own' }]]);
    expect((await reporter.call('POST', '/reports', { targetType: 'user', targetId: randomUUID(), category: 'abusive' })).status).toBe(404);
    expect((await reporter.call('POST', '/reports', { targetType: 'listing', targetId: randomUUID(), category: 'abusive' })).status).toBe(404);
    expect((await reporter.call('POST', '/reports', { targetType: 'message', targetId: randomUUID(), category: 'abusive' })).status).toBe(400); // in the chat
    expect((await reporter.call('POST', '/reports', { targetType: 'user', targetId: seller.userId, category: 'rude' })).status).toBe(400);
    expect((await fetch(t.url('/reports'), { method: 'POST' })).status).toBe(401);
  });

  it('FR-OPS-06 FR-TNS-09 FR-CHT-10 one operator claims a chat report, alone reads the thread through it, and resolves it; the reporter learns only the outcome', async () => {
    const [seller, buyer] = [await member(), await member()];
    const listingId = await listing(seller.userId);
    const { id: thread } = (await (await buyer.call('POST', `/listings/${listingId}/threads`)).json()) as { id: string };
    await seller.send(thread, 'Pay me by bKash to my own number instead.');
    const { reportId } = (await (await buyer.call('POST', `/threads/${thread}/reports`, { category: 'fraudulent', messageSeq: 1 })).json()) as { reportId: string };
    const [a, b, conflicted] = [await operator(), await operator(), await operator()];
    const read = (op: { call: ReturnType<typeof call> }) => op.call('GET', `/staff/cases/report/${reportId}/threads/${thread}`);
    expect((await read(a)).status).toBe(404); // not claimed yet

    expect((await conflicted.call('POST', '/staff/conflicts', { userId: seller.userId, reason: 'The seller is my cousin.' })).status).toBe(204);
    expect((await conflicted.call('POST', `/staff/cases/report/${reportId}/claim`)).status).toBe(403); // conflict-of-interest
    const claimed = await a.call('POST', `/staff/cases/report/${reportId}/claim`);
    expect([claimed.status, await claimed.json()]).toEqual([200, { reportId, status: 'under_review' }]);
    expect((await a.call('POST', `/staff/cases/report/${reportId}/claim`)).status).toBe(200); // again: still theirs
    expect((await b.call('POST', `/staff/cases/report/${reportId}/claim`)).status).toBe(409); // already-claimed
    expect((await b.call('POST', `/staff/cases/dispute/${reportId}/claim`)).status).toBe(404); // disputes come with U7-03

    expect((await read(a)).status).toBe(200);
    expect((await read(b)).status).toBe(404);
    expect((await b.call('POST', `/staff/reports/${reportId}/resolution`, { outcome: 'actioned', resolution: 'Asked to pay outside the app.' })).status).toBe(409); // not-claimed
    expect((await a.call('POST', `/staff/reports/${reportId}/resolution`, { outcome: 'actioned', resolution: 'Too short' })).status).toBe(400);
    const done = await a.call('POST', `/staff/reports/${reportId}/resolution`, { outcome: 'actioned', resolution: 'Asked to pay outside the app; warning given.' });
    expect([done.status, await done.json()]).toEqual([200, { reportId, status: 'actioned' }]);
    expect((await a.call('POST', `/staff/reports/${reportId}/resolution`, { outcome: 'dismissed', resolution: 'Changed my mind about it.' })).status).toBe(400); // closed
    expect((await read(a)).status).toBe(404); // the hold is released
    expect(await fx.query(`SELECT count(*)::int AS n FROM chat.thread_holds WHERE thread_id = $1 AND released_at IS NULL`, [thread])).toEqual([{ n: 0 }]);

    const [{ payload }] = await outbox(reportId, 'trust.report.resolved');
    expect(payload).toEqual({ reportId, reporterId: buyer.userId, actioned: true });
    await notices.handle(event('trust.report.resolved', reportId, payload));
    const n = (await (await buyer.call('GET', '/notifications')).json()) as { items: { code: string; body: string }[] };
    expect(n.items.find((i) => i.code === 'trust.report_actioned')?.body).toBe('ধন্যবাদ। আমরা আপনার রিপোর্ট পর্যালোচনা করে ব্যবস্থা নিয়েছি।');
    const audit = await fx.query<{ action: string }>(`SELECT action FROM audit.events WHERE object_id = $1 ORDER BY id`, [reportId]);
    expect(audit.map((x) => x.action)).toEqual(['trust.report.claimed', 'trust.report.claimed', 'trust.report.actioned']);
  });

  it('FR-TNS-03 I-43 a selling or buying suspension restricts exactly those actions until it ends or is lifted; the user is told the reason', async () => {
    const u = await member();
    const op = await operator();
    const can = async (action: 'list' | 'bid' | 'buy') => identity.assertCanTransact(u.userId, action).then(() => 'ok', (e: { extra?: { errors?: { reason: string }[] } }) => e.extra?.errors?.[0]?.reason);
    expect(await sanctions.restrictions(u.userId)).toEqual({ canSell: true, canBuyBid: true, fraudHold: false });
    const selling = await op.call('POST', `/staff/users/${u.userId}/sanctions`, { kind: 'selling_suspended', reason: 'Repeated counterfeit listings reported.' });
    expect(selling.status).toBe(201);
    const { sanctionId } = (await selling.json()) as { sanctionId: string };
    expect([await can('list'), await can('bid'), await can('buy')]).toEqual(['restricted', 'ok', 'ok']);
    const until = new Date(Date.now() + 2 * 86_400_000).toISOString();
    expect((await op.call('POST', `/staff/users/${u.userId}/sanctions`, { kind: 'buying_suspended', reason: 'Unpaid wins on three auctions.', endsAt: until, fraud: true })).status).toBe(201);
    expect(await sanctions.restrictions(u.userId)).toEqual({ canSell: false, canBuyBid: false, fraudHold: true });
    // a suspension that has ended stops counting by itself, without a job
    const other = await fx.user();
    await fx.query(`INSERT INTO trust.sanctions (user_id, kind, reason, created_by, starts_at, ends_at) VALUES ($1, 'buying_suspended', 'Ended yesterday, as tested.', $2, now() - interval '2 days', now() - interval '1 day')`, [other, op.staffId]);
    expect(await sanctions.restrictions(other)).toEqual({ canSell: true, canBuyBid: true, fraudHold: false });
    const [applied] = await outbox(u.userId, 'trust.sanction.applied');
    expect(applied.payload).toEqual({ userId: u.userId, sanctionId, kind: 'selling_suspended', reason: 'Repeated counterfeit listings reported.', fraud: false, endsAt: null, automatic: false });
    await notices.handle(event('trust.sanction.applied', u.userId, applied.payload));
    const n = (await (await u.call('GET', '/notifications')).json()) as { items: { code: string; body: string }[] };
    expect(n.items.find((i) => i.code === 'trust.selling_suspended')?.body).toContain('কারণ: Repeated counterfeit listings reported.');

    const lifted = await op.call('DELETE', `/staff/users/${u.userId}/sanctions`, { sanctionId, reason: 'Listings checked again; they are genuine.' });
    expect([lifted.status, await lifted.json()]).toEqual([200, { sanctionId, status: 'lifted' }]);
    expect(await can('list')).toBe('ok');
    expect((await op.call('DELETE', `/staff/users/${u.userId}/sanctions`, { sanctionId, reason: 'Listings checked again; they are genuine.' })).status).toBe(404); // already lifted
    expect(await outbox(u.userId, 'trust.sanction.lifted')).toEqual([{ payload: { userId: u.userId, sanctionId, kind: 'selling_suspended' } }]);
  });

  it('FR-TNS-03 a sanction must be well formed: warnings have no end and cannot be lifted, the fraud flag is for suspensions, listing removal waits for Unit 3', async () => {
    const u = await member();
    const op = await operator();
    const apply = (body: Record<string, unknown>) => op.call('POST', `/staff/users/${u.userId}/sanctions`, { reason: 'A reason long enough to keep.', ...body });
    const later = new Date(Date.now() + 86_400_000).toISOString();
    expect(await errors(await apply({ kind: 'warning', endsAt: later }))).toEqual([{ field: 'endsAt', reason: 'warning-has-no-end' }]);
    expect(await errors(await apply({ kind: 'warning', fraud: true }))).toEqual([{ field: 'fraud', reason: 'suspensions-only' }]);
    expect(await errors(await apply({ kind: 'selling_suspended', endsAt: new Date(Date.now() - 1000).toISOString() }))).toEqual([{ field: 'endsAt', reason: 'in-the-past' }]);
    const removal = await apply({ kind: 'listing_removal' });
    expect([removal.status, await errors(removal)]).toEqual([409, [{ field: 'kind', reason: 'listing-removal-not-yet-available' }]]);
    expect((await apply({ kind: 'warning', reason: 'Too short' })).status).toBe(400);
    expect((await op.call('POST', `/staff/users/${randomUUID()}/sanctions`, { kind: 'warning', reason: 'A reason long enough to keep.' })).status).toBe(404);
    const w = await apply({ kind: 'warning' });
    expect(w.status).toBe(201);
    const { sanctionId } = (await w.json()) as { sanctionId: string };
    expect(await errors(await op.call('DELETE', `/staff/users/${u.userId}/sanctions`, { sanctionId, reason: 'Lifting a warning is not a thing.' })))
      .toEqual([{ field: 'sanctionId', reason: 'not-liftable' }]);
    expect(await sanctions.restrictions(u.userId)).toEqual({ canSell: true, canBuyBid: true, fraudHold: false }); // a warning restricts nothing
    expect((await u.call('POST', `/staff/users/${u.userId}/sanctions`, { kind: 'warning', reason: 'A reason long enough to keep.' })).status).toBe(401);
  });

  it('FR-TNS-03 FR-TNS-05 CP-30 an account suspension ends the sessions and tells the reason once; lifting it needs a second operator', async () => {
    const u = await member();
    const [op, second] = [await operator(), await operator()];
    const r = await op.call('POST', `/staff/users/${u.userId}/sanctions`, { kind: 'account_suspended', reason: 'Recovered a sold game account.', fraud: true });
    expect(r.status).toBe(201);
    const { sanctionId } = (await r.json()) as { sanctionId: string };
    expect(await fx.query(`SELECT account_status FROM identity.users WHERE id = $1`, [u.userId])).toEqual([{ account_status: 'suspended' }]);
    expect((await u.call('GET', '/notifications')).status).toBe(401); // sessions ended
    const [suspended] = await fx.query<{ payload: Record<string, unknown> }>(`SELECT payload FROM identity.outbox WHERE aggregate_id = $1 AND event_type = 'identity.account.suspended'`, [u.userId]);
    expect(suspended.payload).toEqual({ userId: u.userId, fraud: true, sanctionId });
    expect(await notices.map['identity.account.suspended'](event('identity.account.suspended', u.userId, suspended.payload))).toEqual([]); // told by the sanction's notice
    const [applied] = await outbox(u.userId, 'trust.sanction.applied');
    expect(await notices.map['trust.sanction.applied'](event('trust.sanction.applied', u.userId, applied.payload)))
      .toEqual([{ to: u.userId, code: 'trust.account_suspended', params: { reason: 'Recovered a sold game account.' } }]);

    const lift = await op.call('DELETE', `/staff/users/${u.userId}/sanctions`, { sanctionId, reason: 'The buyer confirmed the account is back.' });
    expect(lift.status).toBe(202);
    const { approvalId, status } = (await lift.json()) as { approvalId: string; status: string };
    expect(status).toBe('proposed');
    expect((await sanctionRows(u.userId))[0].lifted).toBe(false); // nothing lifted before the approval
    expect((await op.call('POST', `/staff/approvals/${approvalId}/decision`, { decision: 'approved' })).status).toBe(403); // not one's own
    expect((await second.call('POST', `/staff/approvals/${approvalId}/decision`, { decision: 'approved' })).status).toBe(200);
    const [reinstated] = await fx.query<{ payload: Record<string, unknown> }>(`SELECT payload FROM identity.outbox WHERE aggregate_id = $1 AND event_type = 'identity.account.reinstated'`, [u.userId]);
    expect(reinstated.payload).toEqual({ userId: u.userId, approvalId, decidedBy: second.staffId, reason: 'The buyer confirmed the account is back.' });
    await consume('identity.account.reinstated', 'trust.sanctions', event('identity.account.reinstated', u.userId, reinstated.payload));
    await consume('identity.account.reinstated', 'trust.sanctions', event('identity.account.reinstated', u.userId, reinstated.payload)); // twice: nothing more
    expect(await sanctionRows(u.userId)).toEqual([{ kind: 'account_suspended', automatic: false, fraud: true, lifted: true, lift_approval_id: approvalId }]);
    expect(await outbox(u.userId, 'trust.sanction.lifted')).toHaveLength(1);
    expect(await sanctions.restrictions(u.userId)).toEqual({ canSell: true, canBuyBid: true, fraudHold: false });
  });

  it('FR-TNS-04 CP-47 strikes count once per order and reason; the third in 90 days suspends selling automatically, once', async () => {
    const seller = await fx.user();
    const orders = [await order(seller), await order(seller), await order(seller), await order(seller)];
    const cancelled = (orderId: string) => event('orders.order.cancelled_by_seller', orderId, { orderId, sellerId: seller, buyerId: randomUUID(), reason: 'Sold it elsewhere.' });
    const refunded = (orderId: string, reason: string) => event('orders.escrow.refunded', orderId, { orderId, sellerId: seller, buyerId: randomUUID(), reason, refunded: '100000' });
    await consume('orders.order.cancelled_by_seller', 'trust.strikes', cancelled(orders[0]));
    await consume('orders.order.cancelled_by_seller', 'trust.strikes', cancelled(orders[0])); // redelivered: one strike
    await consume('orders.escrow.refunded', 'trust.strikes', refunded(orders[1], 'cancellation')); // not a missed deadline: no strike
    await consume('orders.escrow.refunded', 'trust.strikes', refunded(orders[1], 'fulfilment_deadline'));
    expect(await sanctionRows(seller)).toEqual([]);
    expect(await sanctions.restrictions(seller)).toMatchObject({ canSell: true });
    await consume('orders.order.cancelled_by_seller', 'trust.strikes', cancelled(orders[2])); // the third
    await consume('orders.order.cancelled_by_seller', 'trust.strikes', cancelled(orders[3])); // a fourth: no second suspension
    expect(await fx.query(`SELECT reason::text, count(*)::int AS n FROM trust.strikes WHERE user_id = $1 GROUP BY 1 ORDER BY 1`, [seller]))
      .toEqual([{ reason: 'missed_deadline', n: 1 }, { reason: 'unilateral_cancel', n: 3 }]);
    expect(await sanctionRows(seller)).toEqual([{ kind: 'selling_suspended', automatic: true, fraud: false, lifted: false, lift_approval_id: null }]);
    expect(await sanctions.restrictions(seller)).toMatchObject({ canSell: false, canBuyBid: true });
    const [applied] = await outbox(seller, 'trust.sanction.applied');
    expect(await notices.map['trust.sanction.applied'](event('trust.sanction.applied', seller, applied.payload)))
      .toEqual([{ to: seller, code: 'trust.selling_suspended_strikes', params: {} }]);
    await expect(consume('orders.order.cancelled_by_seller', 'trust.strikes', event('orders.order.cancelled_by_seller', orders[0], { orderId: orders[0] }))).rejects.toThrow('no sellerId');
  });

  it('FR-TNS-03 every notice of a sanction or a resolved report has an active template', async () => {
    const codes = ['trust.warning', 'trust.selling_suspended', 'trust.selling_suspended_strikes', 'trust.buying_suspended', 'trust.account_suspended',
      'trust.sanction_lifted', 'trust.report_actioned', 'trust.report_dismissed'];
    const found = await fx.query<{ code: string }>(`SELECT code FROM notify.templates WHERE active AND code = ANY($1) ORDER BY code`, [codes]);
    expect(found.map((f) => f.code)).toEqual([...codes].sort());
  });
});
