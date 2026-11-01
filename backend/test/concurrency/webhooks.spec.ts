import { createHmac, randomInt, randomUUID } from 'crypto';
import { startApp, TestApp } from '../support/app';
import { IdentityFixtures } from '../support/identity';

// U2-08: AC-4 (SRS Appendix A; FR-PAY-04, SEC-PAY-04, SEC-PAY-07): a payment webhook delivered more than once,
// even at the same moment, never charges or settles an order twice. Stripe's signed webhook in
// PAYMENT_MODE=sandbox with test keys; no call reaches Stripe, since a webhook needs none.
const WEBHOOK_SECRET = 'whsec_test_only_0123456789abcdef';
const ENV = { PAYMENT_MODE: 'sandbox', STRIPE_SECRET_KEY: 'sk_test_only_0123456789abcdef', STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET };

describe('webhooks under concurrency', () => {
  let t: TestApp;
  let fx: IdentityFixtures;
  const before: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const [k, v] of Object.entries(ENV)) {
      before[k] = process.env[k];
      process.env[k] = v;
    }
    t = await startApp();
    fx = await IdentityFixtures.open();
  });
  afterAll(async () => {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await fx?.close();
    await t?.close();
  });

  const count = async (sql: string, p: unknown[]) => (await fx.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`, p))[0].n;

  /** An unpaid order with a Stripe attempt redirected to its Checkout session. */
  async function order(amount = 1_500_000) {
    const [buyer, seller] = [await fx.user(), await fx.user()];
    const [{ id: orderId }] = await fx.query<{ id: string }>(
      `INSERT INTO orders.orders (kind, listing_id, item_kind, buyer_id, seller_id, quantity, unit_price, item_price, fulfilment, total, listing_snapshot,
          commission_bps, delivery_margin_bps, params_version, payment_due_at)
       VALUES ('fixed_price', $1, 'physical', $2, $3, 1, $4, $4, 'self_pickup', $4, '{"title":"Phone"}', 500, 1000, 1, now() + interval '30 minutes') RETURNING id`,
      [randomUUID(), buyer, seller, amount],
    );
    return { orderId, buyer, amount };
  }
  async function attempt(o: { orderId: string; buyer: string; amount: number }) {
    const session = `cs_test_${randomUUID().replace(/-/g, '')}`;
    const [{ id }] = await fx.query<{ id: string }>(
      `INSERT INTO payments.attempts (purpose, order_id, payer_id, provider, amount, provider_payment_id, status, expires_at)
       VALUES ('order', $1, $2, 'stripe', $3, $4, 'redirected', now() + interval '31 minutes') RETURNING id`,
      [o.orderId, o.buyer, o.amount, session],
    );
    return { attemptId: id, session, amount: o.amount };
  }
  const event = (a: { attemptId: string; session: string; amount: number }, o: { id?: string; type?: string } = {}) =>
    JSON.stringify({
      id: o.id ?? `evt_${randomUUID().replace(/-/g, '')}`,
      type: o.type ?? 'checkout.session.completed',
      data: { object: { id: a.session, client_reference_id: a.attemptId, amount_total: a.amount, currency: 'bdt', payment_status: 'paid', status: 'complete', payment_intent: `pi_${randomInt(1e6, 1e7)}` } },
    });
  const sign = (body: string, at = Math.floor(Date.now() / 1000)) => `t=${at},v1=${createHmac('sha256', WEBHOOK_SECRET).update(`${at}.${body}`).digest('hex')}`;
  const post = (body: string) =>
    fetch(t.url('/webhooks/stripe'), { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': sign(body) }, body }).then(async (r) => ({ status: r.status, ...(await r.json()) }));

  it('AC-4 the same signed event delivered 15 times at once: one payment, one escrow, one journal entry', async () => {
    const o = await order();
    const body = event(await attempt(o));
    const answers = await Promise.all(Array.from({ length: 15 }, () => post(body)));
    expect(answers.every((a) => a.status === 200)).toBe(true);
    expect(answers.filter((a) => a.outcome === 'paid')).toHaveLength(1);
    expect(answers.filter((a) => a.outcome === 'already-processed')).toHaveLength(14);
    expect(await count(`orders.escrows WHERE order_id = $1`, [o.orderId])).toBe(1);
    expect(await count(`payments.journal_entries WHERE order_id = $1 AND kind = 'payment_received'`, [o.orderId])).toBe(1);
    expect(await count(`payments.provider_events WHERE event_id = $1`, [JSON.parse(body).id])).toBe(1);
  });

  it('AC-4 ten different events for one session at once (Stripe retries and the async variant): still one payment', async () => {
    const o = await order();
    const a = await attempt(o);
    const bodies = Array.from({ length: 10 }, (_, i) => event(a, { type: i % 2 ? 'checkout.session.async_payment_succeeded' : 'checkout.session.completed' }));
    const answers = await Promise.all(bodies.map(post));
    expect(answers.filter((x) => x.outcome === 'paid')).toHaveLength(1);
    expect(await count(`payments.journal_entries WHERE order_id = $1 AND kind = 'payment_received'`, [o.orderId])).toBe(1);
    expect(await count(`payments.refunds WHERE order_id = $1`, [o.orderId])).toBe(0);
    expect(await fx.query(`SELECT status FROM orders.orders WHERE id = $1`, [o.orderId])).toEqual([{ status: 'paid' }]);
  });

  it('AC-4 two real payments for one order arriving together: one is kept, the other refunded exactly once', async () => {
    const o = await order();
    const [first, second] = [await attempt(o), await attempt(o)];
    await Promise.all([post(event(first)), post(event(second)), post(event(first)), post(event(second))]);
    expect(await count(`orders.escrows WHERE order_id = $1`, [o.orderId])).toBe(1);
    expect(await fx.query(`SELECT reason, amount FROM payments.refunds WHERE order_id = $1`, [o.orderId])).toEqual([{ reason: 'duplicate_payment', amount: '1500000' }]);
    const statuses = (await fx.query<{ status: string }>(`SELECT status FROM payments.attempts WHERE order_id = $1 ORDER BY status`, [o.orderId])).map((r) => r.status);
    expect(statuses).toEqual(['succeeded', 'succeeded_duplicate']);
    // money in twice, and owed back once: the ledger shows both receipts, and one of them as owed to the buyer
    expect(await count(`payments.journal_entries WHERE order_id = $1 AND kind = 'payment_received'`, [o.orderId])).toBe(2);
  });
});
