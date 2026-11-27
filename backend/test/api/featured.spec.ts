import { randomInt, randomUUID } from 'crypto';
import { CONFIG_PORT } from '../../src/kernel/config-port';
import { EventBus, OutboxEvent } from '../../src/kernel/events/event-bus';
import { MonetizationService } from '../../src/modules/orders/services/monetization.service';
import { startApp, TestApp } from '../support/app';
import { IdentityFixtures } from '../support/identity';

// U2-06, second part: featured listings (docs/design/02_orders_payments.pdf section 5.14; FR-MON-05), in
// PAYMENT_MODE=mock against PostgreSQL and Redis: the purchase, the mock provider's page and callback, the
// confirmation, the revenue entry, Listings' label (its consumer is run here) and the monetization job.
describe('featured listings', () => {
  let t: TestApp;
  let fx: IdentityFixtures;
  let category: number;
  let monetization: MonetizationService;
  let staffId: string;

  async function setFee(fee: number | null) {
    await fx.query(`SELECT staff.publish_config($1::jsonb, $2, $3)`, [
      JSON.stringify({ 'CP-37': { periods: ['24 hours', '48 hours'], fee_poisha: fee } }),
      staffId,
      'Featured fee for the featured-listing tests',
    ]);
    (t.app.get(CONFIG_PORT) as unknown as { invalidate(): void }).invalidate();
  }

  beforeAll(async () => {
    t = await startApp();
    fx = await IdentityFixtures.open();
    monetization = t.app.get(MonetizationService);
    staffId = await fx.staff('administrator');
    [{ id: category }] = await fx.query<{ id: number }>(
      `INSERT INTO listings.categories (slug, name_en, name_bn, item_kind) VALUES ($1, 'c', 'বি', 'physical') RETURNING id`,
      [`feat-${randomUUID().slice(0, 8)}`],
    );
    await setFee(10_000); // BDT 100 a day
  });
  afterAll(async () => {
    if (fx && staffId) await setFee(null).catch(() => undefined);
    await fx?.close();
    await t?.close();
  });

  async function member(kyc = 'verified') {
    const userId = await fx.user({ kyc });
    const sid = await fx.session({ userId });
    const ip = `203.0.113.${randomInt(1, 255)}, 10.6.${randomInt(0, 255)}.${randomInt(1, 255)}`;
    const call = (method: string, path: string, body?: unknown, extra: Record<string, string> = {}) =>
      fetch(t.url(path), {
        method,
        redirect: 'manual',
        headers: { ...fx.headers(sid, userId, 'user'), 'x-forwarded-for': ip, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...extra },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    return { userId, call };
  }
  async function listing(sellerId: string, status = 'active') {
    const [{ id }] = await fx.query<{ id: string }>(
      `INSERT INTO listings.listings (seller_id, item_kind, sale_format, category_id, title, description, condition, no_visible_defects,
          fulfilment_options, area_district, approx_lat, approx_lng, price, quantity_total, quantity_available)
       VALUES ($1, 'physical', 'fixed_price', $2, 'Lamp to feature', 'A desk lamp in good condition, for the featured-listing tests.', 'used', true,
          'pickup_only', 'Dhaka', 23.81, 90.41, 500000, 1, 1) RETURNING id`,
      [sellerId, category],
    );
    for (const n of [1, 2])
      await fx.query(`INSERT INTO listings.listing_photos (listing_id, position, storage_key, width, height) VALUES ($1, $2, $3, 1, 1)`, [
        id,
        n,
        randomUUID().replace(/-/g, ''),
      ]);
    if (status !== 'draft') await fx.query(`UPDATE listings.listings SET status = $2, published_at = now() WHERE id = $1`, [id, status]);
    return id;
  }
  /** The seller on the mock page: choose, follow the redirect to the callback, follow that back to the site. */
  async function pay(redirectUrl: string, outcome: 'succeeded' | 'failed' = 'succeeded') {
    const page = new URL(redirectUrl);
    const form = await fetch(t.url(page.pathname.replace('/api/v1', '') + page.search), {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `outcome=${outcome}`,
    });
    expect(form.status).toBe(303);
    const cb = new URL(form.headers.get('location')!);
    const back = await fetch(t.url(cb.pathname.replace('/api/v1', '') + cb.search), { redirect: 'manual' });
    expect(back.status).toBe(303);
    return new URL(back.headers.get('location')!);
  }
  const row = async <T = Record<string, unknown>>(sql: string, p: unknown[]) => (await fx.query<T>(sql, p))[0];
  /** Runs Listings' consumer of the latest event of a type for a purchase, as the dispatcher would. */
  async function deliver(type: string, purchaseId: string) {
    const e = await row<{ id: string; payload: Record<string, unknown>; created_at: Date }>(
      `SELECT id::text, payload, created_at FROM orders.outbox WHERE event_type = $1 AND aggregate_id = $2 ORDER BY id DESC LIMIT 1`,
      [type, purchaseId],
    );
    const c = t.app
      .get(EventBus)
      .consumersOf(type)
      .find((x) => x.name === 'listings.featured')!;
    await c.handler({ outbox: 'orders', id: e.id, type, aggregateId: purchaseId, payload: e.payload, createdAt: e.created_at, attempt: 1 } as OutboxEvent);
    return e.payload;
  }
  const featuredUntil = async (id: string) => (await row<{ f: Date | null }>(`SELECT featured_until AS f FROM listings.listings WHERE id = $1`, [id])).f;

  it('FR-MON-05 a seller pays the CP-37 fee and the listing is featured for the period, labelled by Listings', async () => {
    const seller = await member();
    const id = await listing(seller.userId);
    const r = await seller.call('POST', `/listings/${id}/feature`, { hours: 48, provider: 'bkash' }, { 'idempotency-key': randomUUID() });
    expect(r.status).toBe(201);
    const a = await r.json();
    expect(a).toMatchObject({
      hours: 48,
      provider: 'bkash',
      amount: '20000',
      purchaseId: expect.any(String),
      redirectUrl: expect.stringContaining('/mock-provider/'),
    });
    expect(await row(`SELECT purpose, subject_id, payer_id, status FROM payments.attempts WHERE id = $1`, [a.attemptId])).toEqual({
      purpose: 'featured_listing',
      subject_id: a.purchaseId,
      payer_id: seller.userId,
      status: 'redirected',
    });

    const landing = await pay(a.redirectUrl);
    expect(landing.pathname).toBe(`/payments/${a.attemptId}`);
    expect(landing.searchParams.get('result')).toBe('paid');
    const p = await row<{ starts_at: Date; ends_at: Date; fee: string }>(`SELECT starts_at, ends_at, fee FROM payments.featured_purchases WHERE id = $1`, [
      a.purchaseId,
    ]);
    expect(p.fee).toBe('20000');
    expect(p.ends_at.getTime() - p.starts_at.getTime()).toBe(48 * 3_600_000);
    // FR-MON-09: the fee is revenue (Dr provider_clearing / Cr revenue_featured)
    expect(
      await fx.query(
        `SELECT account, revenue::text FROM (SELECT l.account_code AS account, -l.amount AS revenue FROM payments.journal_entries e JOIN payments.journal_lines l ON l.entry_id = e.id
                              WHERE e.source_id = $1 AND e.kind = 'fee_received' ORDER BY l.amount) x`,
        [a.attemptId],
      ),
    ).toEqual([
      { account: 'revenue_featured', revenue: '20000' },
      { account: 'provider_clearing', revenue: '-20000' },
    ]);
    expect(await row(`SELECT action FROM audit.events WHERE object_id = $1 AND action = 'payments.featured.started'`, [id])).toBeDefined();

    // Listings shows the label until the end; search reads featured_until > now()
    expect(await featuredUntil(id)).toBeNull();
    await deliver('payments.featured.started', a.purchaseId);
    expect((await featuredUntil(id))!.getTime()).toBe(p.ends_at.getTime());
    await deliver('payments.featured.started', a.purchaseId); // a redelivery changes nothing
    expect((await featuredUntil(id))!.getTime()).toBe(p.ends_at.getTime());
  });

  it('FR-MON-05 a second purchase follows the first; the job ends each period once, and the label goes with the last', async () => {
    const seller = await member();
    const id = await listing(seller.userId);
    const buy = async () => {
      const a = await (await seller.call('POST', `/listings/${id}/feature`, { hours: 24, provider: 'nagad' })).json();
      expect(a.amount).toBe('10000');
      await pay(a.redirectUrl);
      await deliver('payments.featured.started', a.purchaseId);
      return a.purchaseId as string;
    };
    const [first, second] = [await buy(), await buy()];
    const p1 = await row<{ starts_at: Date; ends_at: Date }>(`SELECT starts_at, ends_at FROM payments.featured_purchases WHERE id = $1`, [first]);
    const p2 = await row<{ starts_at: Date; ends_at: Date }>(`SELECT starts_at, ends_at FROM payments.featured_purchases WHERE id = $1`, [second]);
    expect(p2.starts_at.getTime()).toBe(p1.ends_at.getTime());
    expect((await featuredUntil(id))!.getTime()).toBe(p2.ends_at.getTime());

    // the first period is over (moved back in time as the owner): the job ends it once; the label stays for the second
    await fx.query(
      `UPDATE payments.featured_purchases SET starts_at = starts_at - interval '25 hours', ends_at = ends_at - interval '25 hours' WHERE id = $1`,
      [first],
    );
    expect(await monetization.endFeatured()).toBeGreaterThanOrEqual(1);
    expect(await monetization.endFeatured()).toBe(0);
    expect(await row(`SELECT ended_at IS NOT NULL AS ended FROM payments.featured_purchases WHERE id = $1`, [first])).toEqual({ ended: true });
    expect(await row(`SELECT count(*)::int AS n FROM orders.outbox WHERE event_type = 'payments.featured.ended' AND aggregate_id = $1`, [first])).toEqual({
      n: 1,
    });
    await deliver('payments.featured.ended', first);
    expect((await featuredUntil(id))!.getTime()).toBe(p2.ends_at.getTime());

    // the second ends too: the label is cleared
    await fx.query(
      `UPDATE payments.featured_purchases SET starts_at = starts_at - interval '49 hours', ends_at = ends_at - interval '49 hours' WHERE id = $1`,
      [second],
    );
    await fx.query(`UPDATE listings.listings SET featured_until = featured_until - interval '49 hours' WHERE id = $1`, [id]);
    await monetization.endFeatured();
    await deliver('payments.featured.ended', second);
    expect(await featuredUntil(id)).toBeNull();
  });

  it('FR-MON-05 only the seller of an active listing buys; the fee must be set; the period must be a CP-37 one', async () => {
    const seller = await member();
    const id = await listing(seller.userId);
    const other = await member();
    expect((await other.call('POST', `/listings/${id}/feature`, { hours: 24, provider: 'bkash' })).status).toBe(404);
    expect((await seller.call('POST', `/listings/${randomUUID()}/feature`, { hours: 24, provider: 'bkash' })).status).toBe(404);
    const draft = await listing(seller.userId, 'draft');
    const r = await seller.call('POST', `/listings/${draft}/feature`, { hours: 24, provider: 'bkash' });
    expect(r.status).toBe(409);
    expect((await r.json()).type).toBe('/problems/listing-state');
    expect((await seller.call('POST', `/listings/${id}/feature`, { hours: 12, provider: 'bkash' })).status).toBe(400);
    const unverified = await member('unsubmitted');
    expect((await unverified.call('POST', `/listings/${id}/feature`, { hours: 24, provider: 'bkash' })).status).toBe(403);

    await setFee(null);
    try {
      const off = await seller.call('POST', `/listings/${id}/feature`, { hours: 24, provider: 'bkash' });
      expect(off.status).toBe(409);
      expect(await off.json()).toMatchObject({ type: '/problems/feature-off', errors: [{ field: 'hours', reason: 'featured-fee-not-set' }] });
    } finally {
      await setFee(10_000);
    }
    expect(await row(`SELECT count(*)::int AS n FROM payments.featured_purchases WHERE seller_id = $1`, [seller.userId])).toEqual({ n: 0 });
  });

  it('FR-MON-05 I-52 a repeated request with the same Idempotency-Key gives the same attempt', async () => {
    const seller = await member();
    const id = await listing(seller.userId);
    const key = randomUUID();
    const a = await (await seller.call('POST', `/listings/${id}/feature`, { hours: 24, provider: 'bkash' }, { 'idempotency-key': key })).json();
    const b = await (await seller.call('POST', `/listings/${id}/feature`, { hours: 24, provider: 'bkash' }, { 'idempotency-key': key })).json();
    expect(b.attemptId).toBe(a.attemptId);
    expect(await row(`SELECT count(*)::int AS n FROM payments.featured_purchases WHERE listing_id = $1`, [id])).toEqual({ n: 1 });
  });

  it('FR-MON-07 a payment for a listing no longer active is refunded; a failed one starts nothing', async () => {
    const seller = await member();
    const id = await listing(seller.userId);
    const failed = await (await seller.call('POST', `/listings/${id}/feature`, { hours: 24, provider: 'bkash' })).json();
    expect((await pay(failed.redirectUrl, 'failed')).searchParams.get('result')).toBe('failed');
    expect(await row(`SELECT starts_at FROM payments.featured_purchases WHERE id = $1`, [failed.purchaseId])).toEqual({ starts_at: null });

    const a = await (await seller.call('POST', `/listings/${id}/feature`, { hours: 24, provider: 'bkash' })).json();
    await fx.query(`UPDATE listings.listings SET status = 'ended_unsold' WHERE id = $1`, [id]);
    expect((await pay(a.redirectUrl)).searchParams.get('result')).toBe('late');
    expect(await row(`SELECT status FROM payments.attempts WHERE id = $1`, [a.attemptId])).toEqual({ status: 'succeeded_rejected' });
    expect(await row(`SELECT amount::text, reason, order_id FROM payments.refunds WHERE attempt_id = $1`, [a.attemptId])).toEqual({
      amount: '10000',
      reason: 'fee_refund',
      order_id: null,
    });
    expect(await row(`SELECT starts_at FROM payments.featured_purchases WHERE id = $1`, [a.purchaseId])).toEqual({ starts_at: null });
  });

  it('FR-MON-07 the job asks the provider about an expired attempt before expiring it', async () => {
    const seller = await member();
    const id = await listing(seller.userId);
    const left = await (await seller.call('POST', `/listings/${id}/feature`, { hours: 24, provider: 'bkash' })).json();
    const paid = await (await seller.call('POST', `/listings/${id}/feature`, { hours: 24, provider: 'nagad' })).json();
    // the seller paid on the provider's page but the callback never came
    const page = new URL(paid.redirectUrl);
    await fetch(t.url(page.pathname.replace('/api/v1', '') + page.search), {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'outcome=succeeded',
    });
    await fx.query(`UPDATE payments.attempts SET expires_at = now() - interval '1 minute' WHERE id = ANY($1::uuid[])`, [[left.attemptId, paid.attemptId]]);
    await monetization.expireAttempts();
    expect(await row(`SELECT status FROM payments.attempts WHERE id = $1`, [paid.attemptId])).toEqual({ status: 'succeeded' });
    expect(await row(`SELECT status FROM payments.attempts WHERE id = $1`, [left.attemptId])).toEqual({ status: 'expired' });
    expect(await row(`SELECT starts_at IS NOT NULL AS started FROM payments.featured_purchases WHERE id = $1`, [paid.purchaseId])).toEqual({ started: true });
  });
});
