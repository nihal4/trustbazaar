import { randomInt, randomUUID } from 'crypto';
import { CONFIG_PORT } from '../../src/kernel/config-port';
import { EventBus, OutboxEvent } from '../../src/kernel/events/event-bus';
import { LISTING_PRO_STATUS } from '../../src/modules/listings/adapters/pro-status';
import { PRO_STATUS, ProStatusQuery } from '../../src/modules/orders/ports';
import { MonetizationService } from '../../src/modules/orders/services/monetization.service';
import { startApp, TestApp } from '../support/app';
import { IdentityFixtures } from '../support/identity';

// U2-06, third part: the Pro Seller subscription (docs/design/02_orders_payments.pdf section 5.14; FR-MON-02,
// FR-MON-06 to FR-MON-08), in PAYMENT_MODE=mock against PostgreSQL and Redis: paying a month through the mock
// provider, renewing, cancelling and resuming, the monetization job's past-due and lapse, the notices, and what
// Pro status changes elsewhere (the commission of new orders, the listing limit's port, the Pro badge).
describe('Pro Seller subscription', () => {
  let t: TestApp;
  let fx: IdentityFixtures;
  let monetization: MonetizationService;
  let staffId: string;
  let category: number;

  async function setPrice(monthly: number | null) {
    await fx.query(`SELECT staff.publish_config($1::jsonb, $2, $3)`, [JSON.stringify({ 'CP-48': { monthly_poisha: monthly } }), staffId, 'Pro Seller price for the subscription tests']);
    (t.app.get(CONFIG_PORT) as unknown as { invalidate(): void }).invalidate();
  }

  beforeAll(async () => {
    t = await startApp();
    fx = await IdentityFixtures.open();
    monetization = t.app.get(MonetizationService);
    staffId = await fx.staff('administrator');
    [{ id: category }] = await fx.query<{ id: number }>(`INSERT INTO listings.categories (slug, name_en, name_bn, item_kind) VALUES ($1, 'c', 'বি', 'physical') RETURNING id`, [`pro-${randomUUID().slice(0, 8)}`]);
    await setPrice(50_000);
  });
  afterAll(async () => {
    await fx?.close();
    await t?.close();
  });

  async function member(kyc = 'verified') {
    const userId = await fx.user({ kyc });
    const sid = await fx.session({ userId });
    const ip = `203.0.113.${randomInt(1, 255)}, 10.5.${randomInt(0, 255)}.${randomInt(1, 255)}`;
    const call = (method: string, path: string, body?: unknown, extra: Record<string, string> = {}) =>
      fetch(t.url(path), {
        method, redirect: 'manual',
        headers: { ...fx.headers(sid, userId, 'user'), 'x-forwarded-for': ip, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...extra },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    return { userId, call };
  }
  async function pay(redirectUrl: string, outcome: 'succeeded' | 'failed' = 'succeeded') {
    const page = new URL(redirectUrl);
    const form = await fetch(t.url(page.pathname.replace('/api/v1', '') + page.search), {
      method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `outcome=${outcome}`,
    });
    const cb = new URL(form.headers.get('location')!);
    const back = await fetch(t.url(cb.pathname.replace('/api/v1', '') + cb.search), { redirect: 'manual' });
    return new URL(back.headers.get('location')!).searchParams.get('result');
  }
  const row = async <T = Record<string, unknown>>(sql: string, p: unknown[]) => (await fx.query<T>(sql, p))[0];
  const sub = (userId: string) => row<{ id: string; status: string; current_period_end: Date; failed_renewals: number }>(
    `SELECT id, status, current_period_end, failed_renewals FROM payments.subscriptions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`, [userId]);
  const isPro = (userId: string) => t.app.get<ProStatusQuery>(PRO_STATUS).isPro(userId);
  /** Runs the notification consumer of the latest subscription event of a user, as the dispatcher would. */
  async function notify(subscriptionId: string) {
    const e = await row<{ id: string; payload: Record<string, unknown>; created_at: Date }>(
      `SELECT id::text, payload, created_at FROM orders.outbox WHERE event_type = 'payments.subscription.changed' AND aggregate_id = $1 ORDER BY id DESC LIMIT 1`, [subscriptionId]);
    const c = t.app.get(EventBus).consumersOf('payments.subscription.changed').find((x) => x.name === 'chat.notifications')!;
    await c.handler({ outbox: 'orders', id: e.id, type: 'payments.subscription.changed', aggregateId: subscriptionId, payload: e.payload, createdAt: e.created_at, attempt: 1 } as OutboxEvent);
    return e.payload;
  }
  async function subscribed() {
    const seller = await member();
    const r = await seller.call('POST', '/me/subscription', { provider: 'bkash' }, { 'idempotency-key': randomUUID() });
    expect(r.status).toBe(201);
    const a = await r.json();
    expect(await pay(a.redirectUrl)).toBe('paid');
    return { seller, a };
  }

  it('FR-MON-06 FR-MON-07 a seller pays a month at the CP-48 price and is Pro: the badge, the listing limit and revenue', async () => {
    const seller = await member();
    expect(await (await seller.call('GET', '/me/subscription')).json()).toEqual({ subscription: null, pro: false, monthlyPrice: '50000' });
    const r = await seller.call('POST', '/me/subscription', { provider: 'nagad' });
    const a = await r.json();
    expect(a).toMatchObject({ resumed: false, renewal: false, amount: '50000', provider: 'nagad', subscriptionId: expect.any(String) });
    expect(await row(`SELECT purpose, subject_id FROM payments.attempts WHERE id = $1`, [a.attemptId])).toEqual({ purpose: 'subscription', subject_id: a.subscriptionId });
    expect(await isPro(seller.userId)).toBe(false);
    expect(await pay(a.redirectUrl)).toBe('paid');

    const s = await sub(seller.userId);
    expect(s).toMatchObject({ id: a.subscriptionId, status: 'active', failed_renewals: 0 });
    const days = (s.current_period_end.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(27);
    expect(days).toBeLessThan(32);
    expect(await (await seller.call('GET', '/me/subscription')).json()).toMatchObject({ pro: true, subscription: { status: 'active', provider: 'nagad' } });
    expect(await t.app.get<ProStatusQuery>(LISTING_PRO_STATUS).isPro(seller.userId)).toBe(true); // Listings' CP-28 check
    const trust = await (await fetch(t.url(`/users/${seller.userId}/trust`))).json();
    expect(trust.badges).toEqual({ verified: true, pro: true });
    expect(await fx.query(`SELECT l.account_code, l.amount::text FROM payments.journal_entries e JOIN payments.journal_lines l ON l.entry_id = e.id
                            WHERE e.source_id = $1 ORDER BY l.amount`, [a.attemptId])).toEqual([
      { account_code: 'revenue_subscription', amount: '-50000' }, { account_code: 'provider_clearing', amount: '50000' },
    ]);
    expect(await row(`SELECT payload->>'change' AS change FROM orders.outbox WHERE event_type = 'payments.subscription.changed' AND aggregate_id = $1`, [s.id])).toEqual({ change: 'started' });
  });

  it('FR-MON-02 an order created while the seller is Pro keeps the Pro commission rate', async () => {
    const { seller } = await subscribed();
    const [{ id: listingId }] = await fx.query<{ id: string }>(
      `INSERT INTO listings.listings (seller_id, item_kind, sale_format, category_id, title, description, condition, no_visible_defects,
          fulfilment_options, area_district, approx_lat, approx_lng, price, quantity_total, quantity_available)
       VALUES ($1, 'physical', 'fixed_price', $2, 'Pro seller lamp', 'A lamp sold by a Pro Seller, for the subscription tests.', 'used', true,
          'pickup_only', 'Dhaka', 23.81, 90.41, 100000, 2, 2) RETURNING id`,
      [seller.userId, category],
    );
    for (const n of [1, 2]) await fx.query(`INSERT INTO listings.listing_photos (listing_id, position, storage_key, width, height) VALUES ($1, $2, $3, 1, 1)`, [listingId, n, randomUUID().replace(/-/g, '')]);
    await fx.query(`UPDATE listings.listings SET status = 'active', published_at = now() WHERE id = $1`, [listingId]);
    const buyer = await member();
    const r = await buyer.call('POST', '/orders', { listingId, quantity: 1, fulfilment: 'self_pickup' });
    expect(r.status).toBe(201);
    expect(await row(`SELECT commission_bps FROM orders.orders WHERE id = $1`, [(await r.json()).id])).toEqual({ commission_bps: 300 });
  });

  it('FR-MON-06 paying again adds a month to the end; cancelling keeps Pro to the end, and subscribing again resumes', async () => {
    const { seller, a } = await subscribed();
    const first = await sub(seller.userId);
    const r = await (await seller.call('POST', '/me/subscription', { provider: 'bkash' })).json();
    expect(r).toMatchObject({ resumed: false, renewal: true, subscriptionId: a.subscriptionId });
    expect(await pay(r.redirectUrl)).toBe('paid');
    const second = await sub(seller.userId);
    expect(second.id).toBe(first.id);
    expect(second.current_period_end.getTime() - first.current_period_end.getTime()).toBeGreaterThan(27 * 86_400_000);

    const c = await seller.call('DELETE', '/me/subscription');
    expect(c.status).toBe(200);
    expect((await c.json()).subscription).toMatchObject({ status: 'cancelled', cancelledAt: expect.any(String) });
    expect(await isPro(seller.userId)).toBe(true); // the paid months still run
    expect((await seller.call('DELETE', '/me/subscription')).status).toBe(404);
    const back = await seller.call('POST', '/me/subscription', { provider: 'bkash' });
    expect(back.status).toBe(200);
    expect(await back.json()).toMatchObject({ resumed: true, subscription: { status: 'active', cancelledAt: null } });
    expect(await row(`SELECT count(*)::int AS n FROM payments.attempts WHERE payer_id = $1 AND purpose = 'subscription'`, [seller.userId])).toEqual({ n: 2 });

    // a cancellation whose month has ended: no longer Pro, and a new subscription starts with a payment
    await seller.call('DELETE', '/me/subscription');
    await fx.query(`UPDATE payments.subscriptions SET current_period_end = now() - interval '1 minute' WHERE id = $1`, [first.id]);
    expect(await isPro(seller.userId)).toBe(false);
    const again = await (await seller.call('POST', '/me/subscription', { provider: 'bkash' })).json();
    expect(again).toMatchObject({ resumed: false, renewal: false });
    expect(again.subscriptionId).not.toBe(first.id);
  });

  it('FR-MON-08 a month that ends unpaid is past due with a reminder; a failed renewal then lapses it, with a notice', async () => {
    const { seller } = await subscribed();
    const s = await sub(seller.userId);
    await fx.query(`UPDATE payments.subscriptions SET current_period_end = now() - interval '1 minute' WHERE id = $1`, [s.id]);
    expect(await monetization.processSubscriptions()).toBeGreaterThanOrEqual(1);
    expect(await sub(seller.userId)).toMatchObject({ status: 'past_due', failed_renewals: 1 });
    expect(await isPro(seller.userId)).toBe(false); // standard terms until paid
    expect(await notify(s.id)).toMatchObject({ change: 'renewal_due', status: 'past_due', amount: '50000' });
    expect(await row(`SELECT template_code, params FROM notify.notifications WHERE user_id = $1`, [seller.userId])).toEqual({
      template_code: 'payment.pro_renewal_due', params: { amount_bdt: 500 },
    });

    const renewal = await (await seller.call('POST', '/me/subscription', { provider: 'bkash' })).json();
    expect(renewal).toMatchObject({ renewal: true, subscriptionId: s.id });
    expect(await pay(renewal.redirectUrl, 'failed')).toBe('failed');
    expect(await sub(seller.userId)).toMatchObject({ status: 'past_due', failed_renewals: 2 });
    await monetization.processSubscriptions();
    expect(await sub(seller.userId)).toMatchObject({ status: 'lapsed' });
    await notify(s.id);
    expect(await row(`SELECT count(*)::int AS n FROM notify.notifications WHERE user_id = $1 AND template_code = 'payment.pro_lapsed'`, [seller.userId])).toEqual({ n: 1 });
    expect(await monetization.processSubscriptions()).toBe(0);
  });

  it('FR-MON-08 a past-due subscription paid in time is active again from now; one never paid lapses after a second month', async () => {
    const { seller } = await subscribed();
    const s = await sub(seller.userId);
    await fx.query(`UPDATE payments.subscriptions SET current_period_end = now() - interval '2 days' WHERE id = $1`, [s.id]);
    await monetization.processSubscriptions();
    const r = await (await seller.call('POST', '/me/subscription', { provider: 'bkash' })).json();
    expect(await pay(r.redirectUrl)).toBe('paid');
    const paid = await sub(seller.userId);
    expect(paid).toMatchObject({ status: 'active', failed_renewals: 0 });
    expect(paid.current_period_end.getTime()).toBeGreaterThan(Date.now() + 27 * 86_400_000);

    const other = await subscribed();
    const o = await sub(other.seller.userId);
    await fx.query(`UPDATE payments.subscriptions SET current_period_end = now() - interval '32 days' WHERE id = $1`, [o.id]);
    await monetization.processSubscriptions(); // past due
    await monetization.processSubscriptions(); // and a month later, lapsed
    expect(await sub(other.seller.userId)).toMatchObject({ status: 'lapsed' });
  });

  it('FR-MON-06 the price must be set; only verified users subscribe', async () => {
    expect((await (await member('unsubmitted')).call('POST', '/me/subscription', { provider: 'bkash' })).status).toBe(403);
    const seller = await member();
    expect((await seller.call('POST', '/me/subscription', { provider: 'paypal' })).status).toBe(400);
    await setPrice(null);
    try {
      const r = await seller.call('POST', '/me/subscription', { provider: 'bkash' });
      expect(r.status).toBe(409);
      expect(await r.json()).toMatchObject({ type: '/problems/feature-off', errors: [{ field: 'subscription', reason: 'pro-price-not-set' }] });
      expect((await (await seller.call('GET', '/me/subscription')).json()).monthlyPrice).toBeNull();
    } finally {
      await setPrice(50_000);
    }
  });
});
