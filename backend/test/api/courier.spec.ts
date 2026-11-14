import { randomInt, randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { seedAreas } from '../../src/areas-seed';
import { CONFIG_PORT } from '../../src/kernel/config-port';
import { OutboxDispatcher } from '../../src/kernel/events/outbox-dispatcher';
import { REDIS } from '../../src/kernel/redis.provider';
import { COURIER } from '../../src/modules/delivery/adapters/courier-port';
import { MockCourier } from '../../src/modules/delivery/adapters/mock-courier';
import { FULFILMENT_ORDERS } from '../../src/modules/delivery/adapters/orders';
import { DELIVERY_COMMANDS, DELIVERY_QUERIES, DeliveryCommands, DeliveryQueries } from '../../src/modules/delivery/ports';
import { BookingService } from '../../src/modules/delivery/services/booking.service';
import { StatusService } from '../../src/modules/delivery/services/status.service';
import { UpkeepService } from '../../src/modules/delivery/services/upkeep.service';
import { OrdersJobs } from '../../src/modules/orders/jobs/orders.jobs';
import { startApp, TestApp } from '../support/app';
import { IdentityFixtures } from '../support/identity';

// U4-04: courier delivery against PostgreSQL and Redis with the mock courier (docs/design/04_delivery.pdf sections 3
// and 7): courier checkout with a claimed quote, the forward shipment and its booking, the parties' views (own address
// only), signed webhooks (delivered confirmed by a query), escrow steps through Unit 2 in one transaction (DC-14),
// return to the seller, cancellation before and after pickup, syncPickup before a deadline refund (I-22), return
// shipments (FR-DSP-06(d)), the operator's issues and fulfilment record, and the simulator. Unit 2's payment is
// written as its tests write it; its events are delivered by draining the outbox.

type Shipment = {
  id: string; direction: string; status: string; simulated: boolean; consignmentId: string | null; fee: string; cashToCollect: string; needsPickupAddress: boolean;
  myAddress: { line1: string; contactName: string; area: { nameEn: string } } | null; other: { district: string | null }; history: { from: string | null; to: string }[];
};

describe('courier delivery (mock courier)', () => {
  let t: TestApp;
  let fx: IdentityFixtures;
  let dispatcher: OutboxDispatcher;
  let mock: MockCourier;
  let category: number;
  let savar: number;
  let dhanmondi: number;

  beforeAll(async () => {
    process.env.OUTBOX_DISPATCHER = 'off';
    t = await startApp();
    fx = await IdentityFixtures.open();
    dispatcher = t.app.get(OutboxDispatcher);
    mock = t.app.get(COURIER);
    await seedAreas(t.app.get(DataSource));
    [{ id: category }] = await fx.query<{ id: number }>(
      `INSERT INTO listings.categories (slug, name_en, name_bn, item_kind) VALUES ($1, 'Phones', 'ফোন', 'physical') RETURNING id`, [`crr-${randomUUID().slice(0, 8)}`],
    );
    const area = async (nameEn: string) => (await fx.query<{ id: number }>(`SELECT id FROM delivery.areas WHERE district = 'Dhaka' AND name_en = $1`, [nameEn]))[0].id;
    savar = await area('Savar');
    dhanmondi = await area('Dhanmondi');
  });
  afterAll(async () => {
    delete process.env.OUTBOX_DISPATCHER;
    await fx?.close();
    await t?.close();
  });

  async function member() {
    const userId = await fx.user();
    const sid = await fx.session({ userId });
    const ip = `203.0.113.${randomInt(1, 255)}, 198.51.100.${randomInt(1, 255)}`;
    const call = (method: string, path: string, body?: unknown) =>
      fetch(t.url(path), { method, headers: { ...fx.headers(sid, userId, 'user'), 'x-forwarded-for': ip, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const json = async <T = Record<string, unknown>>(method: string, path: string, body?: unknown, status = 200) => {
      const r = await call(method, path, body);
      expect({ path, status: r.status }).toEqual({ path, status });
      return (await r.json()) as T;
    };
    const address = (kind: 'pickup' | 'dropoff', areaId: number, line1: string) =>
      json<{ id: string }>('POST', '/me/addresses', { kind, label: kind === 'pickup' ? 'Shop' : 'Home', areaId, line1, contactName: kind === 'pickup' ? 'Karim Seller' : 'Rahim Buyer' }, 201);
    return { userId, call, json, address };
  }
  async function operator() {
    const staffId = await fx.staff('operator');
    const sid = await fx.session({ staffId });
    const call = (method: string, path: string, body?: unknown) =>
      fetch(t.url(path), { method, headers: { ...fx.headers(sid, staffId, 'staff'), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { staffId, call };
  }
  async function listing(sellerId: string) {
    const [{ id }] = await fx.query<{ id: string }>(
      `INSERT INTO listings.listings (seller_id, item_kind, sale_format, category_id, title, description, condition, no_visible_defects,
          fulfilment_options, weight_class, size_class, area_district, approx_lat, approx_lng, price, quantity_total, quantity_available)
       VALUES ($1, 'physical', 'fixed_price', $2, 'Phone for the courier tests', 'A phone in good condition, written by the courier tests.', 'used', true,
          'pickup_or_courier', 'up_to_1kg', 'small', 'Dhaka', 23.746, 90.376, 1000000, 3, 3) RETURNING id`, [sellerId, category],
    );
    for (const n of [1, 2]) await fx.query(`INSERT INTO listings.listing_photos (listing_id, position, storage_key, width, height) VALUES ($1, $2, $3, 800, 600)`, [id, n, randomUUID().replace(/-/g, '')]);
    await fx.query(`UPDATE listings.listings SET status = 'active', published_at = now() WHERE id = $1`, [id]);
    return id;
  }
  /** Other suites leave undelivered events behind (their dispatcher is off too): drain until nothing is left. */
  async function drainAll() {
    for (let i = 0; i < 200; i++) {
      const r = await dispatcher.drain();
      if (r.dispatched + r.failed + r.givenUp === 0) break;
    }
  }

  /**
   * A courier order through the real checkout (the quote claimed by Unit 2), then paid as a confirmed payment leaves
   * it, with orders.order.paid delivered. The seller has a saved pickup address unless `noPickup`.
   */
  async function courierOrder(o: { noPickup?: boolean; dueIn?: string } = {}) {
    const seller = await member();
    const buyer = await member();
    if (!o.noPickup) await seller.address('pickup', dhanmondi, 'Shop 4, Road 27');
    const home = await buyer.address('dropoff', savar, 'House 12, Road 5');
    const listingId = await listing(seller.userId);
    const q = await buyer.json<{ id: string; fee: string }>('POST', '/delivery/quotes', { listingId, quantity: 1, addressId: home.id }, 201);
    const order = await buyer.json<{ id: string; total: string; deliveryFee: string; fulfilment: string }>('POST', '/orders', { listingId, quantity: 1, fulfilment: 'courier', quoteId: q.id }, 201);
    expect(order).toMatchObject({ fulfilment: 'courier', deliveryFee: q.fee, total: String(1000000 + Number(q.fee)) });
    const [{ due }] = await fx.query<{ due: Date }>(
      `UPDATE orders.orders SET status = 'paid', paid_at = now(), fulfilment_step = 'courier_pickup', fulfilment_due_at = now() + $2::interval WHERE id = $1
       RETURNING fulfilment_due_at AS due`, [order.id, o.dueIn ?? '3 days'],
    ).then((r) => (Array.isArray(r[0]) ? r[0] : r) as { due: Date }[]);
    await fx.query(`INSERT INTO payments.attempts (purpose, order_id, payer_id, provider, amount, status, expires_at, confirmed_at) VALUES ('order', $1, $2, 'bkash', $3, 'succeeded', now(), now())`, [order.id, buyer.userId, order.total]);
    await fx.query(`INSERT INTO orders.escrows (order_id, release_policy, amount_collected) VALUES ($1, 'standard', $2)`, [order.id, order.total]);
    await fx.query(`INSERT INTO orders.outbox (event_type, aggregate_id, payload, next_attempt_at) VALUES ('orders.order.paid', $1, $2, now() - interval '1 second')`, [order.id, JSON.stringify({
      orderId: order.id, kind: 'fixed_price', itemKind: 'physical', listingId, quantity: 1, buyerId: buyer.userId, sellerId: seller.userId,
      fulfilment: 'courier', fulfilmentStep: 'courier_pickup', fulfilmentDueAt: due.toISOString(), deliveryQuoteId: q.id, total: order.total,
    })]);
    await drainAll();
    return { id: order.id, total: order.total, fee: q.fee, buyer, seller, listingId };
  }
  const shipment = async (orderId: string, direction = 'forward') =>
    (await fx.query<{ id: string; status: string; consignment_id: string | null; simulated: boolean; order_cancelled_at: Date | null; picked_up_at: Date | null }>(
      `SELECT id, status, consignment_id, simulated, order_cancelled_at, picked_up_at FROM delivery.shipments WHERE order_id = $1 AND direction = $2`, [orderId, direction],
    ))[0];
  const order = async (id: string) =>
    (await fx.query<{ status: string; fulfilment_done_at: Date | null; delivery_event_at: Date | null; delivery_event_source: string | null; state: string; amount_refunded: string }>(
      `SELECT o.status, o.fulfilment_done_at, o.delivery_event_at, o.delivery_event_source, e.state, e.amount_refunded
         FROM orders.orders o JOIN orders.escrows e ON e.order_id = o.id WHERE o.id = $1`, [id],
    ))[0];
  const events = async (orderId: string, type: string) =>
    (await fx.query<{ payload: Record<string, unknown> }>(`SELECT payload FROM delivery.outbox WHERE aggregate_id = $1 AND event_type = $2 ORDER BY id`, [orderId, type])).map((r) => r.payload);
  /** The parcel moves at the courier, but its webhook is lost on the way. */
  async function silently<T>(fn: () => Promise<T>): Promise<T> {
    mock.setWebhookSink(async () => null);
    try {
      return await fn();
    } finally {
      // the handler the module wires (DeliveryJobs), restored
      mock.setWebhookSink((h, b) => t.app.get(StatusService).webhook('mock', h, b));
    }
  }

  it('FR-DLV-10 FR-DLV-14 FR-DLV-05 a paid courier order is booked at once, simulated, with no cash to collect; each party sees only their own address', async () => {
    const o = await courierOrder();
    const s = await shipment(o.id);
    expect(s).toMatchObject({ status: 'booked', simulated: true });
    expect(s.consignment_id).toMatch(/^MOCK-[0-9A-F]{12}$/);
    const [raw] = await fx.query<{ pickup_address_enc: Buffer; dropoff_address_enc: Buffer }>(`SELECT pickup_address_enc, dropoff_address_enc FROM delivery.shipments WHERE id = $1`, [s.id]);
    expect(Buffer.concat([raw.pickup_address_enc, raw.dropoff_address_enc]).toString('latin1')).not.toMatch(/Road 27|Road 5|Rahim|Karim/);

    const b = await o.buyer.json<{ items: Shipment[] }>('GET', `/orders/${o.id}/shipments`);
    expect(b.items).toHaveLength(1);
    expect(b.items[0]).toMatchObject({ direction: 'forward', status: 'booked', simulated: true, cashToCollect: '0', fee: o.fee, needsPickupAddress: false,
      myAddress: { line1: 'House 12, Road 5', contactName: 'Rahim Buyer', area: { nameEn: 'Savar' } }, other: { district: 'Dhaka' } });
    expect(JSON.stringify(b)).not.toMatch(/Road 27|Karim/);
    const sv = await o.seller.json<{ items: Shipment[] }>('GET', `/orders/${o.id}/shipments`);
    expect(sv.items[0].myAddress).toMatchObject({ line1: 'Shop 4, Road 27', area: { nameEn: 'Dhanmondi' } });
    expect(JSON.stringify(sv)).not.toMatch(/Road 5|Rahim/);
    expect((await (await member()).call('GET', `/orders/${o.id}/shipments`)).status).toBe(404);
    expect(sv.items[0].history.map((h) => h.to)).toEqual(['preparing', 'booked']);
  });

  it('FR-DLV-10 FR-PAY-07 FR-PAY-08 the simulator moves the parcel; the pickup is the fulfilment step and the query-confirmed delivery the delivery event', async () => {
    const o = await courierOrder();
    const s = await shipment(o.id);
    const op = await operator();
    const advance = async (status?: string, extra: Record<string, unknown> = {}) => {
      const r = await op.call('POST', `/mock-courier/consignments/${s.consignment_id}/advance`, { ...(status ? { status } : {}), ...extra });
      expect(r.status).toBe(200);
      return (await r.json()) as { consignment: { status: string }; webhook: { outcome: string } };
    };
    expect((await advance()).webhook.outcome).toBe('applied'); // picked up
    expect(await order(o.id)).toMatchObject({ status: 'paid', delivery_event_at: null });
    expect((await order(o.id)).fulfilment_done_at).not.toBeNull();
    expect((await advance('in_transit')).consignment.status).toBe('in_transit');
    await advance('delivery_failed');
    await advance('in_transit');
    expect((await op.call('POST', `/mock-courier/consignments/${s.consignment_id}/advance`, { status: 'picked_up' })).status).toBe(400); // not a courier move
    expect((await advance('delivered')).webhook.outcome).toBe('applied');
    expect(await order(o.id)).toMatchObject({ delivery_event_source: 'courier_delivered' });
    expect((await order(o.id)).delivery_event_at).not.toBeNull();
    const view = await o.buyer.json<{ items: (Shipment & { failedAttempts: number })[] }>('GET', `/orders/${o.id}/shipments`);
    expect(view.items[0]).toMatchObject({ status: 'delivered', failedAttempts: 1 });
    expect(view.items[0].history.map((h) => h.to)).toEqual(['preparing', 'booked', 'picked_up', 'in_transit', 'delivery_failed', 'in_transit', 'delivered']);
    expect((await events(o.id, 'delivery.shipment.status_changed')).every((p) => p.simulated === true)).toBe(true);
    // a user has no staff session: the simulator is refused
    expect((await o.seller.call('POST', `/mock-courier/consignments/${s.consignment_id}/advance`, {})).status).toBe(401);
  });

  it('SEC-PAY-03 SEC-PAY-04 webhooks must be signed and fresh; a repeat has no effect; "delivered" is only a hint until the courier confirms it', async () => {
    const o = await courierOrder();
    const s = await shipment(o.id);
    await silently(() => mock.advance(s.consignment_id!)); // picked up at the courier; its webhook was lost
    const at = await mock.status(s.consignment_id!);
    const post = (h: Record<string, string>, body: Buffer) => fetch(t.url('/webhooks/courier/mock'), { method: 'POST', headers: h, body: new Uint8Array(body) });
    const good = mock.signedWebhook({ ...at, consignmentId: s.consignment_id! });
    expect((await post({ ...good.headers, 'x-mock-courier-signature': 'v1=' + '0'.repeat(64) }, good.body)).status).toBe(400);
    const old = mock.signedWebhook({ ...at, consignmentId: s.consignment_id! }, new Date(Date.now() - 10 * 60_000));
    expect((await post(old.headers, old.body)).status).toBe(400); // outside CP-32's 5 minutes
    expect((await post(good.headers, good.body).then((r) => r.json())).outcome).toBe('applied');
    expect((await post(good.headers, good.body).then((r) => r.json())).outcome).toBe('duplicate');
    expect((await fetch(t.url('/webhooks/courier/pathao'), { method: 'POST', headers: good.headers, body: new Uint8Array(good.body) })).status).toBe(404);

    // a signed "delivered" while the courier itself still says picked up: the query decides, nothing is delivered
    const forged = mock.signedWebhook({ eventId: `${s.consignment_id}-99`, consignmentId: s.consignment_id!, status: 'delivered', occurredAt: new Date() });
    expect((await post(forged.headers, forged.body).then((r) => r.json())).outcome).toBe('duplicate');
    expect((await shipment(o.id)).status).toBe('picked_up');
    expect((await order(o.id)).delivery_event_at).toBeNull();
  });

  it('FR-DLV-12 a parcel returned to the seller refunds the buyer in full, fee included; the courier charge is a platform cost', async () => {
    const o = await courierOrder();
    const s = await shipment(o.id);
    await mock.advance(s.consignment_id!);
    const r = await mock.advance(s.consignment_id!, 'returned_to_seller', 6000n);
    expect(r.webhook).toMatchObject({ outcome: 'applied' });
    expect(await order(o.id)).toMatchObject({ status: 'closed', state: 'refunded', amount_refunded: o.total });
    expect(await fx.query(`SELECT 1 FROM payments.journal_entries WHERE kind = 'courier_return_charge' AND order_id = $1`, [o.id])).toHaveLength(1);
    await drainAll(); // orders.escrow.refunded reaches the shipment, which is final: nothing changes
    expect((await shipment(o.id)).status).toBe('returned_to_seller');
  });

  it('FR-DLV-07 a seller with no saved pickup address is asked for one; booking follows it', async () => {
    const o = await courierOrder({ noPickup: true });
    expect((await shipment(o.id)).status).toBe('preparing');
    const v = await o.seller.json<{ items: Shipment[] }>('GET', `/orders/${o.id}/shipments`);
    expect(v.items[0]).toMatchObject({ status: 'preparing', needsPickupAddress: true, myAddress: null });
    expect((await events(o.id, 'delivery.shipment.status_changed'))[0]).toMatchObject({ status: 'preparing', pickupAddressNeeded: true, sellerId: o.seller.userId });
    const wrongKind = await o.seller.address('dropoff', dhanmondi, 'Flat 2, Road 1');
    expect((await o.seller.call('PUT', `/orders/${o.id}/shipment/pickup-address`, { addressId: wrongKind.id })).status).toBe(400);
    const shop = await o.seller.address('pickup', dhanmondi, 'Shop 9, Road 2');
    expect((await o.buyer.call('PUT', `/orders/${o.id}/shipment/pickup-address`, { addressId: shop.id })).status).toBe(403);
    const after = await o.seller.json<{ items: Shipment[] }>('PUT', `/orders/${o.id}/shipment/pickup-address`, { addressId: shop.id });
    expect(after.items[0]).toMatchObject({ status: 'booked', needsPickupAddress: false, myAddress: { line1: 'Shop 9, Road 2' } });
    expect((await o.seller.call('PUT', `/orders/${o.id}/shipment/pickup-address`, { addressId: shop.id })).status).toBe(409); // booked: fixed
  });

  it('FR-PAY-09 FR-DLV-11 a refund before pickup cancels the booking; a pickup reported after it raises pickup_after_cancel and asks for a return', async () => {
    const before = await courierOrder({ noPickup: true });
    const after = await courierOrder();
    const booked = await courierOrder();
    const refund = async (orderId: string) => {
      await fx.query(`INSERT INTO orders.outbox (event_type, aggregate_id, payload, next_attempt_at) VALUES ('orders.escrow.refunded', $1, $2, now() - interval '1 second')`, [orderId, JSON.stringify({ orderId, reason: 'cancelled_by_buyer' })]);
      await drainAll();
    };
    await refund(before.id); // still preparing: cancelled, and the addresses it never sent erased
    expect(await shipment(before.id)).toMatchObject({ status: 'cancelled' });
    expect(await fx.query(`SELECT pickup_address_enc, dropoff_address_enc FROM delivery.shipments WHERE order_id = $1`, [before.id])).toEqual([{ pickup_address_enc: null, dropoff_address_enc: null }]);
    await refund(booked.id); // booked: cancelled with the courier, confirmed by a query
    expect(await shipment(booked.id)).toMatchObject({ status: 'cancelled' });
    expect((await mock.status((await shipment(booked.id)).consignment_id!)).status).toBe('cancelled');

    const s = await shipment(after.id);
    await silently(() => mock.advance(s.consignment_id!)); // the courier took it; we did not hear
    await refund(after.id);
    expect(await shipment(after.id)).toMatchObject({ status: 'picked_up' });
    expect((await shipment(after.id)).order_cancelled_at).not.toBeNull();
    const [issue] = await fx.query<{ id: string; kind: string }>(`SELECT id, kind FROM delivery.issues WHERE order_id = $1 AND status = 'open'`, [after.id]);
    expect(issue.kind).toBe('pickup_after_cancel');
    expect(await events(after.id, 'delivery.issue.opened')).toEqual([{ issueId: issue.id, orderId: after.id, kind: 'pickup_after_cancel' }]);
    expect((await mock.recent(200)).find((c) => c.id === s.consignment_id)?.returnRequested).toBe(true);
    await refund(after.id); // redelivered: nothing more
    expect(await events(after.id, 'delivery.issue.opened')).toHaveLength(1);
  });

  it('FR-DLV-11 I-22 before a deadline refund the courier is asked: an in-time pickup reported late is counted; a late one is not', async () => {
    const jobs = t.app.get(OrdersJobs);
    const inTime = await courierOrder();
    const s1 = await shipment(inTime.id);
    await silently(() => mock.advance(s1.consignment_id!)); // picked up in time, webhook lost
    await fx.query(`UPDATE orders.orders SET fulfilment_due_at = now() - interval '1 minute' WHERE id = $1`, [inTime.id]); // Unit 2's deadline passes
    const late = await courierOrder({ dueIn: '1 second' });
    await new Promise((r) => setTimeout(r, 1500));
    const s2 = await shipment(late.id);
    await silently(() => mock.advance(s2.consignment_id!)); // picked up after the deadline
    await jobs.missedDeadlines();
    expect(await order(inTime.id)).toMatchObject({ status: 'paid', state: 'held' });
    expect((await order(inTime.id)).fulfilment_done_at).not.toBeNull();
    expect(await shipment(late.id)).toMatchObject({ status: 'picked_up' }); // recorded, but not counted
    expect(await order(late.id)).toMatchObject({ status: 'closed', state: 'refunded', amount_refunded: late.total, fulfilment_done_at: null });
    await drainAll(); // the refund reaches the shipment: the parcel is asked back
    expect((await mock.recent(200)).find((c) => c.id === s2.consignment_id)?.returnRequested).toBe(true);
    // the courier returns it: no second refund, its charge is a platform cost (I-21)
    await mock.advance(s2.consignment_id!, 'returned_to_seller', 5000n);
    expect(await order(late.id)).toMatchObject({ state: 'refunded', amount_refunded: late.total });
    expect(await fx.query(`SELECT 1 FROM payments.journal_entries WHERE kind = 'courier_return_charge' AND order_id = $1`, [late.id])).toHaveLength(1);
  });

  it('FR-DSP-06 FR-DSP-01 a return shipment for a delivered courier order: quoted, booked, received by the seller once; non-delivery eligibility', async () => {
    const o = await courierOrder();
    const s = await shipment(o.id);
    const queries = t.app.get<DeliveryQueries>(DELIVERY_QUERIES);
    await mock.advance(s.consignment_id!);
    expect(await queries.notReceivedAllowed(o.id)).toBe(false); // CP-17 has not passed since pickup
    await mock.advance(s.consignment_id!, 'delivered');
    const cmd = t.app.get<DeliveryCommands>(DELIVERY_COMMANDS);
    await expect(cmd.quoteReturn(o.id, dhanmondi, savar)).rejects.toMatchObject({ problem: 'validation-failed' }); // not swapped
    const q = await cmd.quoteReturn(o.id, savar, dhanmondi);
    expect(q).toMatchObject({ orderId: o.id, fromAreaId: savar, toAreaId: dhanmondi, fee: '8000', billedKg: 1 });
    const ds = t.app.get(DataSource);
    const returnId = await ds.transaction((m) => cmd.bookReturn(o.id, q.id, 'seller', m));
    await expect(ds.transaction((m) => cmd.bookReturn(o.id, q.id, 'seller', m))).rejects.toMatchObject({ problem: 'delivery-refused' }); // the quote is used
    await t.app.get(BookingService).bookDue();
    const r = await shipment(o.id, 'return');
    expect(r).toMatchObject({ id: returnId, status: 'booked', simulated: true });
    const bv = await o.buyer.json<{ items: Shipment[] }>('GET', `/orders/${o.id}/shipments`);
    expect(bv.items.find((x) => x.direction === 'return')).toMatchObject({ myAddress: { line1: 'House 12, Road 5' }, other: { district: 'Dhaka' } });

    expect((await o.buyer.call('POST', `/orders/${o.id}/return/received`)).status).toBe(403);
    const got = await o.seller.json<{ status: string; at: string }>('POST', `/orders/${o.id}/return/received`);
    expect(got.status).toBe('received');
    expect(await o.seller.json('POST', `/orders/${o.id}/return/received`)).toEqual(got); // once
    expect(await events(o.id, 'delivery.return.delivered')).toEqual([expect.objectContaining({ shipment: returnId, confirmedBy: 'seller' })]);
    const self = await courierOrder();
    await expect(cmd.quoteReturn(self.id, savar, dhanmondi)).rejects.toMatchObject({ problem: 'order-state' }); // not delivered yet
  });

  it('SEC-ACC-05 FR-DSP-05 operators see the issue queue and the fulfilment record, addresses masked unless a reason is given (audited); issues resolve with a reason', async () => {
    const o = await courierOrder();
    const s = await shipment(o.id);
    await silently(() => mock.advance(s.consignment_id!));
    await fx.query(`INSERT INTO orders.outbox (event_type, aggregate_id, payload, next_attempt_at) VALUES ('orders.escrow.refunded', $1, $2, now() - interval '1 second')`, [o.id, JSON.stringify({ orderId: o.id })]);
    await drainAll();
    const op = await operator();
    let found: { id: string; kind: string } | undefined;
    for (let cursor: string | null = ''; cursor !== null && !found;) {
      const page = (await (await op.call('GET', `/staff/delivery/issues${cursor ? `?cursor=${cursor}` : ''}`)).json()) as { items: { id: string; orderId: string; kind: string }[]; nextCursor: string | null };
      found = page.items.find((i) => i.orderId === o.id);
      cursor = page.nextCursor;
    }
    expect(found?.kind).toBe('pickup_after_cancel');
    expect((await o.buyer.call('GET', '/staff/delivery/issues')).status).toBe(401); // no staff session

    const masked = (await (await op.call('GET', `/staff/orders/${o.id}/fulfilment-record`)).json()) as { shipments: { pickup: Record<string, unknown>; dropoff: Record<string, unknown> }[]; handover: unknown };
    expect(masked.handover).toBeNull();
    expect(masked.shipments[0].dropoff).toMatchObject({ masked: true, line1: 'H•••', contactName: 'R•••', area: { nameEn: 'Savar' } });
    expect(JSON.stringify(masked)).not.toMatch(/Road 5|Rahim|Road 27|Karim/);
    expect((await op.call('GET', `/staff/orders/${o.id}/fulfilment-record?reason=short`)).status).toBe(400);
    const full = (await (await op.call('GET', `/staff/orders/${o.id}/fulfilment-record?reason=${encodeURIComponent('Checking the return address with the courier')}`)).json()) as typeof masked;
    expect(full.shipments[0].pickup).toMatchObject({ masked: false, line1: 'Shop 4, Road 27', contactName: 'Karim Seller' });
    expect(await fx.query(`SELECT 1 FROM audit.events WHERE action = 'delivery.address.revealed' AND actor_id = $1`, [op.staffId])).toHaveLength(1);
    expect((await op.call('GET', `/staff/orders/${randomUUID()}/fulfilment-record`)).status).toBe(404);

    expect((await op.call('POST', `/staff/delivery/issues/${found!.id}/resolve`, { reason: 'short' })).status).toBe(400);
    expect((await op.call('POST', `/staff/delivery/issues/${found!.id}/resolve`, { reason: 'Courier confirmed the parcel is on its way back' })).status).toBe(204);
    expect((await op.call('POST', `/staff/delivery/issues/${found!.id}/resolve`, { reason: 'Courier confirmed the parcel is on its way back' })).status).toBe(400);
    expect(await fx.query(`SELECT 1 FROM audit.events WHERE action = 'delivery.issue.resolved' AND actor_id = $1`, [op.staffId])).toHaveLength(1);
  });

  it('FR-DLV-14 NFR-CMP-05 the simulator page is for operators, says it is simulated, and shows areas, never addresses', async () => {
    const o = await courierOrder();
    const s = await shipment(o.id);
    const op = await operator();
    const r = await op.call('GET', '/mock-courier');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-security-policy')).toMatch(/script-src 'nonce-/);
    const html = await r.text();
    expect(html).toContain(s.consignment_id);
    expect(html).toMatch(/simulated courier/);
    expect(html).toContain('Dhanmondi, Dhaka → Savar, Dhaka');
    expect(html).not.toMatch(/Road 5|Road 27|Rahim|Karim/);
    expect((await o.seller.call('GET', '/mock-courier')).status).toBe(401);
  });

  // U4-05: the upkeep jobs on the real database. The app's clock cannot be moved, so the service is built here with
  // one that is ahead by the given time.
  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;
  const upkeepAt = (aheadMs: number) => new UpkeepService(
    t.app.get(DataSource), t.app.get(StatusService), t.app.get(FULFILMENT_ORDERS), t.app.get(CONFIG_PORT), t.app.get(REDIS),
    { now: () => new Date(Date.now() + aheadMs) },
  );

  it('DV-31 FR-DLV-10 a lost webhook is caught: a shipment silent for 6 hours is asked about and its pickup recorded', async () => {
    const o = await courierOrder();
    const s = await shipment(o.id);
    await silently(() => mock.advance(s.consignment_id!)); // picked up at the courier; the webhook never came
    await upkeepAt(0).reconcile();
    expect((await shipment(o.id)).status).toBe('booked'); // not silent for 6 hours yet
    // other suites' shipments are in flight too and each run asks a batch of 100 in turn: run until this one is reached
    for (let i = 0; i < 50 && (await shipment(o.id)).status === 'booked'; i++) await upkeepAt(7 * HOUR).reconcile();
    expect((await shipment(o.id)).status).toBe('picked_up');
    expect((await order(o.id)).fulfilment_done_at).not.toBeNull();
    const [last] = await fx.query<{ source: string }>(`SELECT source FROM delivery.shipment_history WHERE shipment_id = $1 ORDER BY id DESC LIMIT 1`, [s.id]);
    expect(last.source).toBe('provider_query');
  });

  it('DV-30 a shipment\'s addresses are erased 30 days after its order closed; an open order keeps them', async () => {
    const closed = await courierOrder();
    const c = await shipment(closed.id);
    await mock.advance(c.consignment_id!);
    await mock.advance(c.consignment_id!, 'returned_to_seller', 5000n); // the buyer is refunded and the order closes
    expect(await order(closed.id)).toMatchObject({ status: 'closed' });
    const open = await courierOrder();
    const d = await shipment(open.id);
    await mock.advance(d.consignment_id!);
    await mock.advance(d.consignment_id!, 'delivered'); // final, but the order is still open (release pending)
    const erased = async (id: string) =>
      (await fx.query<{ erased: boolean; gone: boolean }>(
        `SELECT addresses_erased_at IS NOT NULL AS erased, pickup_address_enc IS NULL AND dropoff_address_enc IS NULL AS gone FROM delivery.shipments WHERE order_id = $1`, [id]))[0];
    await upkeepAt(29 * DAY).eraseAddresses();
    expect(await erased(closed.id)).toEqual({ erased: false, gone: false });
    await upkeepAt(31 * DAY).eraseAddresses();
    expect(await erased(closed.id)).toEqual({ erased: true, gone: true });
    expect(await erased(open.id)).toEqual({ erased: false, gone: false });
    const view = await closed.buyer.json<{ items: Shipment[] }>('GET', `/orders/${closed.id}/shipments`);
    expect(view.items[0]).toMatchObject({ status: 'returned_to_seller', myAddress: null, other: { district: 'Dhaka' } });
  });

  it('SEC-PAY-04 provider event ids older than CP-32 (30 days) are deleted; newer ones are kept against replays', async () => {
    const [oldId, newId] = [`old-${randomUUID()}`, `new-${randomUUID()}`];
    await fx.query(`INSERT INTO delivery.provider_events (provider, event_id, received_at) VALUES ('mock', $1, now() - interval '31 days'), ('mock', $2, now() - interval '29 days')`, [oldId, newId]);
    expect(await upkeepAt(0).purgeProviderEvents()).toBeGreaterThanOrEqual(1);
    const left = await fx.query<{ event_id: string }>(`SELECT event_id FROM delivery.provider_events WHERE event_id = ANY($1)`, [[oldId, newId]]);
    expect(left.map((r) => r.event_id)).toEqual([newId]);
  });
});
