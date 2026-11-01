import { randomInt, randomUUID } from 'crypto';
import Redis from 'ioredis';
import { mockKey } from '../../src/modules/orders/adapters/mock-provider';
import { startApp, TestApp } from '../support/app';
import { requireEnv } from '../support/env';
import { IdentityFixtures } from '../support/identity';

// U2-03: payment start, the mock provider's page and callback, and the confirmation transaction, in
// PAYMENT_MODE=mock (the test default), against PostgreSQL and Redis (docs/design/02_orders_payments.pdf
// sections 5.5 and 7.1). Stripe's signed webhook is in payments-stripe.spec.ts (sandbox mode).
describe('payments (mock providers)', () => {
  let t: TestApp;
  let fx: IdentityFixtures;
  let redis: Redis;
  let phones: number;

  beforeAll(async () => {
    t = await startApp();
    fx = await IdentityFixtures.open();
    redis = new Redis(requireEnv('REDIS_URL'));
    [{ id: phones }] = await fx.query<{ id: number }>(`INSERT INTO listings.categories (slug, name_en, name_bn, item_kind) VALUES ($1, 'c', 'বি', 'physical') RETURNING id`, [`pay-${randomUUID().slice(0, 8)}`]);
  });
  afterAll(async () => {
    redis?.disconnect();
    await fx?.close();
    await t?.close();
  });

  async function member(o: { kyc?: string } = {}) {
    const userId = await fx.user({ kyc: o.kyc });
    const sid = await fx.session({ userId });
    const ip = `203.0.113.${randomInt(1, 255)}, 10.9.${randomInt(0, 255)}.${randomInt(1, 255)}`;
    const call = (method: string, path: string, body?: unknown, extra: Record<string, string> = {}) =>
      fetch(t.url(path), {
        method, redirect: 'manual',
        headers: { ...fx.headers(sid, userId, 'user'), 'x-forwarded-for': ip, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...extra },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    return { userId, sid, call };
  }
  /** An order awaiting payment, with self pickup chosen. */
  async function order(o: { price?: number; quantity?: number; fulfilment?: boolean } = {}) {
    const seller = await member();
    const buyer = await member();
    const [{ id: listingId }] = await fx.query<{ id: string }>(
      `INSERT INTO listings.listings (seller_id, item_kind, sale_format, category_id, title, description, condition, no_visible_defects,
          fulfilment_options, area_district, approx_lat, approx_lng, price, quantity_total, quantity_available)
       VALUES ($1, 'physical', 'fixed_price', $2, 'Phone for the payment tests', 'A phone in good condition, written by the payment tests.', 'used', true,
          'pickup_only', 'Dhaka', 23.81, 90.41, $3, $4, $4) RETURNING id`,
      [seller.userId, phones, o.price ?? 1_500_000, o.quantity ?? 1],
    );
    for (const n of [1, 2]) await fx.query(`INSERT INTO listings.listing_photos (listing_id, position, storage_key, width, height) VALUES ($1, $2, $3, 1, 1)`, [listingId, n, randomUUID().replace(/-/g, '')]);
    await fx.query(`UPDATE listings.listings SET status = 'active', published_at = now() WHERE id = $1`, [listingId]);
    const r = await buyer.call('POST', '/orders', { listingId, quantity: 1, ...(o.fulfilment === false ? {} : { fulfilment: 'self_pickup' }) });
    expect(r.status).toBe(201);
    return { seller, buyer, listingId, order: await r.json() };
  }
  const start = async (b: Awaited<ReturnType<typeof member>>, orderId: string, provider = 'bkash', key?: string) =>
    b.call('POST', `/orders/${orderId}/payments`, { provider }, key ? { 'idempotency-key': key } : {});
  /** The buyer on the mock page: choose, follow the redirect to the callback, follow that back to the site. */
  async function pay(redirectUrl: string, outcome: 'succeeded' | 'failed' = 'succeeded') {
    const page = new URL(redirectUrl);
    const form = await fetch(t.url(page.pathname.replace('/api/v1', '') + page.search), {
      method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `outcome=${outcome}`,
    });
    expect(form.status).toBe(303);
    const cb = new URL(form.headers.get('location')!);
    const back = await fetch(t.url(cb.pathname.replace('/api/v1', '') + cb.search), { redirect: 'manual' });
    expect(back.status).toBe(303);
    return { callback: cb, landing: new URL(back.headers.get('location')!) };
  }
  const row = async <T = Record<string, unknown>>(sql: string, p: unknown[]) => (await fx.query<T>(sql, p))[0];

  it('FR-PAY-01 starting a payment records the attempt at the order total and sends the buyer to the provider\'s page', async () => {
    const { buyer, order: o } = await order();
    const r = await start(buyer, o.id, 'nagad');
    expect(r.status).toBe(201);
    const a = await r.json();
    expect(a).toMatchObject({ provider: 'nagad', amount: '1500000', redirectUrl: expect.stringMatching(/\/api\/v1\/mock-provider\/[0-9a-f-]{36}\?state=/) });
    expect(await row(`SELECT status, amount, provider_payment_id FROM payments.attempts WHERE id = $1`, [a.attemptId])).toEqual({
      status: 'redirected', amount: '1500000', provider_payment_id: `mock_nagad_${a.attemptId}`,
    });
    // DV-11: the hold is extended once, to the attempt's expiry, if that is later
    const { payment_due_at } = await row<{ payment_due_at: Date }>(`SELECT payment_due_at FROM orders.orders WHERE id = $1`, [o.id]);
    expect(payment_due_at.getTime()).toBe(Math.max(Date.parse(o.paymentDueAt), Date.parse(a.expiresAt)));
    const page = await fetch(t.url(new URL(a.redirectUrl).pathname.replace('/api/v1', '') + new URL(a.redirectUrl).search));
    expect(page.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(await page.text()).toContain('BDT 15,000.00');
  });

  it('FR-PAY-02 to FR-PAY-05 a confirmed payment: order paid with its deadline, escrow held, ledger balanced, order.paid announced', async () => {
    const { buyer, seller, listingId, order: o } = await order();
    const a = await (await start(buyer, o.id)).json();
    const { landing } = await pay(a.redirectUrl);
    expect(landing.pathname).toBe(`/orders/${o.id}`);
    expect(landing.searchParams.get('result')).toBe('paid');
    const view = await (await buyer.call('GET', `/orders/${o.id}`)).json();
    expect(view).toMatchObject({ status: 'paid', fulfilmentStep: 'meetup_handover', escrow: { state: 'held', releasePolicy: 'standard', amountCollected: '1500000', amountRefunded: '0' } });
    expect(Date.parse(view.fulfilmentDueAt) - Date.parse(view.paidAt)).toBe(7 * 86_400_000); // CP-15
    const lines = await fx.query<{ account_code: string; amount: string }>(
      `SELECT l.account_code, l.amount FROM payments.journal_lines l JOIN payments.journal_entries e ON e.id = l.entry_id WHERE e.order_id = $1 ORDER BY l.account_code`, [o.id]);
    expect(lines).toEqual([{ account_code: 'escrow_liability', amount: '-1500000' }, { account_code: 'provider_clearing', amount: '1500000' }]);
    const [ev] = await fx.query<{ payload: Record<string, unknown> }>(`SELECT payload FROM orders.outbox WHERE aggregate_id = $1 AND event_type = 'orders.order.paid'`, [o.id]);
    expect(ev.payload).toMatchObject({ orderId: o.id, listingId, quantity: 1, buyerId: buyer.userId, sellerId: seller.userId, fulfilment: 'self_pickup', fulfilmentDueAt: view.fulfilmentDueAt });
    expect(await row(`SELECT status FROM payments.attempts WHERE id = $1`, [a.attemptId])).toEqual({ status: 'succeeded' });
    expect((await (await fetch(t.url(`/payments/return/bkash?attempt=${a.attemptId}`))).json())).toEqual({ status: 'succeeded' });
  });

  it('SEC-PAY-04 the same confirmation delivered again has no effect', async () => {
    const { buyer, order: o } = await order();
    const a = await (await start(buyer, o.id)).json();
    const { callback } = await pay(a.redirectUrl);
    const again = await fetch(t.url(callback.pathname.replace('/api/v1', '') + callback.search), { redirect: 'manual' });
    expect(new URL(again.headers.get('location')!).searchParams.get('result')).toBe('already-processed');
    expect(await row(`SELECT count(*)::int AS n FROM payments.journal_entries WHERE order_id = $1`, [o.id])).toEqual({ n: 1 });
  });

  it('FR-PAY-02 a forged callback is refused, and a callback before the buyer pays changes nothing', async () => {
    const { buyer, order: o } = await order();
    const a = await (await start(buyer, o.id)).json();
    expect((await fetch(t.url(`/callbacks/bkash/${a.attemptId}?state=forged`), { redirect: 'manual' })).status).toBe(410);
    const state = new URL(a.redirectUrl).searchParams.get('state');
    const early = await fetch(t.url(`/callbacks/bkash/${a.attemptId}?state=${state}`), { redirect: 'manual' });
    expect(new URL(early.headers.get('location')!).searchParams.get('result')).toBe('pending');
    expect(await row(`SELECT status FROM orders.orders WHERE id = $1`, [o.id])).toEqual({ status: 'awaiting_payment' });
    expect((await fetch(t.url(`/callbacks/nagad/${a.attemptId}?state=${state}`), { redirect: 'manual' })).status).toBe(404); // another provider's route
  });

  it('FR-PAY-04 a failed payment leaves the order awaiting payment, and the buyer can try again', async () => {
    const { buyer, order: o } = await order();
    const a = await (await start(buyer, o.id)).json();
    expect((await pay(a.redirectUrl, 'failed')).landing.searchParams.get('result')).toBe('failed');
    expect(await row(`SELECT status FROM payments.attempts WHERE id = $1`, [a.attemptId])).toEqual({ status: 'failed' });
    const b = await (await start(buyer, o.id, 'stripe')).json();
    expect((await pay(b.redirectUrl)).landing.searchParams.get('result')).toBe('paid');
    // the hold was extended by the first attempt only
    const n = await row<{ n: number }>(`SELECT count(*)::int AS n FROM payments.attempts WHERE order_id = $1`, [o.id]);
    expect(n.n).toBe(2);
  });

  it('AC-4 a second successful payment for a paid order is a duplicate, owed back in full', async () => {
    const { buyer, order: o } = await order();
    const a = await (await start(buyer, o.id)).json();
    const b = await (await start(buyer, o.id, 'nagad')).json();
    await pay(a.redirectUrl);
    expect((await pay(b.redirectUrl)).landing.searchParams.get('result')).toBe('duplicate');
    expect(await row(`SELECT status FROM payments.attempts WHERE id = $1`, [b.attemptId])).toEqual({ status: 'succeeded_duplicate' });
    expect(await row(`SELECT amount, reason, status FROM payments.refunds WHERE attempt_id = $1`, [b.attemptId])).toEqual({ amount: '1500000', reason: 'duplicate_payment', status: 'pending' });
    expect(await row(`SELECT count(*)::int AS n FROM orders.escrows WHERE order_id = $1`, [o.id])).toEqual({ n: 1 });
  });

  it('FR-PAY-03 a payment whose verified amount differs is rejected, refunded and raised for the operators', async () => {
    const { buyer, order: o } = await order();
    const a = await (await start(buyer, o.id)).json();
    const rec = JSON.parse((await redis.get(mockKey(a.attemptId)))!);
    await redis.set(mockKey(a.attemptId), JSON.stringify({ ...rec, paidAmount: '1400000' }));
    expect((await pay(a.redirectUrl)).landing.searchParams.get('result')).toBe('rejected');
    expect(await row(`SELECT status FROM orders.orders WHERE id = $1`, [o.id])).toEqual({ status: 'awaiting_payment' });
    expect(await row(`SELECT status FROM payments.attempts WHERE id = $1`, [a.attemptId])).toEqual({ status: 'succeeded_rejected' });
    expect(await row(`SELECT amount, reason FROM payments.refunds WHERE attempt_id = $1`, [a.attemptId])).toEqual({ amount: '1400000', reason: 'amount_mismatch' });
    const issue = await row<{ kind: string; detail: Record<string, unknown> }>(`SELECT kind, detail FROM payments.reconciliation_issues WHERE attempt_id = $1`, [a.attemptId]);
    expect(issue).toMatchObject({ kind: 'amount_mismatch', detail: { verifiedAmount: '1400000', attemptAmount: '1500000' } });
  });

  it('FR-PAY-03 a genuine payment after the order was cancelled is a late payment, refunded and raised', async () => {
    const { buyer, order: o } = await order();
    const a = await (await start(buyer, o.id)).json();
    await fx.query(`UPDATE orders.orders SET status = 'cancelled', cancelled_at = now(), cancel_reason = 'checkout_expired' WHERE id = $1`, [o.id]);
    expect((await pay(a.redirectUrl)).landing.searchParams.get('result')).toBe('late');
    expect(await row(`SELECT reason FROM payments.refunds WHERE attempt_id = $1`, [a.attemptId])).toEqual({ reason: 'late_payment' });
    expect(await row(`SELECT kind FROM payments.reconciliation_issues WHERE attempt_id = $1`, [a.attemptId])).toEqual({ kind: 'late_payment' });
  });

  it('FR-PAY-01 payment starts only for an awaiting order with a fulfilment method; the same key gives the same attempt (I-52)', async () => {
    const { buyer, order: o } = await order({ fulfilment: false });
    const none = await start(buyer, o.id);
    expect(none.status).toBe(409);
    expect((await none.json()).errors).toEqual([{ field: 'fulfilment', reason: 'choose-before-paying' }]);
    await buyer.call('PUT', `/orders/${o.id}/fulfilment`, { fulfilment: 'self_pickup' });
    const key = `p-${randomUUID()}`;
    const [x, y] = [await (await start(buyer, o.id, 'bkash', key)).json(), await (await start(buyer, o.id, 'bkash', key)).json()];
    expect(y.attemptId).toBe(x.attemptId);
    expect(y.redirectUrl).toBe(x.redirectUrl);
    await fx.query(`UPDATE orders.orders SET payment_due_at = now() - interval '1 second' WHERE id = $1`, [o.id]);
    expect((await start(buyer, o.id)).status).toBe(409);
    expect((await buyer.call('POST', `/orders/${o.id}/payments`, { provider: 'bkash', amount: '1' })).status).toBe(400); // SEC-PAY-06
  });

  it('SEC-SDL-09 another user, a lower role, no session and an expired session cannot start a payment', async () => {
    const { buyer, seller, order: o } = await order();
    expect((await start(await member(), o.id)).status).toBe(404);
    expect((await start(seller, o.id)).status).toBe(403);
    expect((await start(await member({ kyc: 'revoked' }), o.id)).status).toBe(403);
    expect((await fetch(t.url(`/orders/${o.id}/payments`), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"provider":"bkash"}' })).status).toBe(401);
    const sid = await fx.session({ userId: buyer.userId }, { idleSeconds: -60 });
    const expired = await fetch(t.url(`/orders/${o.id}/payments`), { method: 'POST', headers: { ...fx.headers(sid, buyer.userId, 'user'), 'content-type': 'application/json' }, body: '{"provider":"bkash"}' });
    expect(expired.status).toBe(401);
    expect((await fetch(t.url('/webhooks/stripe'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(404); // mock mode: no webhook
  });
});
