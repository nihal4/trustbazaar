import { randomInt, randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { ESCROW_COMMANDS, EscrowCommands } from '../../src/modules/orders/ports';
import { startApp, TestApp } from '../support/app';
import { IdentityFixtures } from '../support/identity';

// U2-06: receipts, settlement statements and the revenue log over HTTP, against PostgreSQL
// (docs/design/02_orders_payments.pdf sections 3.1 and 4.3). Paid orders are written as tb_app in the state a
// confirmed payment leaves them; the release and the cancellation go through the real endpoints.
describe('receipts, statements and the revenue log', () => {
  let t: TestApp;
  let fx: IdentityFixtures;
  let db: DataSource;
  let cmd: EscrowCommands;
  const started = new Date(Date.now() - 60_000);

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

  const ip = () => `203.0.113.${randomInt(1, 255)}, 10.8.${randomInt(0, 255)}.${randomInt(1, 255)}`;
  const caller = (sid: string, id: string, type: 'user' | 'staff') => (method: string, path: string, body?: unknown) =>
    fetch(t.url(path), {
      method,
      headers: { ...fx.headers(sid, id, type), 'x-forwarded-for': ip(), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  async function person(kyc = 'verified') {
    const userId = await fx.user({ kyc, emailVerified: true });
    return { userId, call: caller(await fx.session({ userId }), userId, 'user') };
  }
  async function staff(role: 'operator' | 'administrator') {
    const staffId = await fx.staff(role);
    return caller(await fx.session({ staffId }), staffId, 'staff');
  }

  /** A paid courier order (BDT 10,000 + 150, the SRS worked example) with its delivery event recorded. */
  async function delivered(seller?: Awaited<ReturnType<typeof person>>) {
    const [buyer, s] = [await person(), seller ?? (await person())];
    const [{ id }] = await fx.query<{ id: string }>(
      `INSERT INTO orders.orders (kind, listing_id, item_kind, buyer_id, seller_id, quantity, unit_price, item_price, fulfilment, delivery_quote_id, delivery_fee, total,
          listing_snapshot, commission_bps, delivery_margin_bps, params_version, payment_due_at, status, paid_at, fulfilment_step, fulfilment_due_at)
       VALUES ('fixed_price', $1, 'physical', $2, $3, 1, 1000000, 1000000, 'courier', $4, 15000, 1015000, '{"title":"Desk lamp"}', 500, 1000, 1, now(), 'paid', now(),
               'courier_pickup', now() + interval '7 days') RETURNING id`,
      [randomUUID(), buyer.userId, s.userId, randomUUID()],
    );
    await fx.query(
      `INSERT INTO payments.attempts (purpose, order_id, payer_id, provider, amount, status, expires_at, confirmed_at, provider_txn_id) VALUES ('order', $1, $2, 'bkash', 1015000, 'succeeded', now(), now(), 'txn-1')`,
      [id, buyer.userId],
    );
    await fx.query(`INSERT INTO orders.escrows (order_id, release_policy, amount_collected) VALUES ($1, 'standard', 1015000)`, [id]);
    await db.transaction(async (m: EntityManager) => {
      await cmd.recordFulfilmentStep(id, 'courier_pickup', new Date(), m);
      await cmd.recordDeliveryEvent(id, 'courier_delivered', new Date(), m);
    });
    return { id, buyer, seller: s };
  }

  it('FR-PAY-21 the buyer gets a receipt of the payment; the seller the itemised settlement and its payout', async () => {
    const o = await delivered();
    const before = await (await o.buyer.call('GET', `/orders/${o.id}/receipt`)).json();
    expect(before).toMatchObject({ role: 'buyer', order: { id: o.id, title: 'Desk lamp', total: '1015000', status: 'paid' }, refunds: [], settlement: null });
    expect(before.payments).toEqual([expect.objectContaining({ provider: 'bkash', amount: '1015000', accepted: true })]);
    expect((await o.buyer.call('POST', `/orders/${o.id}/confirm-receipt`)).status).toBe(200);

    const buyer = await (await o.buyer.call('GET', `/orders/${o.id}/receipt`)).json();
    expect(buyer.settlement).toEqual({ settledAt: expect.any(String), amountCollected: '1015000', refundTotal: '0' });
    expect(JSON.stringify(buyer)).not.toMatch(/commission|courierPayout|payouts/);

    const r = await o.seller.call('GET', `/orders/${o.id}/receipt`);
    expect(r.status).toBe(200);
    const seller = await r.json();
    expect(seller).toMatchObject({
      role: 'seller',
      order: { id: o.id, status: 'closed' },
      // FR-PAY-13, FR-PAY-14: the SRS example, BDT 500 + 15 + 135 + 9,500 = 10,150
      settlement: {
        amountCollected: '1015000',
        itemPrice: '1000000',
        deliveryFee: '15000',
        commission: '50000',
        commissionBps: 500,
        courierPayout: '13500',
        deliveryMargin: '1500',
        deliveryMarginBps: 1000,
        sellerPayout: '950000',
        refundTotal: '0',
      },
      payouts: [expect.objectContaining({ amount: '950000', status: 'waiting_account' })],
    });
    expect(seller.payments).toBeUndefined();

    const stranger = await person();
    expect((await stranger.call('GET', `/orders/${o.id}/receipt`)).status).toBe(404);
    expect((await stranger.call('GET', `/orders/${randomUUID()}/receipt`)).status).toBe(404);
  });

  it('FR-PAY-21 a refund appears on the buyer receipt with its reason and status', async () => {
    const o = await delivered();
    // a seller's cancellation needs the order before the delivery event: cancel a fresh paid one instead
    const [{ id }] = await fx.query<{ id: string }>(
      `INSERT INTO orders.orders (kind, listing_id, item_kind, buyer_id, seller_id, quantity, unit_price, item_price, fulfilment, delivery_fee, total,
          listing_snapshot, commission_bps, delivery_margin_bps, params_version, payment_due_at, status, paid_at, fulfilment_step, fulfilment_due_at)
       VALUES ('fixed_price', $1, 'physical', $2, $3, 1, 200000, 200000, 'self_pickup', 0, 200000, '{"title":"Chair"}', 500, 1000, 1, now(), 'paid', now(),
               'meetup_handover', now() + interval '7 days') RETURNING id`,
      [randomUUID(), o.buyer.userId, o.seller.userId],
    );
    await fx.query(
      `INSERT INTO payments.attempts (purpose, order_id, payer_id, provider, amount, status, expires_at, confirmed_at, provider_txn_id) VALUES ('order', $1, $2, 'nagad', 200000, 'succeeded', now(), now(), 'txn-2')`,
      [id, o.buyer.userId],
    );
    await fx.query(`INSERT INTO orders.escrows (order_id, release_policy, amount_collected) VALUES ($1, 'standard', 200000)`, [id]);
    expect((await o.seller.call('POST', `/orders/${id}/cancel`, { reason: 'Sold elsewhere' })).status).toBe(200);

    const buyer = await (await o.buyer.call('GET', `/orders/${id}/receipt`)).json();
    expect(buyer.refunds).toEqual([expect.objectContaining({ amount: '200000', reason: 'cancellation', status: 'pending', completedAt: null })]);
    expect(buyer.settlement).toMatchObject({ amountCollected: '200000', refundTotal: '200000' });
    const seller = await (await o.seller.call('GET', `/orders/${id}/receipt`)).json();
    expect(seller.settlement).toMatchObject({ sellerPayout: '0', commission: '0', refundTotal: '200000' });
    expect(seller.payouts).toEqual([]);
  });

  it('FR-PAY-21 IF-UI-08 a seller lists settlement statements with payouts and what is still owed', async () => {
    const seller = await person();
    for (let i = 0; i < 2; i++) {
      const o = await delivered(seller);
      expect((await o.buyer.call('POST', `/orders/${o.id}/confirm-receipt`)).status).toBe(200);
    }
    const r = await seller.call('GET', '/me/statements');
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toMatchObject({
      title: 'Desk lamp',
      sellerPayout: '950000',
      commission: '50000',
      payout: { amount: '950000', status: 'waiting_account' },
    });
    expect(body.items[0].settledAt >= body.items[1].settledAt).toBe(true);
    expect(body).toMatchObject({ owed: '1900000', nextCursor: null }); // seller_payable: nothing sent yet

    const fresh = await person();
    expect(await (await fresh.call('GET', '/me/statements')).json()).toEqual({ items: [], owed: '0', nextCursor: null });
    expect((await seller.call('GET', '/me/statements?cursor=nonsense')).status).toBe(400);
    const unverified = await person('unsubmitted');
    expect((await unverified.call('GET', '/me/statements')).status).toBe(403);
  });

  it('FR-MON-09 the revenue log shows commission 500 and margin 15 BDT, separate from settlements', async () => {
    const o = await delivered();
    expect((await o.buyer.call('POST', `/orders/${o.id}/confirm-receipt`)).status).toBe(200);
    const admin = await staff('administrator');
    const q = `from=${encodeURIComponent(started.toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 60_000).toISOString())}`;
    const r = await admin('GET', `/staff/payments/revenue-log?${q}`);
    expect(r.status).toBe(200);
    const body = await r.json();
    const mine = body.items.filter((l: { orderId: string }) => l.orderId === o.id);
    expect(mine.map((l: { account: string; revenue: string; kind: string }) => [l.account, l.revenue, l.kind]).sort()).toEqual([
      ['revenue_commission', '50000', 'escrow_release'],
      ['revenue_delivery_margin', '1500', 'escrow_release'],
    ]);
    expect(BigInt(body.totals.revenue_commission)).toBeGreaterThanOrEqual(50_000n);
    expect(BigInt(body.totals.revenue_delivery_margin)).toBeGreaterThanOrEqual(1_500n);

    expect((await (await staff('operator'))('GET', `/staff/payments/revenue-log?${q}`)).status).toBe(403);
    expect((await admin('GET', `/staff/payments/revenue-log?from=2026-01-01T00:00:00Z&to=2027-06-01T00:00:00Z`)).status).toBe(400); // > 366 days
    expect((await admin('GET', `/staff/payments/revenue-log?from=2026-02-01T00:00:00Z&to=2026-01-01T00:00:00Z`)).status).toBe(400);
    expect((await admin('GET', `/staff/payments/revenue-log?from=yesterday&to=2026-01-01T00:00:00Z`)).status).toBe(400);
    expect((await admin('GET', `/staff/payments/revenue-log?${q}&cursor=abc`)).status).toBe(400);
  });

  it('FR-MON-09 the revenue log pages by whole journal entries', async () => {
    const admin = await staff('administrator');
    const q = `from=${encodeURIComponent(started.toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 60_000).toISOString())}`;
    const all: { entryId: string }[] = [];
    let cursor: string | null = '';
    for (let n = 0; cursor !== null && n < 50; n++) {
      const body: { items: { entryId: string }[]; nextCursor: string | null } = await (
        await admin('GET', `/staff/payments/revenue-log?${q}${cursor ? `&cursor=${cursor}` : ''}`)
      ).json();
      if (cursor) expect(body.items.every((l) => BigInt(l.entryId) < BigInt(cursor!))).toBe(true);
      all.push(...body.items);
      cursor = body.nextCursor;
    }
    const [{ n }] = await fx.query<{ n: string }>(`SELECT count(*)::text AS n FROM payments.revenue_log WHERE created_at >= $1`, [started]);
    expect(all.length).toBe(Number(n));
  });
});
