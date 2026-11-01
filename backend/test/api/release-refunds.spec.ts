import { randomInt, randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { ESCROW_COMMANDS, EscrowCommands } from '../../src/modules/orders/ports';
import { EscrowService } from '../../src/modules/orders/services/escrow.service';
import { RefundService } from '../../src/modules/orders/services/refund.service';
import { startApp, TestApp } from '../support/app';
import { IdentityFixtures } from '../support/identity';

// U2-05: release by the buyer (confirm receipt, early release), cancellations, auto-release and the refund
// worker, over HTTP and through the services, against PostgreSQL (docs/design/02_orders_payments.pdf
// sections 5.7 to 5.9). Paid orders are written as tb_app in the state a confirmed payment leaves them.
describe('release, cancellations and refunds', () => {
  let t: TestApp;
  let fx: IdentityFixtures;
  let db: DataSource;
  let cmd: EscrowCommands;

  beforeAll(async () => {
    t = await startApp();
    fx = await IdentityFixtures.open();
    db = t.app.get(DataSource);
    cmd = t.app.get(ESCROW_COMMANDS);
  });
  afterAll(async () => {
    await fx?.close();
    await t?.close();
  });

  async function person() {
    const userId = await fx.user();
    const sid = await fx.session({ userId });
    const ip = `203.0.113.${randomInt(1, 255)}, 10.7.${randomInt(0, 255)}.${randomInt(1, 255)}`;
    const call = (method: string, path: string, body?: unknown, extra: Record<string, string> = {}) =>
      fetch(t.url(path), {
        method,
        headers: { ...fx.headers(sid, userId, 'user'), 'x-forwarded-for': ip, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...extra },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    return { userId, sid, call };
  }

  /** A paid order with a succeeded bKash attempt and a held escrow; optionally with its delivery event. */
  async function paid(o: { game?: boolean; courier?: boolean; delivered?: boolean } = {}) {
    const [buyer, seller] = [await person(), await person()];
    const fee = o.courier ? 15_000 : 0;
    const fulfilment = o.game ? 'game_account' : o.courier ? 'courier' : 'self_pickup';
    const step = o.game ? 'credentials_delivered' : o.courier ? 'courier_pickup' : 'meetup_handover';
    const [{ id }] = await fx.query<{ id: string }>(
      `INSERT INTO orders.orders (kind, listing_id, item_kind, buyer_id, seller_id, quantity, unit_price, item_price, fulfilment, delivery_quote_id, delivery_fee, total,
          listing_snapshot, commission_bps, delivery_margin_bps, params_version, payment_due_at, status, paid_at, fulfilment_step, fulfilment_due_at)
       VALUES ('fixed_price', $1, $2, $3, $4, 1, 1000000, 1000000, $5, $6, $7, $8, '{"title":"Item"}', 500, 1000, 1, now(), 'paid', now(), $9, now() + interval '7 days') RETURNING id`,
      [randomUUID(), o.game ? 'game_account' : 'physical', buyer.userId, seller.userId, fulfilment, o.courier ? randomUUID() : null, fee, 1_000_000 + fee, step],
    );
    await fx.query(
      `INSERT INTO payments.attempts (purpose, order_id, payer_id, provider, amount, status, expires_at, confirmed_at, provider_txn_id) VALUES ('order', $1, $2, 'bkash', $3, 'succeeded', now(), now(), 'txn-1')`,
      [id, buyer.userId, 1_000_000 + fee],
    );
    await fx.query(`INSERT INTO orders.escrows (order_id, release_policy, amount_collected) VALUES ($1, $2, $3)`, [id, o.game ? 'game_protection' : 'standard', 1_000_000 + fee]);
    if (o.delivered) {
      await db.transaction(async (m: EntityManager) => {
        if (o.game || o.courier) await cmd.recordFulfilmentStep(id, step as never, new Date(), m);
        await cmd.recordDeliveryEvent(id, o.game ? 'game_takeover' : o.courier ? 'courier_delivered' : 'handover_code', new Date(), m);
      });
    }
    return { id, buyer, seller };
  }
  const one = async <T = Record<string, unknown>>(sql: string, p: unknown[]) => (await fx.query<T>(sql, p))[0];
  const state = async (id: string) => (await one<{ state: string }>(`SELECT state FROM orders.escrows WHERE order_id = $1`, [id])).state;
  const typeOf = async (r: Response) => ({ status: r.status, type: (await r.json()).type });

  it('FR-PAY-07 the buyer releases by confirming receipt, only after the delivery event', async () => {
    const early = await paid();
    expect(await typeOf(await early.buyer.call('POST', `/orders/${early.id}/confirm-receipt`))).toEqual({ status: 409, type: '/problems/order-state' });
    const o = await paid({ delivered: true });
    expect((await o.seller.call('POST', `/orders/${o.id}/confirm-receipt`)).status).toBe(403); // the seller cannot release
    const r = await o.buyer.call('POST', `/orders/${o.id}/confirm-receipt`);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ status: 'closed', escrow: { state: 'released', amountRefunded: '0' } });
    expect(await one(`SELECT amount, status FROM payments.payouts WHERE order_id = $1`, [o.id])).toEqual({ amount: '950000', status: 'waiting_account' });
    expect(await one(`SELECT actor_type, actor_id FROM orders.escrow_history WHERE order_id = $1 AND to_state = 'released'`, [o.id])).toEqual({ actor_type: 'user', actor_id: o.buyer.userId });
    expect((await o.buyer.call('POST', `/orders/${o.id}/confirm-receipt`)).status).toBe(409); // once
  });

  it('FR-GAM-17 a game-account buyer releases early only with a fresh step-up; confirm-receipt does not apply', async () => {
    const o = await paid({ game: true, delivered: true });
    expect((await o.buyer.call('POST', `/orders/${o.id}/confirm-receipt`)).status).toBe(409);
    expect(await typeOf(await o.buyer.call('POST', `/orders/${o.id}/release-early`))).toEqual({ status: 403, type: '/problems/step-up-required' });
    const grant = await fx.stepUpGrant(o.buyer.sid, 'game.release_early');
    const r = await o.buyer.call('POST', `/orders/${o.id}/release-early`, undefined, { 'x-step-up': grant });
    expect(r.status).toBe(200);
    expect(await state(o.id)).toBe('released');
  });

  it('FR-PAY-07 auto-release happens only when it is due and the escrow is still held', async () => {
    const o = await paid({ delivered: true });
    const escrow = t.app.get(EscrowService);
    expect(await escrow.autoRelease(o.id)).toBe(false); // five days away
    await fx.query(`UPDATE orders.escrows SET dispute_window_ends_at = now() - interval '2 days', auto_release_at = now() - interval '1 second' WHERE order_id = $1`, [o.id]);
    expect(await escrow.autoRelease(o.id)).toBe(true);
    expect(await escrow.autoRelease(o.id)).toBe(false);
    expect(await one(`SELECT actor_type FROM orders.escrow_history WHERE order_id = $1 AND to_state = 'released'`, [o.id])).toEqual({ actor_type: 'system' });
  });

  it('FR-PAY-09 the buyer asks to cancel; the seller declines or accepts, and acceptance refunds everything', async () => {
    const o = await paid({ courier: true });
    const first = await o.buyer.call('POST', `/orders/${o.id}/cancellation-requests`, { reason: 'Bought the wrong model' });
    expect(first.status).toBe(201);
    const { cancellationRequest: req } = await first.json();
    expect(req).toMatchObject({ status: 'pending', reason: 'Bought the wrong model' });
    expect((await o.buyer.call('POST', `/orders/${o.id}/cancellation-requests`, { reason: 'Again' })).status).toBe(409);
    expect((await o.buyer.call('POST', `/orders/${o.id}/cancellation-requests/${req.id}/decision`, { decision: 'accept' })).status).toBe(403); // the buyer cannot decide
    expect((await (await o.seller.call('POST', `/orders/${o.id}/cancellation-requests/${req.id}/decision`, { decision: 'decline' })).json()).cancellationRequest.status).toBe('declined');
    expect(await state(o.id)).toBe('held');
    const again = await (await o.buyer.call('POST', `/orders/${o.id}/cancellation-requests`, { reason: 'Please, the seller is not answering' })).json();
    const r = await o.seller.call('POST', `/orders/${o.id}/cancellation-requests/${again.cancellationRequest.id}/decision`, { decision: 'accept' });
    expect(await r.json()).toMatchObject({ status: 'closed', escrow: { state: 'refunded', amountRefunded: '1015000' }, cancellationRequest: { status: 'accepted' } });
    expect(await one(`SELECT amount, reason, status FROM payments.refunds WHERE order_id = $1`, [o.id])).toEqual({ amount: '1015000', reason: 'cancellation', status: 'pending' });
  });

  it('FR-TNS-04 a seller who cancels after payment refunds the buyer and gets a strike event; not after the delivery event', async () => {
    const o = await paid();
    await o.buyer.call('POST', `/orders/${o.id}/cancellation-requests`, { reason: 'Changed my mind' });
    const r = await o.seller.call('POST', `/orders/${o.id}/cancel`, { reason: 'Item was damaged in storage' });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ escrow: { state: 'refunded' }, cancellationRequest: { status: 'lapsed' } });
    const [ev] = await fx.query<{ payload: Record<string, unknown> }>(`SELECT payload FROM orders.outbox WHERE aggregate_id = $1 AND event_type = 'orders.order.cancelled_by_seller'`, [o.id]);
    expect(ev.payload).toMatchObject({ sellerId: o.seller.userId, reason: 'Item was damaged in storage' });
    const delivered = await paid({ delivered: true });
    expect((await delivered.seller.call('POST', `/orders/${delivered.id}/cancel`, { reason: 'Too late now' })).status).toBe(409);
    expect((await delivered.seller.call('POST', `/orders/${delivered.id}/cancel`, { reason: '   ' })).status).toBe(400);
  });

  it('FR-PAY-12 the refund worker pays a refund out once, with its ledger entry', async () => {
    const o = await paid();
    await o.seller.call('POST', `/orders/${o.id}/cancel`, { reason: 'Out of stock after all' });
    const refunds = t.app.get(RefundService);
    const drain = async () => { for (let i = 0; i < 50 && (await refunds.processDue()).length > 0; i++); }; // other specs leave due refunds too
    await drain();
    const r = await one<{ id: string; status: string; provider_refund_id: string }>(`SELECT id, status, provider_refund_id FROM payments.refunds WHERE order_id = $1`, [o.id]);
    expect(r).toMatchObject({ status: 'succeeded', provider_refund_id: expect.stringMatching(/^mockrefund_/) });
    const lines = await fx.query(`SELECT l.account_code, l.amount FROM payments.journal_lines l JOIN payments.journal_entries e ON e.id = l.entry_id WHERE e.kind = 'refund_paid' AND e.source_id = $1 ORDER BY l.account_code`, [r.id]);
    expect(lines).toEqual([{ account_code: 'buyer_refund_payable', amount: '1000000' }, { account_code: 'provider_clearing', amount: '-1000000' }]);
    await drain();
    expect(await one(`SELECT count(*)::int AS n FROM payments.journal_entries WHERE kind = 'refund_paid' AND source_id = $1`, [r.id])).toEqual({ n: 1 });
  });

  it('SEC-SDL-09 another user, no session and an expired session cannot act on the order', async () => {
    const o = await paid({ delivered: true });
    const other = await person();
    expect((await other.call('POST', `/orders/${o.id}/confirm-receipt`)).status).toBe(404);
    expect((await other.call('POST', `/orders/${o.id}/cancel`, { reason: 'Not mine' })).status).toBe(404);
    expect((await fetch(t.url(`/orders/${o.id}/confirm-receipt`), { method: 'POST' })).status).toBe(401);
    const sid = await fx.session({ userId: o.buyer.userId }, { idleSeconds: -60 });
    expect((await fetch(t.url(`/orders/${o.id}/confirm-receipt`), { method: 'POST', headers: fx.headers(sid, o.buyer.userId, 'user') })).status).toBe(401);
    expect((await o.seller.call('POST', `/orders/${o.id}/cancellation-requests/${randomUUID()}/decision`, { decision: 'accept' })).status).toBe(404);
    expect(await state(o.id)).toBe('held');
  });
});
