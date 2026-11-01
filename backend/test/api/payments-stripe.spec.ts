import { createHmac, randomInt, randomUUID } from 'crypto';
import { startApp, TestApp } from '../support/app';
import { IdentityFixtures } from '../support/identity';

// U2-03: Stripe's webhook in PAYMENT_MODE=sandbox (SEC-PAY-03, SEC-PAY-04): the raw body is verified against
// Stripe-Signature with the webhook secret within CP-32; a replayed event has no effect. Stripe itself is not
// called here (the sandbox needs the network): the attempt is written as the start would leave it.
const WEBHOOK_SECRET = 'whsec_test_only_0123456789abcdef';
const ENV = { PAYMENT_MODE: 'sandbox', STRIPE_SECRET_KEY: 'sk_test_only_0123456789abcdef', STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET };

describe('payments (Stripe webhook, sandbox mode)', () => {
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

  /** A paid-for-nothing-yet order with a Stripe attempt that has been redirected to session cs_test_... */
  async function attempt(amount = 1_500_000) {
    const seller = await fx.user();
    const buyer = await fx.user();
    const [{ id: orderId }] = await fx.query<{ id: string }>(
      `INSERT INTO orders.orders (kind, listing_id, item_kind, buyer_id, seller_id, quantity, unit_price, item_price, fulfilment, total, listing_snapshot,
          commission_bps, delivery_margin_bps, params_version, payment_due_at)
       VALUES ('fixed_price', $1, 'physical', $2, $3, 1, $4, $4, 'self_pickup', $4, '{"title":"Phone"}', 500, 1000, 1, now() + interval '30 minutes') RETURNING id`,
      [randomUUID(), buyer, seller, amount],
    );
    const session = `cs_test_${randomUUID().replace(/-/g, '')}`;
    const [{ id }] = await fx.query<{ id: string }>(
      `INSERT INTO payments.attempts (purpose, order_id, payer_id, provider, amount, provider_payment_id, status, expires_at)
       VALUES ('order', $1, $2, 'stripe', $3, $4, 'redirected', now() + interval '31 minutes') RETURNING id`,
      [orderId, buyer, amount, session],
    );
    return { orderId, attemptId: id, session };
  }
  const event = (a: { attemptId: string; session: string }, o: { id?: string; amount?: number; type?: string } = {}) =>
    JSON.stringify({
      id: o.id ?? `evt_${randomUUID().replace(/-/g, '')}`,
      type: o.type ?? 'checkout.session.completed',
      data: { object: { id: a.session, client_reference_id: a.attemptId, amount_total: o.amount ?? 1_500_000, currency: 'bdt', payment_status: 'paid', status: 'complete', payment_intent: `pi_${randomInt(1e6, 1e7)}` } },
    });
  const sign = (body: string, secret = WEBHOOK_SECRET, at = Math.floor(Date.now() / 1000)) =>
    `t=${at},v1=${createHmac('sha256', secret).update(`${at}.${body}`).digest('hex')}`;
  const post = (body: string, signature?: string) =>
    fetch(t.url('/webhooks/stripe'), { method: 'POST', headers: { 'content-type': 'application/json', ...(signature ? { 'stripe-signature': signature } : {}) }, body });

  it('SEC-PAY-03 a correctly signed checkout.session.completed confirms the payment', async () => {
    const a = await attempt();
    const body = event(a);
    const r = await post(body, sign(body));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ received: true, outcome: 'paid' });
    const [o] = await fx.query(`SELECT status FROM orders.orders WHERE id = $1`, [a.orderId]);
    expect(o).toEqual({ status: 'paid' });
    const [ev] = await fx.query(`SELECT verified_by, processed_at IS NOT NULL AS processed FROM payments.provider_events WHERE attempt_id = $1`, [a.attemptId]);
    expect(ev).toEqual({ verified_by: 'signature', processed: true });
  });

  it('SEC-PAY-03 a missing, wrong or stale signature is refused and changes nothing', async () => {
    const a = await attempt();
    const body = event(a);
    expect((await post(body)).status).toBe(400);
    expect((await post(body, sign(body, 'whsec_someone_else'))).status).toBe(400);
    expect((await post(body, sign(body, WEBHOOK_SECRET, Math.floor(Date.now() / 1000) - 600))).status).toBe(400); // CP-32: 5 minutes
    expect((await post(body.replace('1500000', '1'), sign(body))).status).toBe(400); // the body changed after signing
    const [o] = await fx.query(`SELECT status FROM orders.orders WHERE id = $1`, [a.orderId]);
    expect(o).toEqual({ status: 'awaiting_payment' });
  });

  it('SEC-PAY-04 a replayed event, even freshly signed, has no effect', async () => {
    const a = await attempt();
    const body = event(a, { id: `evt_${randomUUID().replace(/-/g, '')}` });
    expect(await (await post(body, sign(body))).json()).toEqual({ received: true, outcome: 'paid' });
    expect(await (await post(body, sign(body))).json()).toEqual({ received: true, outcome: 'already-processed' });
    const [{ n }] = await fx.query<{ n: number }>(`SELECT count(*)::int AS n FROM payments.journal_entries WHERE order_id = $1`, [a.orderId]);
    expect(n).toBe(1);
  });

  it('FR-PAY-03 a signed event for another amount is rejected; an event type this unit does not use is acknowledged', async () => {
    const a = await attempt();
    const body = event(a, { amount: 100 });
    expect(await (await post(body, sign(body))).json()).toEqual({ received: true, outcome: 'rejected' });
    const other = JSON.stringify({ id: `evt_${randomUUID()}`, type: 'customer.created', data: { object: {} } });
    expect(await (await post(other, sign(other))).json()).toEqual({ received: true, handled: false });
  });

  it('FR-PAY-01 bKash and Nagad are not available in sandbox mode until U2-09; the mock page is gone', async () => {
    const buyer = await fx.user();
    const sid = await fx.session({ userId: buyer });
    const r = await fetch(t.url(`/orders/${randomUUID()}/payments`), {
      method: 'POST', headers: { ...fx.headers(sid, buyer, 'user'), 'content-type': 'application/json' }, body: '{"provider":"bkash"}',
    });
    expect(r.status).toBe(409);
    expect((await r.json()).errors).toEqual([{ field: 'provider', reason: 'not-available-in-this-mode' }]);
    const a = await attempt();
    expect((await fetch(t.url(`/mock-provider/${a.attemptId}?state=x`))).status).toBe(404);
  });
});
