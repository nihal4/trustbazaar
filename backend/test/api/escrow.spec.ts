import { randomInt, randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { ESCROW_COMMANDS, ESCROW_QUERY, EscrowCommands, EscrowQuery, ORDERS_PORT, OrdersPort } from '../../src/modules/orders/ports';
import { split } from '../../src/modules/orders/services/split';
import { startApp, TestApp } from '../support/app';
import { IdentityFixtures } from '../support/identity';

// U2-04: EscrowCommands, EscrowQuery and OrdersPort.lockForFulfilment against PostgreSQL, with its escrow
// trigger, ledger balance check and refund cap (docs/design/02_orders_payments.pdf sections 4.3 to 5.10).
// Paid orders are written as tb_app in the state a confirmed payment leaves them (U2-03's tests cover that).
describe('escrow', () => {
  let t: TestApp;
  let fx: IdentityFixtures;
  let db: DataSource;
  let cmd: EscrowCommands;
  let query: EscrowQuery;
  let orders: OrdersPort;

  beforeAll(async () => {
    t = await startApp();
    fx = await IdentityFixtures.open();
    db = t.app.get(DataSource);
    cmd = t.app.get(ESCROW_COMMANDS);
    query = t.app.get(ESCROW_QUERY);
    orders = t.app.get(ORDERS_PORT);
  });
  afterAll(async () => {
    await fx?.close();
    await t?.close();
  });

  const tx = <T>(fn: (m: EntityManager) => Promise<T>) => db.transaction(fn);

  /** A paid order with its succeeded attempt and held escrow. */
  async function paid(o: { fulfilment?: 'self_pickup' | 'courier' | 'game_account'; item?: number; fee?: number; seller?: string } = {}) {
    const fulfilment = o.fulfilment ?? 'self_pickup';
    const game = fulfilment === 'game_account';
    const item = o.item ?? 1_000_000;
    const fee = fulfilment === 'courier' ? o.fee ?? 15_000 : 0;
    const buyer = await fx.user();
    const seller = o.seller ?? (await fx.user());
    const step = { self_pickup: 'meetup_handover', courier: 'courier_pickup', game_account: 'credentials_delivered' }[fulfilment];
    const [{ id }] = await fx.query<{ id: string }>(
      `INSERT INTO orders.orders (kind, listing_id, item_kind, buyer_id, seller_id, quantity, unit_price, item_price, fulfilment, delivery_quote_id, delivery_fee, total,
          listing_snapshot, commission_bps, delivery_margin_bps, params_version, payment_due_at, status, paid_at, fulfilment_step, fulfilment_due_at)
       VALUES ('fixed_price', $1, $2, $3, $4, 1, $5, $5, $6, $7, $8, $9, '{"title":"Item"}', 500, 1000, 1, now(), 'paid', now(), $10, now() + interval '7 days') RETURNING id`,
      [randomUUID(), game ? 'game_account' : 'physical', buyer, seller, item, fulfilment, fulfilment === 'courier' ? randomUUID() : null, fee, item + fee, step],
    );
    await fx.query(
      `INSERT INTO payments.attempts (purpose, order_id, payer_id, provider, amount, status, expires_at, confirmed_at) VALUES ('order', $1, $2, 'bkash', $3, 'succeeded', now(), now())`,
      [id, buyer, item + fee],
    );
    await fx.query(`INSERT INTO orders.escrows (order_id, release_policy, amount_collected) VALUES ($1, $2, $3)`, [id, game ? 'game_protection' : 'standard', item + fee]);
    return { id, buyer, seller, item, fee };
  }
  const one = async <T = Record<string, unknown>>(sql: string, p: unknown[]) => (await fx.query<T>(sql, p))[0];
  const escrow = (id: string) => one(`SELECT state, amount_released, amount_refunded, open_dispute_id FROM orders.escrows WHERE order_id = $1`, [id]);
  const events = async (id: string) => (await fx.query<{ event_type: string }>(`SELECT event_type FROM orders.outbox WHERE aggregate_id = $1 ORDER BY id`, [id])).map((e) => e.event_type);
  const lines = (id: string) => fx.query<{ account_code: string; amount: string }>(
    `SELECT l.account_code, sum(l.amount)::text AS amount FROM payments.journal_lines l JOIN payments.journal_entries e ON e.id = l.entry_id
     WHERE e.order_id = $1 GROUP BY l.account_code ORDER BY l.account_code`, [id]);
  const problem = async (p: Promise<unknown>) => p.then(() => 'none', (e: { problem?: string; extra?: { errors?: { reason: string }[] } }) => e.extra?.errors?.[0]?.reason ?? e.problem ?? String(e));

  it('I-20 lockForFulfilment locks the order and reports what a fulfilment action needs', async () => {
    const o = await paid();
    const facts = await tx((m) => orders.lockForFulfilment(o.id, m));
    expect(facts).toMatchObject({ orderId: o.id, status: 'paid', fulfilment: 'self_pickup', fulfilmentStep: 'meetup_handover', stepRecorded: false, deliveryEventRecorded: false, escrowState: 'held', buyerId: o.buyer });
    await expect(tx((m) => orders.lockForFulfilment(randomUUID(), m))).rejects.toThrow();
  });

  it('FR-PAY-07 a meetup handover is the step and the delivery event; the windows come from CP-18 and CP-19; the first time stands', async () => {
    const o = await paid();
    const at = new Date(Date.now() - 60_000);
    await tx((m) => cmd.recordDeliveryEvent(o.id, 'handover_code', at, m));
    await tx((m) => cmd.recordDeliveryEvent(o.id, 'handover_code', new Date(), m)); // twice: ignored
    const r = await one<{ fulfilment_done_at: Date; delivery_event_at: Date; source: string; w: Date; a: Date }>(
      `SELECT o.fulfilment_done_at, o.delivery_event_at, o.delivery_event_source AS source, e.dispute_window_ends_at AS w, e.auto_release_at AS a
       FROM orders.orders o JOIN orders.escrows e ON e.order_id = o.id WHERE o.id = $1`, [o.id]);
    expect([r.fulfilment_done_at.getTime(), r.delivery_event_at.getTime(), r.source]).toEqual([at.getTime(), at.getTime(), 'handover_code']);
    expect(r.w.getTime() - at.getTime()).toBe(3 * 86_400_000); // CP-18
    expect(r.a.getTime() - at.getTime()).toBe(5 * 86_400_000); // CP-19
    expect(await events(o.id)).toEqual(['orders.order.delivered']);
    expect((await query.getEscrow(o.id)).deliveryEventAt?.getTime()).toBe(at.getTime());
  });

  it('FR-DLV-10 a courier delivery counts only after the pickup step; a game account is protected for CP-24', async () => {
    const c = await paid({ fulfilment: 'courier' });
    await tx((m) => cmd.recordDeliveryEvent(c.id, 'courier_delivered', new Date(), m));
    expect(await one(`SELECT delivery_event_at FROM orders.orders WHERE id = $1`, [c.id])).toEqual({ delivery_event_at: null });
    await tx((m) => cmd.recordFulfilmentStep(c.id, 'credentials_delivered', new Date(), m)); // the wrong step: ignored
    await tx((m) => cmd.recordFulfilmentStep(c.id, 'courier_pickup', new Date(), m));
    await tx((m) => cmd.recordDeliveryEvent(c.id, 'courier_delivered', new Date(), m));
    expect((await one<{ s: string }>(`SELECT delivery_event_source AS s FROM orders.orders WHERE id = $1`, [c.id])).s).toBe('courier_delivered');

    const g = await paid({ fulfilment: 'game_account' });
    const at = new Date();
    await tx((m) => cmd.recordFulfilmentStep(g.id, 'credentials_delivered', at, m));
    await tx((m) => cmd.recordDeliveryEvent(g.id, 'game_takeover', at, m));
    const e = await query.getEscrow(g.id);
    expect(e.disputeWindowEndsAt!.getTime() - at.getTime()).toBe(7 * 86_400_000); // CP-24
    expect(e.autoReleaseAt!.getTime()).toBe(e.disputeWindowEndsAt!.getTime());
  });

  it('FR-DSP-02 and FR-DSP-10 a dispute freezes the escrow; withdrawing returns it, with release at least 24 hours away', async () => {
    const o = await paid();
    await tx((m) => cmd.recordDeliveryEvent(o.id, 'handover_code', new Date(Date.now() - 2.5 * 86_400_000), m)); // window open half a day more
    const d = randomUUID();
    expect(await query.disputeAllowed(o.id, new Date())).toBe(true);
    await tx((m) => cmd.freezeForDispute(o.id, d, m));
    expect(await escrow(o.id)).toMatchObject({ state: 'frozen_disputed', open_dispute_id: d });
    expect(await query.disputeAllowed(o.id, new Date())).toBe(false);
    expect(await problem(tx((m) => cmd.freezeForDispute(o.id, randomUUID(), m)))).toBe('dispute-not-allowed');
    expect(await problem(tx((m) => cmd.withdrawDispute(o.id, randomUUID(), m)))).toBe('not-the-open-dispute');
    const original = (await query.getEscrow(o.id)).autoReleaseAt!.getTime();
    await tx((m) => cmd.withdrawDispute(o.id, d, m));
    const e = await query.getEscrow(o.id);
    expect(e.state).toBe('held');
    expect(e.autoReleaseAt!.getTime()).toBe(original); // 2.5 days away: later than now + 24 hours, so it stands
    expect(await events(o.id)).toEqual(['orders.order.delivered', 'orders.escrow.frozen']);
  });

  it('FR-DSP-11 no dispute after the window ends', async () => {
    const o = await paid();
    await tx((m) => cmd.recordDeliveryEvent(o.id, 'handover_code', new Date(Date.now() - 4 * 86_400_000), m)); // window ended a day ago
    expect(await query.disputeAllowed(o.id, new Date())).toBe(false);
    expect(await problem(tx((m) => cmd.freezeForDispute(o.id, randomUUID(), m)))).toBe('dispute-not-allowed');
  });

  async function frozen(o: Awaited<ReturnType<typeof paid>>, pickedUp = false) {
    if (pickedUp) await tx((m) => cmd.recordFulfilmentStep(o.id, 'courier_pickup', new Date(), m));
    const d = randomUUID();
    await tx((m) => cmd.freezeForDispute(o.id, d, m));
    return d;
  }

  it('FR-PAY-14 a release pays the seller: settlement, ledger, payout, closed order, event', async () => {
    const o = await paid();
    const d = await frozen(o);
    await tx((m) => cmd.applyDisputeOutcome(o.id, d, { kind: 'release' }, m));
    expect(await escrow(o.id)).toEqual({ state: 'released', amount_released: '1000000', amount_refunded: '0', open_dispute_id: null });
    expect(await one(`SELECT commission, seller_payout, refund_total FROM payments.settlements WHERE order_id = $1`, [o.id])).toEqual({ commission: '50000', seller_payout: '950000', refund_total: '0' });
    expect(await lines(o.id)).toEqual([
      { account_code: 'escrow_liability', amount: '1000000' }, { account_code: 'revenue_commission', amount: '-50000' }, { account_code: 'seller_payable', amount: '-950000' },
    ]);
    expect(await one(`SELECT amount, status, simulated FROM payments.payouts WHERE order_id = $1`, [o.id])).toEqual({ amount: '950000', status: 'waiting_account', simulated: true });
    expect(await one(`SELECT status FROM orders.orders WHERE id = $1`, [o.id])).toEqual({ status: 'closed' });
    expect(await events(o.id)).toEqual(['orders.escrow.frozen', 'orders.escrow.released']);
  });

  it('FR-PAY-11 a partial refund after a courier pickup: the SRS example, BDT 10,000 item and BDT 150 fee', async () => {
    const o = await paid({ fulfilment: 'courier' });
    const d = await frozen(o, true);
    await tx((m) => cmd.applyDisputeOutcome(o.id, d, { kind: 'partial', itemRefund: 200_000n }, m));
    expect(await escrow(o.id)).toMatchObject({ state: 'partially_refunded', amount_refunded: '200000', amount_released: '815000' });
    expect(await one(`SELECT commission, courier_payout, delivery_margin, seller_payout FROM payments.settlements WHERE order_id = $1`, [o.id]))
      .toEqual({ commission: '40000', courier_payout: '13500', delivery_margin: '1500', seller_payout: '760000' });
    expect(await one(`SELECT amount, reason, status FROM payments.refunds WHERE order_id = $1`, [o.id])).toEqual({ amount: '200000', reason: 'dispute_partial', status: 'pending' });
  });

  it('FR-DSP-06 a full refund returns the fee unless the courier picked up; an out-of-range partial is refused', async () => {
    const before = await paid({ fulfilment: 'courier' });
    await tx(async (m) => cmd.applyDisputeOutcome(before.id, await frozen(before), { kind: 'full' }, m).catch((e) => Promise.reject(e)));
    expect(await escrow(before.id)).toMatchObject({ state: 'refunded', amount_refunded: '1015000' });
    const after = await paid({ fulfilment: 'courier' });
    const d = await frozen(after, true);
    expect(await problem(tx((m) => cmd.applyDisputeOutcome(after.id, d, { kind: 'partial', itemRefund: 1_000_000n }, m)))).toBe('between-zero-and-item-price');
    expect(await problem(tx((m) => cmd.applyDisputeOutcome(after.id, randomUUID(), { kind: 'full' }, m)))).toBe('not-the-open-dispute');
    await tx((m) => cmd.applyDisputeOutcome(after.id, d, { kind: 'full' }, m));
    expect(await escrow(after.id)).toMatchObject({ state: 'partially_refunded', amount_refunded: '1000000', amount_released: '15000' });
    expect(await one(`SELECT count(*)::int AS n FROM payments.payouts WHERE order_id = $1`, [after.id])).toEqual({ n: 0 }); // nothing for the seller
  });

  it('FR-DSP-06 refund after return: frozen until the item is back, then refunded', async () => {
    const o = await paid();
    const d = await frozen(o);
    await tx((m) => cmd.applyDisputeOutcome(o.id, d, { kind: 'after_return' }, m));
    expect(await escrow(o.id)).toMatchObject({ state: 'frozen_disputed' });
    await tx((m) => cmd.applyDisputeOutcome(o.id, d, { kind: 'return_completed' }, m));
    expect(await escrow(o.id)).toMatchObject({ state: 'refunded', amount_refunded: '1000000' });
    expect(await problem(tx((m) => cmd.applyDisputeOutcome(o.id, d, { kind: 'release' }, m)))).toBe('not-the-open-dispute');
  });

  it('FR-DLV-12 a courier return refunds everything; the courier charge is the platform\'s expense', async () => {
    const o = await paid({ fulfilment: 'courier' });
    await tx((m) => cmd.recordFulfilmentStep(o.id, 'courier_pickup', new Date(), m));
    await tx((m) => cmd.refundCourierReturned(o.id, 6_000n, m));
    expect(await escrow(o.id)).toMatchObject({ state: 'refunded', amount_refunded: '1015000' });
    expect(await one(`SELECT reason FROM payments.refunds WHERE order_id = $1`, [o.id])).toEqual({ reason: 'courier_returned' });
    expect(await lines(o.id)).toContainEqual({ account_code: 'expense_courier_returns', amount: '6000' });
    await tx((m) => cmd.refundCourierReturned(o.id, 0n, m)); // a second report: ignored
    expect(await one(`SELECT count(*)::int AS n FROM payments.refunds WHERE order_id = $1`, [o.id])).toEqual({ n: 1 });
  });

  it('FR-PAY-17 and FR-TNS-05 the payout waits for the account, its cooling-off, or a lifted suspension', async () => {
    const withAccount = async (status: 'active' | 'cooling_off', effective: string) => {
      const seller = await fx.user();
      await fx.query(`INSERT INTO payments.payout_accounts (user_id, kind, wallet_e164, status, effective_at) VALUES ($1, 'bkash_wallet', $2, $3, now() + $4::interval)`,
        [seller, `+8801${randomInt(3, 10)}${String(randomInt(0, 1e8)).padStart(8, '0')}`, status, effective]);
      return seller;
    };
    const cases: [string, string][] = [];
    for (const [seller, expected] of [[await withAccount('active', '-1 day'), 'pending'], [await withAccount('cooling_off', '1 day'), 'waiting_cooling_off'], [await fx.user({ status: 'suspended' }), 'held']] as const) {
      const o = await paid({ seller });
      await tx(async (m) => cmd.applyDisputeOutcome(o.id, await frozen(o), { kind: 'release' }, m));
      cases.push([(await one<{ status: string }>(`SELECT status FROM payments.payouts WHERE order_id = $1`, [o.id])).status, expected]);
    }
    expect(cases.map(([got]) => got)).toEqual(cases.map(([, want]) => want));
  });

  it('FR-PAY-06 two decisions at once: the escrow row lock lets one through, the other finds it settled', async () => {
    const o = await paid();
    const d = await frozen(o);
    const results = await Promise.allSettled([
      tx((m) => cmd.applyDisputeOutcome(o.id, d, { kind: 'release' }, m)),
      tx((m) => cmd.applyDisputeOutcome(o.id, d, { kind: 'full' }, m)),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await one(`SELECT count(*)::int AS n FROM payments.settlements WHERE order_id = $1`, [o.id])).toEqual({ n: 1 });
  });

  it('FR-PAY-14 the application\'s split equals payments.split on 300 random cases', async () => {
    const cases = Array.from({ length: 300 }, () => {
      const item = BigInt(randomInt(1, 50_000_000));
      return { item, fee: BigInt(randomInt(0, 2) ? randomInt(0, 50_000) : 0), refund: BigInt(randomInt(0, 3)) === 0n ? 0n : BigInt(randomInt(0, Number(item) + 1)), done: randomInt(0, 2) === 1, bps: randomInt(0, 800), margin: randomInt(0, 5000) };
    });
    const rows = await fx.query<{ commission: string; courier_payout: string; delivery_margin: string; seller_payout: string; refund_total: string }>(
      `SELECT s.* FROM unnest($1::bigint[], $2::bigint[], $3::bigint[], $4::boolean[], $5::int[], $6::int[]) WITH ORDINALITY AS c(i, f, r, d, b, m, n)
       CROSS JOIN LATERAL payments.split(c.i, c.f, c.r, c.d, c.b, c.m) s ORDER BY c.n`,
      [cases.map((c) => c.item.toString()), cases.map((c) => c.fee.toString()), cases.map((c) => c.refund.toString()), cases.map((c) => c.done), cases.map((c) => c.bps), cases.map((c) => c.margin)],
    );
    const mine = cases.map((c) => {
      const s = split(c.item, c.fee, c.refund, c.done, c.bps, c.margin);
      return { commission: `${s.commission}`, courier_payout: `${s.courierPayout}`, delivery_margin: `${s.deliveryMargin}`, seller_payout: `${s.sellerPayout}`, refund_total: `${s.refundTotal}` };
    });
    expect(mine).toEqual(rows);
  });
});
