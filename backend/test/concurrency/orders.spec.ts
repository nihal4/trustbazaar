import { randomInt, randomUUID } from 'crypto';
import type Redis from 'ioredis';
import { DataSource, EntityManager } from 'typeorm';
import { REDIS } from '../../src/kernel/redis.provider';
import { MockProvider } from '../../src/modules/orders/adapters/mock-provider';
import { OrdersJobs } from '../../src/modules/orders/jobs/orders.jobs';
import { ESCROW_COMMANDS, EscrowCommands } from '../../src/modules/orders/ports';
import { EscrowService } from '../../src/modules/orders/services/escrow.service';
import { PaymentService } from '../../src/modules/orders/services/payment.service';
import { PayoutService } from '../../src/modules/orders/services/payout.service';
import { RefundService } from '../../src/modules/orders/services/refund.service';
import { startApp, TestApp } from '../support/app';
import { IdentityFixtures } from '../support/identity';

// U2-08: Unit 2's concurrency tests (SRS Appendix A: AC-2, AC-3, AC-6; NFR-PERF-08; docs/design/02_orders_payments.pdf
// section 9), against PostgreSQL and Redis with the mock providers. Every race is started with Promise.all, so the
// requests overlap in the server and in the database; the assertions are on what the database holds afterwards.
// The webhook replays of AC-4 are in webhooks.spec.ts (Stripe needs sandbox mode).
describe('orders under concurrency', () => {
  let t: TestApp;
  let fx: IdentityFixtures;
  let db: DataSource;
  let category: number;

  beforeAll(async () => {
    t = await startApp();
    fx = await IdentityFixtures.open();
    db = t.app.get(DataSource);
    [{ id: category }] = await fx.query<{ id: number }>(
      `INSERT INTO listings.categories (slug, name_en, name_bn, item_kind) VALUES ($1, 'c', 'বি', 'physical') RETURNING id`, [`race-${randomUUID().slice(0, 8)}`],
    );
  });
  afterAll(async () => {
    await fx?.close();
    await t?.close();
  });

  const one = async <T = Record<string, unknown>>(sql: string, p: unknown[]) => (await fx.query<T>(sql, p))[0];
  const count = async (sql: string, p: unknown[]) => (await one<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`, p)).n;

  async function member() {
    const userId = await fx.user();
    const sid = await fx.session({ userId });
    const ip = `203.0.113.${randomInt(1, 255)}, 10.5.${randomInt(0, 255)}.${randomInt(1, 255)}`;
    const call = (method: string, path: string, body?: unknown, extra: Record<string, string> = {}) =>
      fetch(t.url(path), {
        method, redirect: 'manual',
        headers: { ...fx.headers(sid, userId, 'user'), 'x-forwarded-for': ip, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...extra },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    return { userId, sid, call };
  }
  /** An active fixed-price listing with `quantity` units, written as tb_app. */
  async function listing(sellerId: string, quantity = 1) {
    const [{ id }] = await fx.query<{ id: string }>(
      `INSERT INTO listings.listings (seller_id, item_kind, sale_format, category_id, title, description, condition, no_visible_defects,
          fulfilment_options, weight_class, size_class, area_district, approx_lat, approx_lng, price, quantity_total, quantity_available)
       VALUES ($1, 'physical', 'fixed_price', $2, 'Phone for the race tests', 'A phone in good condition, written by the race tests.', 'used', true,
               'pickup_or_courier', 'up_to_1kg', 'small', 'Dhaka', 23.81, 90.41, 1500000, $3, $3) RETURNING id`,
      [sellerId, category, quantity],
    );
    for (const n of [1, 2]) await fx.query(`INSERT INTO listings.listing_photos (listing_id, position, storage_key, width, height) VALUES ($1, $2, $3, 800, 600)`, [id, n, randomUUID().replace(/-/g, '')]);
    await fx.query(`UPDATE listings.listings SET status = 'active', published_at = now() WHERE id = $1`, [id]);
    return id;
  }
  /** A paid order with a held escrow (as a confirmed payment leaves it); optionally delivered `deliveredAgo`. */
  async function paid(o: { game?: boolean; deliveredAgo?: string; price?: number; courier?: boolean } = {}) {
    const [buyer, seller] = [await member(), await member()];
    const price = o.price ?? 1_000_000;
    const fee = o.courier ? 15_000 : 0;
    const fulfilment = o.game ? 'game_account' : o.courier ? 'courier' : 'self_pickup';
    const step = o.game ? 'credentials_delivered' : o.courier ? 'courier_pickup' : 'meetup_handover';
    const [{ id }] = await fx.query<{ id: string }>(
      `INSERT INTO orders.orders (kind, listing_id, item_kind, buyer_id, seller_id, quantity, unit_price, item_price, fulfilment, delivery_quote_id, delivery_fee, total,
          listing_snapshot, commission_bps, delivery_margin_bps, params_version, payment_due_at, status, paid_at, fulfilment_step, fulfilment_due_at)
       VALUES ('fixed_price', $1, $2, $3, $4, 1, $5, $5, $6, $7, $8, $9, '{"title":"Item"}', 500, 1000, 1, now(), 'paid', now(), $10, now() + interval '7 days') RETURNING id`,
      [randomUUID(), o.game ? 'game_account' : 'physical', buyer.userId, seller.userId, price, fulfilment, o.courier ? randomUUID() : null, fee, price + fee, step],
    );
    await fx.query(`INSERT INTO payments.attempts (purpose, order_id, payer_id, provider, amount, status, expires_at, confirmed_at, provider_txn_id) VALUES ('order', $1, $2, 'bkash', $3, 'succeeded', now(), now(), 'txn')`, [id, buyer.userId, price + fee]);
    await fx.query(`INSERT INTO orders.escrows (order_id, release_policy, amount_collected) VALUES ($1, $2, $3)`, [id, o.game ? 'game_protection' : 'standard', price + fee]);
    if (o.deliveredAgo) {
      const [{ at }] = await fx.query<{ at: Date }>(`SELECT now() - $1::interval AS at`, [o.deliveredAgo]);
      await db.transaction(async (m: EntityManager) => {
        const cmd = t.app.get<EscrowCommands>(ESCROW_COMMANDS);
        if (o.game || o.courier) await cmd.recordFulfilmentStep(id, step as never, at, m);
        await cmd.recordDeliveryEvent(id, o.game ? 'game_takeover' : o.courier ? 'courier_delivered' : 'handover_code', at, m);
      });
    }
    return { id, buyer, seller };
  }
  /** What one settled escrow must look like: one terminal transition, one settlement, money in = money out. */
  async function settledOnce(orderId: string) {
    expect(await count(`orders.escrow_history WHERE order_id = $1`, [orderId])).toBe(1);
    expect(await count(`payments.settlements WHERE order_id = $1`, [orderId])).toBe(1);
    expect(await count(`payments.payouts WHERE order_id = $1`, [orderId])).toBeLessThanOrEqual(1);
    expect(await count(`payments.refunds WHERE order_id = $1 AND reason <> 'fee_refund'`, [orderId])).toBeLessThanOrEqual(1);
  }

  it('AC-2 fifty buyers racing for the last unit: exactly one order, the others told it is gone', async () => {
    const seller = await member();
    const id = await listing(seller.userId, 1);
    const buyers = await Promise.all(Array.from({ length: 50 }, () => member()));
    const answers = await Promise.all(buyers.map((b) => b.call('POST', '/orders', { listingId: id, quantity: 1, fulfilment: 'self_pickup' })));
    const statuses = answers.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(49);
    const lost = await Promise.all(answers.filter((r) => r.status === 409).map((r) => r.json()));
    expect(new Set(lost.map((b) => b.type))).toEqual(new Set(['/problems/not-available']));
    expect(await count(`orders.orders WHERE listing_id = $1`, [id])).toBe(1);
    expect(await one(`SELECT quantity_available, quantity_reserved FROM listings.listings WHERE id = $1`, [id])).toEqual({ quantity_available: 0, quantity_reserved: 1 });
  });

  it('AC-2 twenty buyers for three units: exactly three orders, never an over-sale', async () => {
    const seller = await member();
    const id = await listing(seller.userId, 3);
    const buyers = await Promise.all(Array.from({ length: 20 }, () => member()));
    const answers = await Promise.all(buyers.map((b) => b.call('POST', '/orders', { listingId: id, quantity: 1, fulfilment: 'self_pickup' })));
    expect(answers.filter((r) => r.status === 201)).toHaveLength(3);
    expect(await count(`orders.orders WHERE listing_id = $1`, [id])).toBe(3);
    expect(await one(`SELECT quantity_available, quantity_reserved FROM listings.listings WHERE id = $1`, [id])).toEqual({ quantity_available: 0, quantity_reserved: 3 });
  });

  it('AC-4 one mock payment confirmed by 15 callbacks and 5 queries at once is applied exactly once', async () => {
    const seller = await member();
    const buyer = await member();
    const listingId = await listing(seller.userId, 1);
    const order = await (await buyer.call('POST', '/orders', { listingId, quantity: 1, fulfilment: 'self_pickup' })).json();
    const a = await (await buyer.call('POST', `/orders/${order.id}/payments`, { provider: 'bkash' }, { 'idempotency-key': randomUUID() })).json();
    await MockProvider.decide(t.app.get<Redis>(REDIS), a.attemptId, 'succeeded');
    const state = new URL(a.redirectUrl).searchParams.get('state');
    const payments = t.app.get(PaymentService);
    const callbacks = Array.from({ length: 15 }, () => fetch(t.url(`/callbacks/bkash/${a.attemptId}?state=${state}`), { redirect: 'manual' }));
    const queries = Array.from({ length: 5 }, () => payments.reconcile(a.attemptId));
    const results = await Promise.all([...callbacks.map((p) => p.then((r) => new URL(r.headers.get('location')!).searchParams.get('result'))), ...queries]);
    expect(results.filter((r) => r === 'paid')).toHaveLength(1);
    expect(await one(`SELECT status FROM orders.orders WHERE id = $1`, [order.id])).toEqual({ status: 'paid' });
    expect(await count(`orders.escrows WHERE order_id = $1`, [order.id])).toBe(1);
    expect(await count(`payments.journal_entries WHERE order_id = $1 AND kind = 'payment_received'`, [order.id])).toBe(1);
    expect(await count(`payments.refunds WHERE order_id = $1`, [order.id])).toBe(0); // nothing taken twice, so nothing owed back
  });

  it('AC-3 confirm-receipt, auto-release, a dispute and a seller cancellation racing: exactly one outcome', async () => {
    for (let round = 0; round < 5; round++) {
      const o = await paid({ deliveredAgo: '6 days' }); // auto-release is due as well
      const escrow = t.app.get(EscrowService);
      const cmd = t.app.get<EscrowCommands>(ESCROW_COMMANDS);
      await Promise.allSettled([
        ...Array.from({ length: 5 }, () => o.buyer.call('POST', `/orders/${o.id}/confirm-receipt`)),
        ...Array.from({ length: 5 }, () => escrow.autoRelease(o.id)),
        db.transaction((m: EntityManager) => cmd.freezeForDispute(o.id, randomUUID(), m)),
        o.seller.call('POST', `/orders/${o.id}/cancel`, { reason: 'Racing the buyer' }),
      ]);
      const { state } = await one<{ state: string }>(`SELECT state FROM orders.escrows WHERE order_id = $1`, [o.id]);
      expect(['released', 'frozen_disputed']).toContain(state); // the seller can no longer cancel after the delivery event
      expect(await count(`orders.escrow_history WHERE order_id = $1`, [o.id])).toBe(1);
      if (state === 'released') await settledOnce(o.id);
      else expect(await count(`payments.settlements WHERE order_id = $1`, [o.id])).toBe(0);
    }
  });

  it('AC-3 before the delivery event nothing can release the money, however many try', async () => {
    const o = await paid();
    const escrow = t.app.get(EscrowService);
    await fx.query(`UPDATE orders.escrows SET auto_release_at = now() - interval '1 day' WHERE order_id = $1`, [o.id]); // even a stray date
    const answers = await Promise.all([
      ...Array.from({ length: 10 }, () => o.buyer.call('POST', `/orders/${o.id}/confirm-receipt`).then((r) => r.status)),
      ...Array.from({ length: 10 }, () => escrow.autoRelease(o.id)),
    ]);
    expect(answers).toEqual([...Array(10).fill(409), ...Array(10).fill(false)]); // a stray date alone releases nothing
    expect(await one(`SELECT state FROM orders.escrows WHERE order_id = $1`, [o.id])).toEqual({ state: 'held' });
    expect(await count(`orders.escrow_history WHERE order_id = $1`, [o.id])).toBe(0);
  });

  it('AC-6 a game account is not released before its protection period ends, except by the buyer releasing early, once', async () => {
    const o = await paid({ game: true, deliveredAgo: '1 day' });
    const escrow = t.app.get(EscrowService);
    const before = await Promise.all([
      ...Array.from({ length: 10 }, () => escrow.autoRelease(o.id)),
      ...Array.from({ length: 5 }, () => o.buyer.call('POST', `/orders/${o.id}/confirm-receipt`).then((r) => r.status)),
    ]);
    expect(before.slice(0, 10)).toEqual(Array(10).fill(false));
    expect(before.slice(10)).toEqual(Array(5).fill(409));
    expect(await one(`SELECT state FROM orders.escrows WHERE order_id = $1`, [o.id])).toEqual({ state: 'held' });
    const sessions = await Promise.all(Array.from({ length: 5 }, () => fx.session({ userId: o.buyer.userId })));
    const early = await Promise.all(sessions.map(async (sid) =>
      (await fetch(t.url(`/orders/${o.id}/release-early`), {
        method: 'POST', headers: { ...fx.headers(sid, o.buyer.userId, 'user'), 'x-forwarded-for': `203.0.113.${randomInt(1, 255)}, 10.4.0.1`, 'x-step-up': await fx.stepUpGrant(sid, 'game.release_early') },
      })).status));
    expect(early.filter((s) => s === 200)).toHaveLength(1);
    expect(early.filter((s) => s === 409)).toHaveLength(4);
    await settledOnce(o.id);
  });

  it('FR-PAY-15 expiry racing a late callback: the payment is either kept or refunded in full, never lost or kept twice', async () => {
    for (let round = 0; round < 5; round++) {
      const seller = await member();
      const buyer = await member();
      const listingId = await listing(seller.userId, 1);
      const order = await (await buyer.call('POST', '/orders', { listingId, quantity: 1, fulfilment: 'self_pickup' })).json();
      const a = await (await buyer.call('POST', `/orders/${order.id}/payments`, { provider: 'bkash' }, { 'idempotency-key': randomUUID() })).json();
      await MockProvider.decide(t.app.get<Redis>(REDIS), a.attemptId, 'succeeded');
      await fx.query(`UPDATE orders.orders SET payment_due_at = now() - interval '1 second' WHERE id = $1`, [order.id]);
      const state = new URL(a.redirectUrl).searchParams.get('state');
      await Promise.all([t.app.get(OrdersJobs).expirePayments(), fetch(t.url(`/callbacks/bkash/${a.attemptId}?state=${state}`), { redirect: 'manual' })]);
      const { status } = await one<{ status: string }>(`SELECT status FROM orders.orders WHERE id = $1`, [order.id]);
      const refunds = await fx.query<{ reason: string; amount: string }>(`SELECT reason, amount FROM payments.refunds WHERE order_id = $1`, [order.id]);
      if (status === 'paid') expect(refunds).toEqual([]);
      else expect([status, refunds]).toEqual(['cancelled', [{ reason: 'late_payment', amount: '1500000' }]]);
      expect(await count(`payments.journal_entries WHERE order_id = $1 AND kind = 'payment_received'`, [order.id])).toBe(1);
    }
  });

  it('SEC-PAY-07 five refund workers and five payout workers at once: each refund and payout is paid exactly once', async () => {
    const r = await paid();
    await r.seller.call('POST', `/orders/${r.id}/cancel`, { reason: 'Out of stock' });
    const p = await paid({ deliveredAgo: '1 hour' });
    await p.buyer.call('POST', `/orders/${p.id}/confirm-receipt`);
    const { id: accountId } = await one<{ id: string }>(
      `INSERT INTO payments.payout_accounts (user_id, kind, wallet_e164, status, effective_at)
       VALUES ($1, 'bkash_wallet', (SELECT phone_e164 FROM identity.users WHERE id = $1), 'active', now() - interval '1 day') RETURNING id`, [p.seller.userId]);
    await fx.query(`UPDATE payments.payouts SET status = 'pending', payout_account_id = $2 WHERE order_id = $1`, [p.id, accountId]);
    const refunds = t.app.get(RefundService);
    const payouts = t.app.get(PayoutService);
    for (let i = 0; i < 10; i++) {
      await Promise.all([...Array.from({ length: 5 }, () => refunds.processDue()), ...Array.from({ length: 5 }, () => payouts.processDue())]);
      const done = await one<{ r: string; p: string }>(`SELECT (SELECT status FROM payments.refunds WHERE order_id = $1) AS r, (SELECT status FROM payments.payouts WHERE order_id = $2) AS p`, [r.id, p.id]);
      if (done.r === 'succeeded' && done.p === 'sent') break; // other test files leave due rows ahead of ours
    }
    expect(await count(`payments.journal_entries WHERE order_id = $1 AND kind = 'refund_paid'`, [r.id])).toBe(1);
    expect(await count(`payments.journal_entries WHERE order_id = $1 AND kind = 'payout_sent'`, [p.id])).toBe(1);
  });

  it('FR-PAY-14 thirty orders settled at once: every settlement adds up and every journal entry balances', async () => {
    const orders = await Promise.all(Array.from({ length: 30 }, (_, i) => paid({ deliveredAgo: '1 hour', price: randomInt(100, 50_000_000), courier: i % 2 === 0 })));
    await Promise.all(orders.map((o) => o.buyer.call('POST', `/orders/${o.id}/confirm-receipt`)));
    const ids = orders.map((o) => o.id);
    const bad = await fx.query(
      `SELECT order_id FROM payments.settlements WHERE order_id = ANY($1)
          AND seller_payout + commission + courier_payout + delivery_margin + refund_total <> amount_collected`, [ids]);
    expect(bad).toEqual([]);
    expect(await count(`payments.settlements WHERE order_id = ANY($1)`, [ids])).toBe(30);
    const unbalanced = await fx.query(
      `SELECT e.id FROM payments.journal_entries e JOIN payments.journal_lines l ON l.entry_id = e.id WHERE e.order_id = ANY($1) GROUP BY e.id HAVING sum(l.amount) <> 0`, [ids]);
    expect(unbalanced).toEqual([]);
  });
});
