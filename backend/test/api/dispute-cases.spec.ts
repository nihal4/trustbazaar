import { TbConfig } from '../../src/kernel/config/config';
import { TB_CONFIG } from '../../src/kernel/config/config.provider';
import { deviceDigest, deviceLast4 } from '../../src/kernel/device-identifier';
import { randomInt, randomUUID } from 'crypto';
import { EventBus, OutboxEvent } from '../../src/kernel/events/event-bus';
import { startApp, TestApp } from '../support/app';
import { IdentityFixtures } from '../support/identity';

// U7-03, second part: disputes on physical goods from the operator's side (docs/design/07_disputes_trust_staff.pdf sections
// 5.4 to 5.6; FR-DSP-05 to FR-DSP-09, FR-OPS-06, CP-30) against PostgreSQL through the real security pipeline. Orders are
// written directly as paid and delivered by handover; disputes are opened and answered through the API. Events are
// handed to their consumers as the outbox dispatcher would hand them.
describe('dispute cases: claim, case file, request for information, decision, return', () => {
  let t: TestApp;
  let fx: IdentityFixtures;
  let category: number;
  let bus: EventBus;

  beforeAll(async () => {
    t = await startApp();
    fx = await IdentityFixtures.open();
    bus = t.app.get(EventBus);
    [{ id: category }] = await fx.query<{ id: number }>(
      `INSERT INTO listings.categories (slug, name_en, name_bn, item_kind) VALUES ($1, 'Phones', 'ফোন', 'physical') RETURNING id`,
      [`cases-${randomUUID().slice(0, 8)}`],
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
  /** A delivered meetup order (price in poisha) with a dispute under review: the seller has responded. */
  async function disputeUnderReview(price = 1500000) {
    const [buyer, seller] = [await member(), await member()];
    const [{ id: listingId }] = await fx.query<{ id: string }>(
      `INSERT INTO listings.listings (seller_id, item_kind, sale_format, category_id, title, description, condition, no_visible_defects,
          fulfilment_options, weight_class, size_class, area_district, approx_lat, approx_lng, price, quantity_total, quantity_available)
       VALUES ($1, 'physical', 'fixed_price', $2, 'Camera for the case tests', 'A camera in good condition, written by the case tests.', 'used', true,
          'pickup_only', 'up_to_1kg', 'small', 'Dhaka', 23.81, 90.41, $3, 1, 1) RETURNING id`, [seller.userId, category, price]);
    const [{ id }] = await fx.query<{ id: string }>(
      `INSERT INTO orders.orders (kind, listing_id, item_kind, buyer_id, seller_id, quantity, unit_price, item_price, fulfilment, delivery_fee, total,
          listing_snapshot, commission_bps, delivery_margin_bps, params_version, payment_due_at, status, paid_at, fulfilment_step, fulfilment_due_at,
          fulfilment_done_at, delivery_event_at, delivery_event_source, delivery_quote_id)
       VALUES ('fixed_price', $1, 'physical', $2, $3, 1, $4, $4, 'courier', 0, $4, '{"title":"Camera"}', 500, 1000, 1, now(), 'paid', now(),
          'courier_pickup', now() + interval '3 days', now(), now(), 'courier_delivered', gen_random_uuid()) RETURNING id`, [listingId, buyer.userId, seller.userId, price]);
    await fx.query(`INSERT INTO payments.attempts (purpose, order_id, payer_id, provider, amount, status, expires_at, confirmed_at) VALUES ('order', $1, $2, 'bkash', $3, 'succeeded', now(), now())`, [id, buyer.userId, price]);
    await fx.query(`INSERT INTO orders.escrows (order_id, release_policy, amount_collected, dispute_window_ends_at, auto_release_at) VALUES ($1, 'standard', $2, now() + interval '3 days', now() + interval '5 days')`, [id, price]);
    const [{ id: thread }] = await fx.query<{ id: string }>(`INSERT INTO chat.threads (listing_id, buyer_id, seller_id) VALUES ($1, $2, $3) RETURNING id`, [listingId, buyer.userId, seller.userId]);
    const opened = await buyer.call('POST', `/orders/${id}/disputes`, { type: 'not_as_described', description: 'The lens has a deep scratch that the listing did not mention.' });
    const { disputeId } = (await opened.json()) as { disputeId: string };
    expect((await seller.call('POST', `/disputes/${disputeId}/statements`, { text: 'The scratch was there; it is in photo 3.' })).status).toBe(201);
    return { orderId: id, disputeId, buyer, seller, thread };
  }
  const event = (type: string, aggregateId: string, payload: Record<string, unknown>): OutboxEvent =>
    ({ outbox: type.split('.')[0], id: String(randomInt(1, 2 ** 31)), type, aggregateId, payload, createdAt: new Date(), attempt: 1 });
  const consume = async (e: OutboxEvent) => bus.consumersOf(e.type).find((c) => c.name === 'trust.disputes')!.handler(e);
  /** The dispute's decided event, as published by disputes.decide, handed to Unit 7's consumer. */
  const decidedEvent = async (disputeId: string) => {
    const [{ payload }] = await fx.query<{ payload: Record<string, unknown> }>(`SELECT payload FROM disputes.outbox WHERE aggregate_id = $1 AND event_type = 'disputes.dispute.decided' ORDER BY id DESC LIMIT 1`, [disputeId]);
    await consume(event('disputes.dispute.decided', disputeId, payload));
    return payload;
  };
  const dispute = async (id: string) => (await fx.query<{ status: string; outcome: string | null; approval_id: string | null; assigned_to: string | null }>(
    `SELECT status, outcome, approval_id, assigned_to FROM disputes.disputes WHERE id = $1`, [id]))[0];
  const escrow = async (orderId: string) => (await fx.query<{ state: string }>(`SELECT state FROM orders.escrows WHERE order_id = $1`, [orderId]))[0].state;
  const errors = async (r: Response) => ((await r.json()) as { errors?: unknown[] }).errors;
  const reason = 'The listing hid the scratch; the photos prove it was there before.';

  it('FR-OPS-06 FR-DSP-05 FR-CHT-10 one operator claims a dispute and alone opens its case file and chat; each view is audited', async () => {
    const c = await disputeUnderReview();
    const [a, b, conflicted] = [await operator(), await operator(), await operator()];
    expect((await a.call('GET', `/staff/disputes/${c.disputeId}/case-file`)).status).toBe(409); // not-claimed
    expect((await conflicted.call('POST', '/staff/conflicts', { userId: c.buyer.userId, reason: 'The buyer is my neighbour.' })).status).toBe(204);
    expect((await conflicted.call('POST', `/staff/cases/dispute/${c.disputeId}/claim`)).status).toBe(403);
    expect(await (await a.call('POST', `/staff/cases/dispute/${c.disputeId}/claim`)).json()).toEqual({ disputeId: c.disputeId, status: 'under_review' });
    expect((await b.call('POST', `/staff/cases/dispute/${c.disputeId}/claim`)).status).toBe(409); // already-claimed

    const r = await a.call('GET', `/staff/disputes/${c.disputeId}/case-file`);
    expect(r.status).toBe(200);
    const file = (await r.json()) as Record<string, unknown> & { outcomes: Record<string, unknown>; history: { to: string }[]; statements: unknown[]; chat: { path: string } };
    expect(Object.keys(file).sort()).toEqual(['chat', 'context', 'dispute', 'escrow', 'evidence', 'fulfilment', 'game', 'handoverPhotos', 'history', 'order', 'outcomes', 'parties', 'returnCheck', 'statements']);
    expect(file.game).toBeNull(); // a physical item
    expect(file.outcomes).toMatchObject({ release: { refunded: '0', sellerPayout: '1425000' }, fullRefund: { refunded: '1500000', sellerPayout: '0' } });
    expect(file.history.map((h) => h.to)).toEqual(['open', 'under_review']);
    expect(file.statements).toHaveLength(1);
    expect(JSON.stringify(file.parties)).not.toMatch(/@|\+880/); // SEC-ACC-05: no contact details
    expect((await a.call('GET', file.chat.path)).status).toBe(200);
    expect((await b.call('GET', file.chat.path)).status).toBe(404);
    expect((await b.call('GET', `/staff/disputes/${c.disputeId}/case-file`)).status).toBe(409);
    expect(await fx.query(`SELECT action FROM audit.events WHERE object_id = $1 ORDER BY id`, [c.disputeId])).toEqual([{ action: 'disputes.dispute.claimed' }, { action: 'disputes.case_file.viewed' }]);
  });

  it('FR-DSP-09 DV-47 the operator asks the seller for more; they have 24 hours; their answer resumes the review', async () => {
    const c = await disputeUnderReview();
    const op = await operator();
    await op.call('POST', `/staff/cases/dispute/${c.disputeId}/claim`);
    const r = await op.call('POST', `/staff/disputes/${c.disputeId}/request-info`, { note: 'Please send the original photos with dates.' });
    const body = (await r.json()) as { status: string; infoDueAt: string };
    expect([r.status, body.status]).toEqual([200, 'awaiting_seller']);
    expect(Math.round((new Date(body.infoDueAt).getTime() - Date.now()) / 3_600_000)).toBe(24);
    expect(await fx.query(`SELECT params FROM notify.notifications WHERE user_id = $1 AND template_code = 'dispute.info_requested'`, [c.seller.userId]))
      .toEqual([{ params: { listing_title: 'Camera', hours: 24 } }]);
    expect(await errors(await op.call('POST', `/staff/disputes/${c.disputeId}/decision`, { outcome: 'release', reason }))).toEqual([{ field: 'dispute', reason: 'not-in-this-state' }]);
    expect(await (await c.seller.call('POST', `/disputes/${c.disputeId}/statements`, { text: 'Photos attached, taken last month.' })).json()).toEqual({ status: 'under_review' });
  });

  it('FR-DSP-06 FR-DSP-07 FR-TNS-04 a partial refund shows its exact split first and is decided at once below BDT 20,000: the escrow settles, the seller gets a strike, the chat is released, both are told', async () => {
    const c = await disputeUnderReview(1500000);
    const op = await operator();
    // Decisions log, U8-10: Unit 2's exact split of a partial refund, for the assigned operator only, before deciding
    expect((await (await operator()).call('GET', `/staff/disputes/${c.disputeId}/outcome-preview?itemRefund=500000`)).status).toBe(409); // not-claimed
    await op.call('POST', `/staff/cases/dispute/${c.disputeId}/claim`);
    const preview = await op.call('GET', `/staff/disputes/${c.disputeId}/outcome-preview?itemRefund=500000`);
    expect(preview.headers.get('cache-control')).toBe('no-store');
    expect((await preview.json()).partialRefund).toEqual({ itemRefund: '500000', refunded: '500000', sellerPayout: expect.stringMatching(/^\d+$/) });
    expect(await errors(await op.call('GET', `/staff/disputes/${c.disputeId}/outcome-preview?itemRefund=1500000`))).toEqual([{ field: 'itemRefund', reason: 'out-of-range' }]);
    expect((await op.call('GET', `/staff/disputes/${c.disputeId}/outcome-preview?itemRefund=-5`)).status).toBe(400);
    expect(await errors(await op.call('POST', `/staff/disputes/${c.disputeId}/decision`, { outcome: 'partial_refund', reason, itemRefund: '1500000' }))).toEqual([{ field: 'itemRefund', reason: 'between-zero-and-item-price' }]);
    expect(await errors(await op.call('POST', `/staff/disputes/${c.disputeId}/decision`, { outcome: 'release', reason, itemRefund: '100' }))).toEqual([{ field: 'itemRefund', reason: 'partial-refund-only' }]);
    expect((await op.call('POST', `/staff/disputes/${c.disputeId}/decision`, { outcome: 'release', reason: 'Too short.' })).status).toBe(400);
    const r = await op.call('POST', `/staff/disputes/${c.disputeId}/decision`, { outcome: 'partial_refund', reason, itemRefund: '500000' });
    expect([r.status, await r.json()]).toEqual([200, { status: 'decided' }]);
    expect(await dispute(c.disputeId)).toMatchObject({ status: 'decided', outcome: 'partial_refund', approval_id: null });
    expect(await escrow(c.orderId)).toBe('partially_refunded');
    expect(await fx.query(`SELECT reason::text FROM trust.strikes WHERE order_id = $1`, [c.orderId])).toEqual([{ reason: 'dispute_lost' }]);
    expect(await decidedEvent(c.disputeId)).toEqual({ orderId: c.orderId, outcome: 'partial_refund', status: 'decided' });
    expect(await fx.query(`SELECT released_at IS NOT NULL AS released FROM chat.thread_holds WHERE thread_id = $1 AND case_id = $2`, [c.thread, c.disputeId])).toEqual([{ released: true }]);
    for (const u of [c.buyer, c.seller]) {
      expect(await fx.query(`SELECT template_code FROM notify.notifications WHERE user_id = $1 AND template_code = 'dispute.decided'`, [u.userId])).toEqual([{ template_code: 'dispute.decided' }]);
    }
    const view = (await (await c.buyer.call('GET', `/disputes/${c.disputeId}`)).json()) as { outcome: { kind: string; itemRefund: string; reason: string } };
    expect(view.outcome).toMatchObject({ kind: 'partial_refund', itemRefund: '500000', reason });
    expect(await errors(await op.call('POST', `/staff/disputes/${c.disputeId}/decision`, { outcome: 'release', reason }))).toEqual([{ field: 'dispute', reason: 'not-in-this-state' }]);
    expect(await errors(await c.buyer.call('POST', `/disputes/${c.disputeId}/withdraw`))).toEqual([{ field: 'dispute', reason: 'closed' }]);

    const released = await disputeUnderReview(1500000);
    await op.call('POST', `/staff/cases/dispute/${released.disputeId}/claim`);
    expect(await (await op.call('POST', `/staff/disputes/${released.disputeId}/decision`, { outcome: 'release', reason })).json()).toEqual({ status: 'decided' });
    expect([await escrow(released.orderId), await fx.query(`SELECT 1 FROM trust.strikes WHERE order_id = $1`, [released.orderId])]).toEqual(['released', []]); // release: no strike
  });

  it('FR-DSP-06 CP-30 at BDT 20,000 or more the decision is proposed; a second operator\'s approval runs it', async () => {
    const c = await disputeUnderReview(2500000);
    const [op, second] = [await operator(), await operator()];
    await op.call('POST', `/staff/cases/dispute/${c.disputeId}/claim`);
    const r = await op.call('POST', `/staff/disputes/${c.disputeId}/decision`, { outcome: 'full_refund', reason });
    const { status, approvalId } = (await r.json()) as { status: string; approvalId: string };
    expect([r.status, status]).toEqual([202, 'proposed']);
    expect(await dispute(c.disputeId)).toMatchObject({ status: 'under_review', outcome: null });
    expect(await escrow(c.orderId)).toBe('frozen_disputed');
    expect((await op.call('POST', `/staff/approvals/${approvalId}/decision`, { decision: 'approved' })).status).toBe(403); // not one's own
    expect((await second.call('POST', `/staff/approvals/${approvalId}/decision`, { decision: 'approved' })).status).toBe(200);
    expect(await dispute(c.disputeId)).toMatchObject({ status: 'decided', outcome: 'full_refund', approval_id: approvalId });
    expect(await escrow(c.orderId)).toBe('refunded');
  });

  it('FR-DSP-06 outcome (d) waits for the item: the escrow stays frozen until the seller records it back, then the buyer is refunded', async () => {
    const c = await disputeUnderReview();
    await fx.query(`UPDATE orders.orders SET fulfilment = 'self_pickup', delivery_quote_id = NULL, fulfilment_step = 'meetup_handover', delivery_event_source = 'handover_code' WHERE id = $1`, [c.orderId]); // a meetup order is returned by meetup
    const op = await operator();
    await op.call('POST', `/staff/cases/dispute/${c.disputeId}/claim`);
    expect(await errors(await op.call('POST', `/staff/disputes/${c.disputeId}/decision`, { outcome: 'refund_after_return', reason }))).toEqual([{ field: 'returnPayer', reason: 'required' }]);
    expect(await (await op.call('POST', `/staff/disputes/${c.disputeId}/decision`, { outcome: 'refund_after_return', reason, returnPayer: 'seller' })).json()).toEqual({ status: 'awaiting_return' });
    expect([(await dispute(c.disputeId)).status, await escrow(c.orderId)]).toEqual(['awaiting_return', 'frozen_disputed']);
    expect((await c.buyer.call('POST', `/disputes/${c.disputeId}/return-received`)).status).toBe(404); // the seller records it
    expect(await (await c.seller.call('POST', `/disputes/${c.disputeId}/return-received`)).json()).toEqual({ status: 'decided' });
    expect([(await dispute(c.disputeId)).status, await escrow(c.orderId)]).toEqual(['decided', 'refunded']);
    expect(await errors(await c.seller.call('POST', `/disputes/${c.disputeId}/return-received`))).toEqual([{ field: 'dispute', reason: 'not-in-this-state' }]);

    // or Unit 4 reports the courier return delivered
    const d = await disputeUnderReview();
    await fx.query(`UPDATE orders.orders SET fulfilment = 'self_pickup', delivery_quote_id = NULL, fulfilment_step = 'meetup_handover', delivery_event_source = 'handover_code' WHERE id = $1`, [d.orderId]);
    await op.call('POST', `/staff/cases/dispute/${d.disputeId}/claim`);
    await op.call('POST', `/staff/disputes/${d.disputeId}/decision`, { outcome: 'refund_after_return', reason, returnPayer: 'buyer' });
    const delivered = event('delivery.return.delivered', d.orderId, { direction: 'return', status: 'delivered' });
    await consume(delivered);
    await consume(delivered); // redelivered: nothing more
    expect([(await dispute(d.disputeId)).status, await escrow(d.orderId)]).toEqual(['decided', 'refunded']);
    await consume(event('delivery.return.delivered', randomUUID(), { direction: 'return' })); // a return without a dispute: ignored
  });
  it('FR-DSP-06 U10-23 on a meetup order whose code was entered a refund is decided only as a refund after the return; a release is still possible', async () => {
    const c = await disputeUnderReview();
    await fx.query(`UPDATE orders.orders SET fulfilment = 'self_pickup', delivery_quote_id = NULL, fulfilment_step = 'meetup_handover', delivery_event_source = 'handover_code' WHERE id = $1`, [c.orderId]);
    const op = await operator();
    await op.call('POST', `/staff/cases/dispute/${c.disputeId}/claim`);
    expect(await errors(await op.call('POST', `/staff/disputes/${c.disputeId}/decision`, { outcome: 'full_refund', reason }))).toEqual([{ field: 'outcome', reason: 'return-first' }]);
    expect(await errors(await op.call('POST', `/staff/disputes/${c.disputeId}/decision`, { outcome: 'partial_refund', reason, itemRefund: '500000' }))).toEqual([{ field: 'outcome', reason: 'return-first' }]);
    expect((await op.call('POST', `/staff/disputes/${c.disputeId}/decision`, { outcome: 'release', reason })).status).toBe(200);
  });
  const meetupWithDevice = async (serial: string, price = 1500000) => {
    const c = await disputeUnderReview(price);
    const digest = deviceDigest(t.app.get<TbConfig>(TB_CONFIG).secrets.handoverKey.reveal(), serial).toString('hex');
    await fx.query(`UPDATE orders.orders SET fulfilment = 'self_pickup', delivery_quote_id = NULL, fulfilment_step = 'meetup_handover', delivery_event_source = 'handover_code',
                       listing_snapshot = $2::jsonb WHERE id = $1`, [c.orderId, JSON.stringify({ title: 'Camera', serialDigest: digest, serialLast4: deviceLast4(serial) })]);
    return c;
  };

  it('FR-TNS-10 U10-23 the return check: the seller cannot take the item back without a matching number; a mismatch opens a signal and only an operator can close the dispute, as a rejected return (the seller is paid) or a completed one (the buyer is refunded)', async () => {
    const c = await meetupWithDevice('SN-1234-5678');
    const op = await operator();
    await op.call('POST', `/staff/cases/dispute/${c.disputeId}/claim`);
    expect((await op.call('POST', `/staff/disputes/${c.disputeId}/decision`, { outcome: 'refund_after_return', reason, returnPayer: 'seller' })).status).toBe(200);
    expect(((await (await c.seller.call('GET', `/disputes/${c.disputeId}`)).json()) as { returnStep: unknown }).returnStep).toEqual({ manual: true, last4: '5678', check: 'none' });
    expect((await (await c.buyer.call('GET', `/disputes/${c.disputeId}`)).json() as { returnStep: unknown }).returnStep).toBeNull();
    expect(await errors(await c.seller.call('POST', `/disputes/${c.disputeId}/return-received`))).toEqual([{ field: 'dispute', reason: 'return-check-needed' }]);
    expect((await c.buyer.call('POST', `/disputes/${c.disputeId}/return-check`, { value: 'SN-1234-5678' })).status).toBe(404); // the seller's
    expect(await (await c.seller.call('POST', `/disputes/${c.disputeId}/return-check`, { value: 'OTHER-UNIT-99' })).json()).toEqual({ matched: false });
    expect(((await (await c.seller.call('GET', `/disputes/${c.disputeId}`)).json()) as { returnStep: { check: string } }).returnStep.check).toBe('mismatch');
    expect(await errors(await c.seller.call('POST', `/disputes/${c.disputeId}/return-check`, { value: 'SN-1234-5678' }))).toEqual([{ field: 'value', reason: 'already-checked' }]); // final: the right number now does not help
    expect((await fx.query(`SELECT 1 FROM trust.signals WHERE kind = 'return_mismatch' AND source_ref = $1`, [c.disputeId])).length).toBe(1);
    expect(await errors(await c.seller.call('POST', `/disputes/${c.disputeId}/return-received`))).toEqual([{ field: 'dispute', reason: 'return-check-needed' }]); // still blocked
    const file = async (id: string) => ((await (await op.call('GET', `/staff/disputes/${id}/case-file`)).json()) as { returnCheck: { canResolve: boolean; findings: string[]; checks: { matched: boolean }[] } }).returnCheck;
    expect(await file(c.disputeId)).toMatchObject({ canResolve: true, findings: [], checks: [{ matched: false }] });
    expect((await op.call('POST', `/staff/disputes/${c.disputeId}/resolve-return`, { outcome: 'release', reason: 'short' })).status).toBe(400);
    expect((await op.call('POST', `/staff/disputes/${c.disputeId}/resolve-return`, { outcome: 'release', reason: 'The returned unit has another serial number than the one sold.' })).status).toBe(200);
    expect([(await dispute(c.disputeId)).status, await escrow(c.orderId)]).toEqual(['decided', 'released']);
    // a dispute whose return is not stuck cannot be closed by an operator ahead of the seller
    const ok = await meetupWithDevice('SN-1234-5678');
    await op.call('POST', `/staff/cases/dispute/${ok.disputeId}/claim`);
    await op.call('POST', `/staff/disputes/${ok.disputeId}/decision`, { outcome: 'refund_after_return', reason, returnPayer: 'seller' });
    expect(await errors(await op.call('POST', `/staff/disputes/${ok.disputeId}/resolve-return`, { outcome: 'refund', reason: 'The seller has not answered for a long time now.' }))).toEqual([{ field: 'dispute', reason: 'return-not-stuck' }]);
    expect(await (await ok.seller.call('POST', `/disputes/${ok.disputeId}/return-check`, { value: 'sn 1234 5678' })).json()).toEqual({ matched: true });
    expect(await (await ok.seller.call('POST', `/disputes/${ok.disputeId}/return-received`)).json()).toEqual({ status: 'decided' });
    expect(await escrow(ok.orderId)).toBe('refunded');
  });

  it('FR-TNS-10 U10-23 a buyer finding: only on a decided dispute of the operator\'s case, once; false_claim only when the seller was paid in full, swap only after a return mismatch; a swap suspends buying at once; a buyer strike never suspends selling', async () => {
    const op = await operator();
    // false claim: the dispute is decided as a release
    const a = await disputeUnderReview();
    await op.call('POST', `/staff/cases/dispute/${a.disputeId}/claim`);
    expect(await errors(await op.call('POST', `/staff/disputes/${a.disputeId}/buyer-finding`, { finding: 'false_claim', reason: 'The buyer broke the item himself, the handover video shows it working.' }))).toEqual([{ field: 'dispute', reason: 'not-in-this-state' }]); // not decided yet
    expect((await op.call('POST', `/staff/disputes/${a.disputeId}/decision`, { outcome: 'release', reason })).status).toBe(200);
    const text = 'The buyer broke the item himself, the handover video shows it working.';
    expect(await (await op.call('POST', `/staff/disputes/${a.disputeId}/buyer-finding`, { finding: 'false_claim', reason: text })).json()).toEqual({ strike: true, suspended: false });
    expect(await errors(await op.call('POST', `/staff/disputes/${a.disputeId}/buyer-finding`, { finding: 'false_claim', reason: text }))).toEqual([{ field: 'dispute', reason: 'finding-exists' }]);
    expect(await errors(await op.call('POST', `/staff/disputes/${a.disputeId}/buyer-finding`, { finding: 'swap', reason: text }))).toEqual([{ field: 'finding', reason: 'no-return-mismatch' }]);
    // a refunded buyer is not struck for a false claim
    const b = await disputeUnderReview();
    await op.call('POST', `/staff/cases/dispute/${b.disputeId}/claim`);
    await op.call('POST', `/staff/disputes/${b.disputeId}/decision`, { outcome: 'full_refund', reason });
    expect(await errors(await op.call('POST', `/staff/disputes/${b.disputeId}/buyer-finding`, { finding: 'false_claim', reason: text }))).toEqual([{ field: 'finding', reason: 'seller-not-paid-in-full' }]);
    // a swap: the return mismatch, the operator's rejection, then the finding: the buyer's buying is suspended at once
    const s2 = await meetupWithDevice('IMEI-352099001761481');
    await op.call('POST', `/staff/cases/dispute/${s2.disputeId}/claim`);
    await op.call('POST', `/staff/disputes/${s2.disputeId}/decision`, { outcome: 'refund_after_return', reason, returnPayer: 'seller' });
    await s2.seller.call('POST', `/disputes/${s2.disputeId}/return-check`, { value: 'CLONE-0000000' });
    await op.call('POST', `/staff/disputes/${s2.disputeId}/resolve-return`, { outcome: 'release', reason: 'The returned unit has another identifier than the one sold.' });
    expect(await (await op.call('POST', `/staff/disputes/${s2.disputeId}/buyer-finding`, { finding: 'swap', reason: 'The returned unit is not the phone sold: its identifier is another.' })).json()).toEqual({ strike: true, suspended: true });
    expect((await fx.query(`SELECT kind FROM trust.sanctions WHERE user_id = $1 AND lifted_at IS NULL`, [s2.buyer.userId])).map((r: { kind: string }) => r.kind)).toEqual(['buying_suspended']);
    expect((await fx.query(`SELECT 1 FROM trust.signals WHERE kind = 'blacklist_review' AND source_ref = $1`, [s2.disputeId])).length).toBe(1);
    // the strike counts as a buyer strike only: it never suspends selling
    expect((await fx.query(`SELECT reason FROM trust.strikes WHERE user_id = $1`, [s2.buyer.userId])).map((r: { reason: string }) => r.reason)).toEqual(['buyer_swap']);
    expect((await fx.query(`SELECT 1 FROM trust.sanctions WHERE user_id = $1 AND kind = 'selling_suspended'`, [s2.buyer.userId])).length).toBe(0);
  });
  it('FR-TNS-10 U10-23 two buyer strikes in 365 days suspend buying and bidding automatically, pending review, once; seller strikes are not counted', async () => {
    const op = await operator();
    const a = await disputeUnderReview();
    const other = await disputeUnderReview();
    // an earlier strike of the same buyer on another order (60 days ago), and a seller strike that must not count
    await fx.query(`INSERT INTO trust.strikes (user_id, reason, order_id, at) VALUES ($1, 'buyer_false_claim', $2, now() - interval '60 days')`, [a.buyer.userId, other.orderId]);
    await fx.query(`INSERT INTO trust.strikes (user_id, reason, order_id) VALUES ($1, 'dispute_lost', $2)`, [a.buyer.userId, a.orderId]);
    await op.call('POST', `/staff/cases/dispute/${a.disputeId}/claim`);
    await op.call('POST', `/staff/disputes/${a.disputeId}/decision`, { outcome: 'release', reason });
    expect(await (await op.call('POST', `/staff/disputes/${a.disputeId}/buyer-finding`, { finding: 'false_claim', reason: 'The buyer broke the item himself, the handover video shows it working.' })).json()).toEqual({ strike: true, suspended: true });
    expect((await fx.query(`SELECT kind, automatic FROM trust.sanctions WHERE user_id = $1 AND lifted_at IS NULL`, [a.buyer.userId]))).toEqual([{ kind: 'buying_suspended', automatic: true }]);
  });
});
