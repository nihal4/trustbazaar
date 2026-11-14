import { randomInt, randomUUID } from 'crypto';
import type { OutboxEvent } from '../../src/kernel/events/event-bus';
import { ReminderConsumers } from '../../src/modules/chat/consumers/reminder.consumers';
import { ReminderService } from '../../src/modules/chat/services/reminder.service';
import { ESCROW_QUERY, EscrowQuery } from '../../src/modules/orders/ports';
import { startApp, TestApp } from '../support/app';
import { IdentityFixtures } from '../support/identity';

// U6-06: deadline reminders (docs/design/06_chat_notifications.pdf section 7.6; FR-NTF-07, CP-38) against PostgreSQL:
// scheduled and cancelled from Unit 2's and Unit 4's events, then claimed by the job, checked with Unit 2's deadline
// query and sent. Orders are written directly in the states the events describe; the events are handed to the
// consumer as the outbox dispatcher would hand them. The database's clock decides what is due (claim_due_reminders),
// so a deadline "2 hours minus a minute" away has its 2-hour reminder due now.
describe('deadline reminders', () => {
  let t: TestApp;
  let fx: IdentityFixtures;
  let consumers: ReminderConsumers;
  let reminders: ReminderService;

  beforeAll(async () => {
    t = await startApp();
    fx = await IdentityFixtures.open();
    consumers = t.app.get(ReminderConsumers);
    reminders = t.app.get(ReminderService);
  });
  afterAll(async () => {
    await fx?.close();
    await t?.close();
  });

  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;
  const event = (type: string, orderId: string, payload: Record<string, unknown>): OutboxEvent =>
    ({ outbox: type.split('.')[0], id: String(randomInt(1, 2 ** 31)), type, aggregateId: orderId, payload: { orderId, ...payload }, createdAt: new Date(), attempt: 1 });

  /** An order in the given state: awaiting payment (an auction win), or paid with its escrow held. */
  async function order(o: { status: 'awaiting_payment' | 'paid'; fulfilment?: 'self_pickup' | 'courier'; dueIn?: number; disputeIn?: number }) {
    const [buyerId, sellerId] = [await fx.user(), await fx.user()];
    const paid = o.status === 'paid';
    const fulfilment = paid ? (o.fulfilment ?? 'self_pickup') : null;
    const due = new Date(Date.now() + (o.dueIn ?? 3 * DAY));
    const [{ id }] = await fx.query<{ id: string }>(
      `INSERT INTO orders.orders (kind, listing_id, item_kind, buyer_id, seller_id, quantity, unit_price, item_price, fulfilment, delivery_quote_id, delivery_fee, total,
          listing_snapshot, commission_bps, delivery_margin_bps, params_version, payment_due_at, status, paid_at, fulfilment_step, fulfilment_due_at)
       VALUES ('auction', $1, 'physical', $2, $3, 1, 1000000, 1000000, $4, $5, $6, $7, '{"title":"Walton fridge"}', 500, 1000, 1, $8, $9, $10, $11, $12)
       RETURNING id`,
      [randomUUID(), buyerId, sellerId, fulfilment, fulfilment === 'courier' ? randomUUID() : null, fulfilment === 'courier' ? 15000 : 0,
       fulfilment === 'courier' ? 1015000 : 1000000, paid ? new Date() : due, o.status, paid ? new Date() : null,
       paid ? (fulfilment === 'courier' ? 'courier_pickup' : 'meetup_handover') : null, paid ? due : null],
    );
    if (paid) {
      await fx.query(`INSERT INTO payments.attempts (purpose, order_id, payer_id, provider, amount, status, expires_at, confirmed_at) VALUES ('order', $1, $2, 'bkash', 1000000, 'succeeded', now(), now())`, [id, buyerId]);
      await fx.query(`INSERT INTO orders.escrows (order_id, release_policy, amount_collected, dispute_window_ends_at) VALUES ($1, 'standard', 1000000, $2)`,
        [id, o.disputeIn ? new Date(Date.now() + o.disputeIn) : null]);
    }
    return { id, buyerId, sellerId, due, fulfilment };
  }
  const paidEvent = (o: Awaited<ReturnType<typeof order>>) =>
    event('orders.order.paid', o.id, { kind: 'auction', itemKind: 'physical', buyerId: o.buyerId, sellerId: o.sellerId, fulfilment: o.fulfilment,
      fulfilmentStep: o.fulfilment === 'courier' ? 'courier_pickup' : 'meetup_handover', fulfilmentDueAt: o.due.toISOString(), listingTitle: 'Walton fridge', total: '1000000' });
  const rows = (orderId: string) =>
    fx.query<{ user_id: string; kind: string; lead: string; status: string; due_at: Date }>(
      `SELECT user_id, kind, lead::text AS lead, status, due_at FROM notify.reminders WHERE subject_id = $1 ORDER BY kind, user_id, lead`, [orderId]);
  const notices = (userId: string) =>
    fx.query<{ template_code: string; params: Record<string, unknown>; subject_id: string }>(
      `SELECT template_code, params, subject_id FROM notify.notifications WHERE user_id = $1 AND template_code LIKE 'reminder.%'`, [userId]);
  /** As if minutes had passed: the order's fulfilment deadline and its reminders move that much closer. */
  async function minutesPass(orderId: string, minutes: number) {
    await fx.query(`UPDATE orders.orders SET fulfilment_due_at = fulfilment_due_at - $2::interval WHERE id = $1`, [orderId, `${minutes} minutes`]);
    await fx.query(`UPDATE notify.reminders SET due_at = due_at - $2::interval, fire_at = fire_at - $2::interval WHERE subject_id = $1`, [orderId, `${minutes} minutes`]);
  }
  /** Runs the job until none of the order's reminders is still due (other suites' due reminders may share a batch). */
  async function runJob(orderId: string) {
    for (let i = 0; i < 20; i++) {
      await reminders.sendDue();
      const [{ n }] = await fx.query<{ n: number }>(`SELECT count(*)::int AS n FROM notify.reminders WHERE subject_id = $1 AND status = 'scheduled' AND fire_at <= now()`, [orderId]);
      if (n === 0) return;
    }
  }

  it('FR-NTF-07 CP-38 an auction win schedules the buyer\'s payment reminders 24 and 2 hours before; paying cancels them and schedules the handover\'s for both', async () => {
    const o = await order({ status: 'awaiting_payment' });
    const created = event('orders.order.created', o.id, { kind: 'auction', buyerId: o.buyerId, sellerId: o.sellerId, listingTitle: 'Walton fridge', total: '1000000', paymentDueAt: o.due.toISOString() });
    await consumers.handle(created);
    await consumers.handle(created); // delivered twice: no duplicate (DC-6)
    expect(await rows(o.id)).toEqual([
      { user_id: o.buyerId, kind: 'payment_window', lead: '02:00:00', status: 'scheduled', due_at: o.due },
      { user_id: o.buyerId, kind: 'payment_window', lead: '24:00:00', status: 'scheduled', due_at: o.due },
    ]);
    const [{ fire }] = await fx.query<{ fire: Date }>(`SELECT min(fire_at) AS fire FROM notify.reminders WHERE subject_id = $1`, [o.id]);
    expect(fire).toEqual(new Date(o.due.getTime() - DAY));
    // a fixed-price checkout's window is minutes long: no reminder
    const fixed = await order({ status: 'awaiting_payment' });
    await consumers.handle(event('orders.order.created', fixed.id, { kind: 'fixed_price', buyerId: fixed.buyerId, sellerId: fixed.sellerId, paymentDueAt: fixed.due.toISOString() }));
    expect(await rows(fixed.id)).toEqual([]);

    await fx.query(`UPDATE orders.orders SET status = 'paid', paid_at = now(), fulfilment = 'self_pickup', fulfilment_step = 'meetup_handover', fulfilment_due_at = $2 WHERE id = $1`, [o.id, o.due]);
    await consumers.handle(paidEvent({ ...o, fulfilment: 'self_pickup' }));
    const after = await rows(o.id);
    expect(after.filter((r) => r.kind === 'payment_window').map((r) => r.status)).toEqual(['cancelled', 'cancelled']);
    expect(after.filter((r) => r.kind === 'meetup_handover').map((r) => [r.user_id, r.lead]).sort()).toEqual(
      [[o.buyerId, '02:00:00'], [o.buyerId, '24:00:00'], [o.sellerId, '02:00:00'], [o.sellerId, '24:00:00']].sort());
  });

  it('FR-NTF-07 a moved deadline moves its reminders instead of adding new ones; a lead whose time has passed is not scheduled', async () => {
    const o = await order({ status: 'paid', fulfilment: 'courier', dueIn: 5 * HOUR });
    await consumers.handle(paidEvent(o));
    expect((await rows(o.id)).map((r) => [r.user_id, r.kind, r.lead])).toEqual([[o.sellerId, 'courier_pickup', '02:00:00']]); // the seller alone; 24 h before has passed
    const later = new Date(o.due.getTime() + 2 * DAY);
    await consumers.handle(paidEvent({ ...o, due: later }));
    expect(await rows(o.id)).toEqual([
      { user_id: o.sellerId, kind: 'courier_pickup', lead: '02:00:00', status: 'scheduled', due_at: later },
      { user_id: o.sellerId, kind: 'courier_pickup', lead: '24:00:00', status: 'scheduled', due_at: later },
    ]);
    // the courier has the parcel: the pickup deadline is met (a return shipment's statuses change nothing)
    await consumers.handle(event('delivery.shipment.status_changed', o.id, { shipment: randomUUID(), direction: 'return', status: 'picked_up' }));
    expect((await rows(o.id)).map((r) => r.status)).toEqual(['scheduled', 'scheduled']);
    await consumers.handle(event('delivery.shipment.status_changed', o.id, { shipment: randomUUID(), direction: 'forward', status: 'picked_up' }));
    expect((await rows(o.id)).map((r) => r.status)).toEqual(['cancelled', 'cancelled']);
  });

  it('FR-NTF-07 the job sends a due reminder once to each person, in the app and by e-mail, after checking with Unit 2', async () => {
    const o = await order({ status: 'paid', dueIn: 2 * HOUR + 60_000 }); // a meetup two hours and a minute away
    await consumers.handle(paidEvent(o));
    await reminders.sendDue();
    expect((await rows(o.id)).map((r) => r.status)).toEqual(['scheduled', 'scheduled']); // not yet
    await minutesPass(o.id, 2); // its 2-hour reminders are due now
    await runJob(o.id);
    expect((await rows(o.id)).map((r) => r.status)).toEqual(['sent', 'sent']);
    for (const user of [o.buyerId, o.sellerId]) {
      expect(await notices(user)).toEqual([{ template_code: 'reminder.meetup_handover', params: { listing_title: 'Walton fridge', hours: 2 }, subject_id: o.id }]);
    }
    const [{ channel, category }] = await fx.query<{ channel: string; category: string }>(
      `SELECT d.channel, t.category FROM notify.notifications n JOIN notify.deliveries d ON d.notification_id = n.id
         JOIN notify.templates t ON t.code = n.template_code AND t.version = n.template_version WHERE n.user_id = $1`, [o.buyerId]);
    expect({ channel, category }).toEqual({ channel: 'email', category: 'reminder' }); // never SMS (FR-NTF-05)
    await runJob(o.id);
    expect(await notices(o.buyerId)).toHaveLength(1); // sent once
  });

  it('FR-NTF-07 a reminder that missed its cancellation is dropped, never sent; one whose deadline moved later is re-armed', async () => {
    const done = await order({ status: 'paid', dueIn: 2 * HOUR + 60_000 });
    const moved = await order({ status: 'paid', dueIn: 2 * HOUR + 60_000 });
    await consumers.handle(paidEvent(done));
    await consumers.handle(paidEvent(moved));
    await minutesPass(done.id, 2);
    await minutesPass(moved.id, 2);
    // the handover happened, but its event has not arrived; the other's deadline was extended without an event
    await fx.query(`UPDATE orders.orders SET fulfilment_done_at = now() WHERE id = $1`, [done.id]);
    const extended = new Date(moved.due.getTime() - 2 * 60_000 + DAY);
    await fx.query(`UPDATE orders.orders SET fulfilment_due_at = $2 WHERE id = $1`, [moved.id, extended]);
    await runJob(done.id);
    await runJob(moved.id);
    expect((await rows(done.id)).map((r) => r.status)).toEqual(['cancelled', 'cancelled']);
    expect(await notices(done.buyerId)).toEqual([]);
    expect((await rows(moved.id)).map((r) => [r.status, r.due_at])).toEqual([['scheduled', extended], ['scheduled', extended]]);
    expect(await notices(moved.buyerId)).toEqual([]);
    expect(await t.app.get<EscrowQuery>(ESCROW_QUERY, { strict: false }).deadline(moved.id, 'meetup_handover')).toEqual({ dueAt: extended, listingTitle: 'Walton fridge' });
    expect(await t.app.get<EscrowQuery>(ESCROW_QUERY, { strict: false }).deadline(moved.id, 'courier_pickup')).toBeNull(); // not this order's step
  });

  it('FR-NTF-07 FR-DSP-11 the delivery event starts the buyer\'s dispute-window reminders and ends the handover\'s; a dispute freezing the escrow cancels them', async () => {
    const o = await order({ status: 'paid', disputeIn: 3 * DAY });
    await consumers.handle(paidEvent(o));
    const windowEnds = new Date(Date.now() + 3 * DAY);
    await consumers.handle(event('orders.order.delivered', o.id, { buyerId: o.buyerId, sellerId: o.sellerId, source: 'handover_code', disputeWindowEndsAt: windowEnds.toISOString() }));
    const r = await rows(o.id);
    expect(r.filter((x) => x.kind === 'meetup_handover').map((x) => x.status)).toEqual(['cancelled', 'cancelled', 'cancelled', 'cancelled']);
    expect(r.filter((x) => x.kind === 'dispute_window').map((x) => [x.user_id, x.lead, x.status])).toEqual([[o.buyerId, '02:00:00', 'scheduled'], [o.buyerId, '24:00:00', 'scheduled']]);
    await consumers.handle(event('orders.escrow.frozen', o.id, { buyerId: o.buyerId, sellerId: o.sellerId }));
    expect((await rows(o.id)).every((x) => x.status === 'cancelled')).toBe(true);
  });

  it('FR-NTF-07 FR-NTF-08 every reminder kind Unit 2 answers for has an active template with the parameters a reminder carries', async () => {
    const kinds = ['payment_window', 'meetup_handover', 'courier_pickup', 'credential_delivery', 'dispute_window'];
    const found = await fx.query<{ code: string; category: string; channels: string; allowed: string }>(
      `SELECT code, category, channels::text, allowed_params::text AS allowed FROM notify.templates WHERE active AND code = ANY($1) ORDER BY code`, [kinds.map((k) => `reminder.${k}`)]);
    expect(found.map((f) => f.code)).toEqual(kinds.map((k) => `reminder.${k}`).sort());
    for (const f of found) expect(f).toMatchObject({ category: 'reminder', channels: '{email}', allowed: '{listing_title,hours}' });
  });
});
