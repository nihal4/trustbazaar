import { randomUUID } from 'crypto';
import type Redis from 'ioredis';
import { DataSource, EntityManager } from 'typeorm';
import { JobRunner } from '../../src/kernel/jobs/job-runner';
import { REDIS } from '../../src/kernel/redis.provider';
import { mockKey } from '../../src/modules/orders/adapters/mock-provider';
import { OrdersJobs } from '../../src/modules/orders/jobs/orders.jobs';
import { ESCROW_COMMANDS, EscrowCommands } from '../../src/modules/orders/ports';
import { startApp, TestApp } from '../support/app';
import { IdentityFixtures } from '../support/identity';

// U2-07: Unit 2's scheduled jobs (docs/design/02_orders_payments.pdf sections 5.8 and 5.13; NFR-REL-03),
// against PostgreSQL and Redis with the mock providers. The runner is off in tests; the jobs are run by hand,
// until nothing is left, because other test files leave due rows of their own.
describe('orders jobs', () => {
  let t: TestApp;
  let fx: IdentityFixtures;
  let jobs: OrdersJobs;
  let db: DataSource;

  beforeAll(async () => {
    t = await startApp();
    fx = await IdentityFixtures.open();
    jobs = t.app.get(OrdersJobs);
    db = t.app.get(DataSource);
  });
  afterAll(async () => {
    await fx?.close();
    await t?.close();
  });

  const one = async <T = Record<string, unknown>>(sql: string, p: unknown[]) => (await fx.query<T>(sql, p))[0];
  /** Runs a job until a run handles nothing (bounded). */
  const drain = async (run: () => Promise<number>) => {
    for (let i = 0; i < 30 && (await run()) > 0; i++);
  };
  const events = (id: string) => fx.query<{ event_type: string; payload: Record<string, unknown> }>(`SELECT event_type, payload FROM orders.outbox WHERE aggregate_id = $1 ORDER BY created_at`, [id]);

  async function order(o: { kind?: string; status?: string; due?: string; fulfilment?: string; step?: string; stepDue?: string; doneAgo?: string; delivered?: boolean } = {}) {
    const [buyer, seller] = [await fx.user(), await fx.user()];
    const courier = o.fulfilment === 'courier';
    const paid = o.status === 'paid';
    const [{ id }] = await fx.query<{ id: string }>(
      `INSERT INTO orders.orders (kind, listing_id, item_kind, buyer_id, seller_id, quantity, unit_price, item_price, fulfilment, delivery_quote_id, delivery_fee, total,
          listing_snapshot, commission_bps, delivery_margin_bps, params_version, payment_due_at, status, paid_at, fulfilment_step, fulfilment_due_at)
       VALUES ($1, $2, 'physical', $3, $4, 1, 1000000, 1000000, $5, $6, $7, $8, '{"title":"Item"}', 500, 1000, 1, now() + $9::interval, $10,
               $11, $12, $13)
       RETURNING id`,
      [
        o.kind ?? 'fixed_price', randomUUID(), buyer, seller, o.fulfilment ?? 'self_pickup', courier ? randomUUID() : null, courier ? 15_000 : 0, courier ? 1_015_000 : 1_000_000,
        o.due ?? '-1 minute', o.status ?? 'awaiting_payment', paid ? new Date() : null, paid ? (o.step ?? 'meetup_handover') : null,
        paid ? await one<{ t: Date }>(`SELECT now() + $1::interval AS t`, [o.stepDue ?? '7 days']).then((r) => r.t) : null,
      ],
    );
    if (paid) {
      await fx.query(`INSERT INTO payments.attempts (purpose, order_id, payer_id, provider, amount, status, expires_at, confirmed_at, provider_txn_id) VALUES ('order', $1, $2, 'bkash', $3, 'succeeded', now(), now(), 'txn-1')`, [id, buyer, courier ? 1_015_000 : 1_000_000]);
      await fx.query(`INSERT INTO orders.escrows (order_id, release_policy, amount_collected) VALUES ($1, 'standard', $2)`, [id, courier ? 1_015_000 : 1_000_000]);
      if (o.doneAgo) {
        const at = await one<{ t: Date }>(`SELECT now() - $1::interval AS t`, [o.doneAgo]).then((r) => r.t);
        await db.transaction(async (m: EntityManager) => {
          const cmd = t.app.get<EscrowCommands>(ESCROW_COMMANDS);
          await cmd.recordFulfilmentStep(id, (o.step ?? 'meetup_handover') as never, at, m);
          if (o.delivered) await cmd.recordDeliveryEvent(id, courier ? 'courier_delivered' : 'handover_code', at, m);
        });
      }
    }
    return { id, buyer, seller };
  }
  async function attempt(orderId: string, payer: string, status = 'redirected', mock?: 'pending' | 'succeeded') {
    const [{ id }] = await fx.query<{ id: string }>(
      `INSERT INTO payments.attempts (purpose, order_id, payer_id, provider, amount, status, expires_at, provider_payment_id, created_at)
       VALUES ('order', $1, $2, 'bkash', 1000000, $3, now() + interval '10 minutes', 'pp-' || gen_random_uuid(), now() - interval '5 minutes') RETURNING id`,
      [orderId, payer, status],
    );
    if (mock) await t.app.get<Redis>(REDIS).set(mockKey(id), JSON.stringify({ amount: '1000000', status: mock }), 'EX', 3600);
    return id;
  }

  it('NFR-REL-03 every Unit 2 job is registered with the runner', () => {
    const names = t.app.get(JobRunner).stats().map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining([
      'orders.payment.expire', 'orders.fulfilment.deadline', 'orders.escrow.auto_release', 'orders.delivery.stalled',
      'orders.cancellation.lapse', 'orders.reconciliation', 'orders.refunds.send', 'orders.payouts.send',
    ]));
  });

  it('FR-FIX-03 an unpaid order past its hold is cancelled, its attempts expire and the stock is returned', async () => {
    const o = await order();
    const a = await attempt(o.id, o.buyer, 'redirected', 'pending');
    const later = await order({ due: '10 minutes' });
    await drain(() => jobs.expirePayments());
    expect(await one(`SELECT status, cancel_reason FROM orders.orders WHERE id = $1`, [o.id])).toEqual({ status: 'cancelled', cancel_reason: 'checkout_expired' });
    expect(await one(`SELECT status FROM payments.attempts WHERE id = $1`, [a])).toEqual({ status: 'expired' });
    expect((await events(o.id)).map((e) => e.event_type)).toEqual(['orders.order.cancelled']);
    expect((await events(o.id))[0].payload).toMatchObject({ listingId: expect.any(String), quantity: 1, reason: 'checkout_expired' });
    expect(await one(`SELECT status FROM orders.orders WHERE id = $1`, [later.id])).toEqual({ status: 'awaiting_payment' });
  });

  it('FR-AUC-14 an unpaid auction order is cancelled with payment_window_expired and reported for the strike', async () => {
    const o = await order({ kind: 'auction' });
    await drain(() => jobs.expirePayments());
    expect(await one(`SELECT cancel_reason FROM orders.orders WHERE id = $1`, [o.id])).toEqual({ cancel_reason: 'payment_window_expired' });
    expect((await events(o.id)).map((e) => e.event_type)).toEqual(['orders.order.cancelled', 'orders.order.payment_expired']);
  });

  it('FR-PAY-15 a payment that succeeded without a callback is confirmed by the expiry job, not lost', async () => {
    const o = await order({ fulfilment: 'self_pickup' });
    const a = await attempt(o.id, o.buyer, 'redirected', 'succeeded');
    await drain(() => jobs.expirePayments());
    expect(await one(`SELECT status FROM orders.orders WHERE id = $1`, [o.id])).toEqual({ status: 'paid' });
    expect(await one(`SELECT status, provider_txn_id FROM payments.attempts WHERE id = $1`, [a])).toEqual({ status: 'succeeded', provider_txn_id: expect.stringMatching(/^mocktxn_/) });
  });

  it('FR-PAY-08 a missed fulfilment deadline refunds the buyer in full, with the reason for the strike', async () => {
    const late = await order({ status: 'paid', fulfilment: 'courier', step: 'courier_pickup', stepDue: '-1 minute' });
    const onTime = await order({ status: 'paid', stepDue: '1 day' });
    const disputed = await order({ status: 'paid', stepDue: '-1 minute' });
    await fx.query(`UPDATE orders.escrows SET state = 'frozen_disputed', open_dispute_id = gen_random_uuid() WHERE order_id = $1`, [disputed.id]);
    await fx.query(`INSERT INTO orders.cancellation_requests (order_id, requested_by, reason) VALUES ($1, $2, 'please')`, [late.id, late.buyer]);
    await drain(() => jobs.missedDeadlines());
    expect(await one(`SELECT state, amount_refunded FROM orders.escrows WHERE order_id = $1`, [late.id])).toEqual({ state: 'refunded', amount_refunded: '1015000' });
    expect(await one(`SELECT reason, amount FROM payments.refunds WHERE order_id = $1`, [late.id])).toEqual({ reason: 'fulfilment_deadline', amount: '1015000' });
    const refunded = (await events(late.id)).find((e) => e.event_type === 'orders.escrow.refunded');
    expect(refunded?.payload).toMatchObject({ reason: 'fulfilment_deadline', sellerId: late.seller }); // I-44
    expect(await one(`SELECT status FROM orders.cancellation_requests WHERE order_id = $1`, [late.id])).toEqual({ status: 'lapsed' });
    expect(await one(`SELECT state FROM orders.escrows WHERE order_id = $1`, [disputed.id])).toEqual({ state: 'frozen_disputed' }); // no refund while a dispute is open
    expect(await one(`SELECT state FROM orders.escrows WHERE order_id = $1`, [onTime.id])).toEqual({ state: 'held' });
  });

  it('FR-PAY-07 auto-release releases held escrows past their date, once', async () => {
    const o = await order({ status: 'paid', doneAgo: '6 days', delivered: true });
    const notYet = await order({ status: 'paid', doneAgo: '1 day', delivered: true });
    await drain(() => jobs.autoRelease());
    expect(await one(`SELECT state FROM orders.escrows WHERE order_id = $1`, [o.id])).toEqual({ state: 'released' });
    expect(await one(`SELECT state FROM orders.escrows WHERE order_id = $1`, [notYet.id])).toEqual({ state: 'held' });
    await drain(() => jobs.autoRelease());
    expect(await one(`SELECT count(*)::int AS n FROM payments.settlements WHERE order_id = $1`, [o.id])).toEqual({ n: 1 });
  });

  it('FR-DLV-11 a courier pickup with no delivery for CP-17 + CP-18 raises one stalled_delivery issue', async () => {
    const stalled = await order({ status: 'paid', fulfilment: 'courier', step: 'courier_pickup', doneAgo: '11 days' });
    const fresh = await order({ status: 'paid', fulfilment: 'courier', step: 'courier_pickup', doneAgo: '9 days' });
    await drain(() => jobs.stalledDeliveries());
    await drain(() => jobs.stalledDeliveries());
    expect(await fx.query(`SELECT kind FROM payments.reconciliation_issues WHERE order_id = $1`, [stalled.id])).toEqual([{ kind: 'stalled_delivery' }]);
    expect(await fx.query(`SELECT kind FROM payments.reconciliation_issues WHERE order_id = $1`, [fresh.id])).toEqual([]);
    expect(await one(`SELECT state FROM orders.escrows WHERE order_id = $1`, [stalled.id])).toEqual({ state: 'held' }); // nothing automatic
  });

  it('FR-PAY-09 a pending cancellation request lapses at the delivery event', async () => {
    const o = await order({ status: 'paid', doneAgo: '1 hour', delivered: true });
    const open = await order({ status: 'paid' });
    for (const x of [o, open]) await fx.query(`INSERT INTO orders.cancellation_requests (order_id, requested_by, reason) VALUES ($1, $2, 'please')`, [x.id, x.buyer]);
    await jobs.lapseCancellations();
    expect(await one(`SELECT status FROM orders.cancellation_requests WHERE order_id = $1`, [o.id])).toEqual({ status: 'lapsed' });
    expect(await one(`SELECT status FROM orders.cancellation_requests WHERE order_id = $1`, [open.id])).toEqual({ status: 'pending' });
  });

  it('FR-PAY-15 reconciliation queries stale attempts and flags a paid order without a provider transaction id, once', async () => {
    const o = await order({ due: '1 day' });
    const failed = await attempt(o.id, o.buyer, 'redirected'); // nothing in the mock's record: the provider says failed
    const p = await order({ status: 'paid' });
    await fx.query(`UPDATE payments.attempts SET provider_txn_id = NULL WHERE order_id = $1`, [p.id]);
    await drain(() => jobs.reconcile());
    expect(await one(`SELECT status FROM payments.attempts WHERE id = $1`, [failed])).toEqual({ status: 'failed' });
    expect(await fx.query(`SELECT kind FROM payments.reconciliation_issues WHERE order_id = $1`, [p.id])).toEqual([{ kind: 'provider_disagrees' }]);
  });

  it('FR-PAY-12 the refund and payout workers run as jobs', async () => {
    const runner = t.app.get(JobRunner);
    for (const name of ['orders.refunds.send', 'orders.payouts.send']) {
      const s = await runner.runNow(name);
      expect([s.runs >= 1, s.lastError]).toEqual([true, null]);
    }
  });
});
