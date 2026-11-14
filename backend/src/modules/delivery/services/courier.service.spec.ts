import { Problem } from '../../../kernel/http/problems';
import { CourierSignatureError, CourierUnavailableError } from '../adapters/courier-port';
import { MOCK_HEADERS, MockCourier, MockMoveRefused, MockUnknownConsignment } from '../adapters/mock-courier';
import { ShipmentConsumers } from '../consumers/shipment.consumers';
import { DeliveryStaffController } from '../http/delivery-staff.controller';
import { MockCourierController } from '../http/mock-courier.controller';
import { CourierWebhookController, ShipmentController } from '../http/shipment.controller';
import { DeliveryJobs } from '../jobs/delivery.jobs';
import { backoffMs, BookingService, DV_29 } from './booking.service';
import { BREAKER, CourierBreaker } from './courier-breaker';
import { DeliveryPorts } from './delivery-ports.service';
import { announceNewIssues } from './outbox';
import { mask, RecordsService } from './records.service';
import { shipmentContext } from './shipment-address';
import { ShipmentService } from './shipment.service';
import { StatusService } from './status.service';

// U4-04 with the database, Redis and Unit 2 faked: what each part of the courier flow asks of them and how it answers.
// The rules themselves (status changes, duplicates, implied pickups) are the database's, tested in
// docs/design/sql/04_delivery_tests.sql; the whole flow runs in test/api/courier.spec.ts.

/** Enough of ioredis for the mock courier and the breaker, in memory. */
class FakeRedis {
  kv = new Map<string, string>();
  z = new Map<string, Map<string, number>>();
  async set(k: string, v: string, ...opts: unknown[]) {
    if (opts.includes('NX') && this.kv.has(k)) return null;
    this.kv.set(k, v);
    return 'OK';
  }
  async get(k: string) { return this.kv.get(k) ?? null; }
  async del(...ks: string[]) { ks.forEach((k) => this.kv.delete(k)); return ks.length; }
  async exists(k: string) { return this.kv.has(k) ? 1 : 0; }
  async incr(k: string) { const n = Number(this.kv.get(k) ?? 0) + 1; this.kv.set(k, String(n)); return n; }
  async expire() { return 1; }
  private zset(k: string) { if (!this.z.has(k)) this.z.set(k, new Map()); return this.z.get(k)!; }
  async zadd(k: string, score: number, m: string) { this.zset(k).set(m, score); return 1; }
  async zrem(k: string, m: string) { return this.zset(k).delete(m) ? 1 : 0; }
  private sorted(k: string) { return [...this.zset(k).entries()].sort((a, b) => a[1] - b[1]); }
  async zrevrange(k: string, a: number, b: number) { return this.sorted(k).reverse().slice(a, b + 1).map(([m]) => m); }
  async zremrangebyrank(k: string, a: number, b: number) {
    const s = this.sorted(k);
    const end = b < 0 ? s.length + b : b;
    s.slice(a, end + 1).forEach(([m]) => this.zset(k).delete(m));
    return 0;
  }
  async zrangebyscore(k: string, min: number, max: number) { return this.sorted(k).filter(([, sc]) => sc >= min && sc <= max).map(([m]) => m); }
}

type Answer = (sql: string, params: unknown[]) => unknown;
function fakeDb(answer: Answer) {
  const query = jest.fn(async (sql: string, params: unknown[] = []) => answer(sql, params));
  const manager = { query };
  return { query, manager, transaction: jest.fn(async <T>(fn: (m: typeof manager) => Promise<T>) => fn(manager)) };
}
const problemOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof Problem) return [e.problem, ...((e.extra.errors as { field: string; reason: string }[] | undefined) ?? []).map((x) => `${x.field}:${x.reason}`)];
    throw e;
  }
  return null;
};
/** Sealed as "<context>|<plain>", padded past the column's minimum: decrypting under another row's context fails. */
const crypto = {
  encrypt: jest.fn(async (plain: string, ctx: string) => Buffer.from(`${ctx}|${plain}`.padEnd(40, ' '))),
  decrypt: jest.fn(async (sealed: Uint8Array, ctx: string) => {
    const s = Buffer.from(sealed).toString().trimEnd();
    if (!s.startsWith(`${ctx}|`)) throw new Error('bad tag');
    return s.slice(ctx.length + 1);
  }),
};
const LINES = { line1: 'House 12, Road 5', contactName: 'Rahim Buyer' };
const sealed = (ctx: string, lines: object = LINES) => Buffer.from(`${ctx}|${JSON.stringify(lines)}`.padEnd(40, ' '));
const T0 = new Date('2026-11-02T10:00:00Z');
const ADDR = { line1: 'Road 1', contactName: 'R', phone: '+8801700000001', district: 'Dhaka', area: 'Savar' };

describe('MockCourier', () => {
  const make = (auto = 0) => {
    let now = T0;
    const redis = new FakeRedis();
    const mock = new MockCourier(redis as never, 'secret', () => now, auto);
    const sent: { headers: Record<string, string>; body: Buffer }[] = [];
    mock.setWebhookSink(async (headers, body) => { sent.push({ headers, body }); return { outcome: 'applied' }; });
    return { mock, redis, sent, tick: (s: number) => { now = new Date(now.getTime() + s * 1000); } };
  };
  const book = (mock: MockCourier, ref = 'S1') => mock.book({ shipmentId: ref, pickup: ADDR, dropoff: { ...ADDR, area: 'Dhanmondi' }, parcel: { billedKg: 1, sizeClass: 'small' }, cashToCollect: 0 });

  it('SEC-PAY-07 FR-DLV-05 FR-DLV-14 the mock books once per merchant reference, never collects cash, and is simulated', async () => {
    const { mock } = make();
    expect(mock).toMatchObject({ provider: 'mock', simulated: true });
    const a = await book(mock);
    expect(a.consignmentId).toMatch(/^MOCK-[0-9A-F]{12}$/);
    expect(await book(mock)).toEqual(a);
    await expect(mock.book({ shipmentId: 'S2', pickup: ADDR, dropoff: ADDR, parcel: { billedKg: 1, sizeClass: 'small' }, cashToCollect: 5 as 0 })).rejects.toThrow(/never collects cash/);
    expect(await mock.status(a.consignmentId)).toEqual({ status: 'booked', occurredAt: T0, eventId: `${a.consignmentId}-0` });
    expect((await mock.recent()).map((c) => [c.id, c.from, c.to])).toEqual([[a.consignmentId, 'Savar, Dhaka', 'Dhanmondi, Dhaka']]);
    await expect(mock.status('MOCK-000000000000')).rejects.toBeInstanceOf(MockUnknownConsignment);
  });

  it('FR-DLV-10 FR-DLV-12 parcels move only as a courier would; each move sends a signed webhook; a return carries its charge', async () => {
    const { mock, sent } = make();
    const { consignmentId: c } = await book(mock);
    await expect(mock.advance(c, 'delivered')).rejects.toBeInstanceOf(MockMoveRefused);
    expect((await mock.advance(c)).event.status).toBe('picked_up');
    await expect(mock.advance(c, 'in_transit', 100n)).rejects.toBeInstanceOf(MockMoveRefused); // a charge only on a return
    await mock.advance(c, 'delivery_failed');
    expect((await mock.advance(c)).event.status).toBe('in_transit'); // the courier tries again
    await mock.requestReturn(c);
    const back = await mock.advance(c);
    expect(back.event).toMatchObject({ status: 'returned_to_seller', charge: '0' });
    expect(await mock.status(c)).toMatchObject({ status: 'returned_to_seller', returnCharge: 0n });
    await expect(mock.advance(c)).rejects.toBeInstanceOf(MockMoveRefused);
    expect(sent).toHaveLength(4);
    const e = mock.verifyWebhook(sent[3].headers, sent[3].body, T0, 300);
    expect(e).toMatchObject({ consignmentId: c, status: 'returned_to_seller', returnCharge: 0n });

    const { consignmentId: d } = await book(mock, 'S2');
    expect((await mock.advance(d, 'picked_up')).event.status).toBe('picked_up');
    expect((await mock.advance(d, 'returned_to_seller', 6000n)).event.charge).toBe('6000');
  });

  it('FR-PAY-09 a booking is cancelled before pickup; afterwards the courier answers already_picked_up', async () => {
    const { mock } = make();
    const { consignmentId: c } = await book(mock);
    expect(await mock.cancel(c)).toBe('cancelled');
    expect(await mock.cancel(c)).toBe('cancelled');
    expect((await mock.status(c)).status).toBe('cancelled');
    const { consignmentId: d } = await book(mock, 'S2');
    await mock.advance(d);
    expect(await mock.cancel(d)).toBe('already_picked_up');
  });

  it('SEC-PAY-03 SEC-PAY-04 a webhook needs this environment\'s signature and a time within the tolerance', async () => {
    const { mock } = make();
    const other = new MockCourier(new FakeRedis() as never, 'another secret', () => T0);
    const e = { eventId: 'E1', consignmentId: 'MOCK-1', status: 'picked_up' as const, occurredAt: T0 };
    const ok = mock.signedWebhook(e, T0);
    expect(mock.verifyWebhook(ok.headers, ok.body, T0, 300)).toEqual(e);
    const forged = other.signedWebhook(e, T0);
    expect(() => mock.verifyWebhook(forged.headers, forged.body, T0, 300)).toThrow(CourierSignatureError);
    expect(() => mock.verifyWebhook(ok.headers, ok.body, new Date(T0.getTime() + 301_000), 300)).toThrow(/tolerance/);
    expect(() => mock.verifyWebhook({}, ok.body, T0, 300)).toThrow(/missing/);
    expect(() => mock.verifyWebhook({ ...ok.headers, [MOCK_HEADERS.timestamp]: ['x'] }, ok.body, T0, 300)).toThrow(/missing/);
    const tampered = Buffer.from(ok.body.toString().replace('picked_up', 'delivered'));
    expect(() => mock.verifyWebhook(ok.headers, tampered, T0, 300)).toThrow(/bad signature/);
    const bodyless = mock.signedWebhook(e, T0);
    const empty = Buffer.from('{}');
    const ts = bodyless.headers[MOCK_HEADERS.timestamp];
    const resigned = { ...bodyless.headers, [MOCK_HEADERS.signature]: (mock as unknown as { sign(t: string, b: Buffer): string }).sign(ts, empty) };
    expect(() => mock.verifyWebhook({ ...resigned, [MOCK_HEADERS.signature]: `v1=${resigned[MOCK_HEADERS.signature]}` }, empty, T0, 300)).toThrow(/malformed/);
  });

  it('FR-DLV-14 with MOCK_COURIER_AUTO_ADVANCE_SECONDS set, parcels move by themselves along the happy path', async () => {
    const off = make(0);
    expect(await off.mock.advanceDue()).toBe(0);
    const { mock, tick } = make(30);
    const { consignmentId: c } = await book(mock);
    expect(await mock.advanceDue()).toBe(0); // not due yet
    for (const want of ['picked_up', 'in_transit', 'delivered']) {
      tick(31);
      expect(await mock.advanceDue()).toBe(1);
      expect((await mock.status(c)).status).toBe(want);
    }
    tick(31);
    expect(await mock.advanceDue()).toBe(0); // delivered: nothing left to do
  });

  it('NFR-REL-03 one change at a time per consignment; a consignment held too long is refused', async () => {
    const { mock, redis } = make();
    const { consignmentId: c } = await book(mock);
    await redis.set(`mockcourier:lock:${c}`, '1');
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    const p = mock.requestReturn(c).catch((e: unknown) => e);
    for (let i = 0; i < 60; i++) await jest.advanceTimersByTimeAsync(25);
    jest.useRealTimers();
    expect(await p).toBeInstanceOf(CourierUnavailableError);
  });
});

describe('CourierBreaker', () => {
  it('NFR-REL-04 opens after a run of failed bookings and closes on a success', async () => {
    const b = new CourierBreaker(new FakeRedis() as never);
    for (let i = 1; i < BREAKER.failures; i++) await b.failure();
    expect(await b.isOpen()).toBe(false);
    await b.failure();
    expect(await b.isOpen()).toBe(true);
    await b.success();
    expect(await b.isOpen()).toBe(false);
  });
});

describe('BookingService', () => {
  const row = (o: Record<string, unknown> = {}) => ({
    id: 'S1', order_id: 'O1', direction: 'forward', status: 'preparing', order_cancelled_at: null, booking_attempts: 0,
    pickup_address_enc: sealed(shipmentContext('S1', 'pickup_address_enc'), { line1: 'Shop 4', contactName: 'Karim' }),
    dropoff_address_enc: sealed(shipmentContext('S1', 'dropoff_address_enc')), pickup_area_id: 1, dropoff_area_id: 4,
    billed_kg: 1, listing_id: 'L1', buyer_id: 'B', consignment_id: null, ...o,
  });
  const setup = (o: { row?: Record<string, unknown> | null; book?: () => Promise<{ consignmentId: string }>; stored?: number; after?: Record<string, unknown> } = {}) => {
    const db = fakeDb((sql) => {
      if (sql.includes('JOIN delivery.quotes q')) return o.row === null ? [] : [row(o.row)];
      if (sql.includes('FROM delivery.areas')) return [{ id: 1, district: 'Dhaka', name_en: 'Dhanmondi' }, { id: 4, district: 'Dhaka', name_en: 'Savar' }];
      if (sql.includes("SET status = 'booked'")) return [Array.from({ length: o.stored ?? 1 }, () => ({ simulated: true })), o.stored ?? 1];
      if (sql.includes('SELECT status, consignment_id')) return [{ status: 'preparing', consignment_id: null, order_cancelled_at: null, ...o.after }];
      return [];
    });
    const courier = { provider: 'mock', simulated: true, book: jest.fn(o.book ?? (async () => ({ consignmentId: 'MOCK-1' }))), cancel: jest.fn(async () => 'cancelled') };
    const breaker = { failure: jest.fn(async () => undefined), success: jest.fn(async () => undefined) };
    const orders = { getOrderForParty: jest.fn(async () => ({ buyerId: 'B', sellerId: 'S' })) };
    const identity = { getVerifiedPhone: jest.fn(async (u: string) => (u === 'S' ? '+8801700000002' : '+8801700000001')) };
    const listings = { fulfilmentFacts: jest.fn(async () => ({ sizeClass: null })) };
    const svc = new BookingService(db as never, breaker as never, courier as never, orders as never, crypto as never, identity as never, listings as never);
    return { svc, db, courier, breaker };
  };
  const sqls = (db: ReturnType<typeof fakeDb>) => db.query.mock.calls.map(([s]) => String(s));

  it('NFR-REL-04 DV-29 retries back off from 1 minute, doubling, with jitter, to at most 1 hour', () => {
    expect(backoffMs(1, 0.5)).toBe(60_000);
    expect(backoffMs(2, 0.5)).toBe(120_000);
    expect(backoffMs(1, 0)).toBe(45_000);
    expect(backoffMs(1, 1)).toBe(75_000);
    expect(backoffMs(20, 1)).toBe(3_600_000);
    expect(DV_29.attempts).toBe(8);
  });

  it('SEC-PAY-07 FR-PRV-01 FR-DLV-05 a booking sends both addresses, the verified numbers and no cash, with the shipment id as the reference', async () => {
    const s = setup();
    expect(await s.svc.book('S1')).toBe('booked');
    expect(s.courier.book).toHaveBeenCalledWith({
      shipmentId: 'S1', cashToCollect: 0, parcel: { billedKg: 1, sizeClass: 'small' },
      pickup: { line1: 'Shop 4', contactName: 'Karim', phone: '+8801700000002', district: 'Dhaka', area: 'Dhanmondi' },
      dropoff: { ...LINES, phone: '+8801700000001', district: 'Dhaka', area: 'Savar' },
    });
    expect(s.breaker.success).toHaveBeenCalled();
    expect(sqls(s.db).some((q) => q.includes('delivery.outbox'))).toBe(true);
    // a return goes the other way: from the buyer to the seller
    const r = setup({ row: { direction: 'return' } });
    await r.svc.book('S1');
    expect((r.courier.book.mock.calls[0] as unknown[])[0]).toMatchObject({ pickup: { phone: '+8801700000001' }, dropoff: { phone: '+8801700000002' } });
  });

  it('FR-DLV-10 nothing is booked that is not preparing, is cancelled, or lacks the pickup address', async () => {
    expect(await setup({ row: null }).svc.book('S1')).toBe('not_due');
    expect(await setup({ row: { status: 'booked' } }).svc.book('S1')).toBe('not_due');
    expect(await setup({ row: { order_cancelled_at: T0 } }).svc.book('S1')).toBe('not_due');
    const w = setup({ row: { pickup_address_enc: null, pickup_area_id: null } });
    expect(await w.svc.book('S1')).toBe('waiting_for_pickup_address');
    expect(w.courier.book).not.toHaveBeenCalled();
  });

  it('SEC-PAY-07 a booking that lost a race stores nothing twice; one for a cancelled order is cancelled with the courier', async () => {
    const same = setup({ stored: 0, after: { status: 'booked', consignment_id: 'MOCK-1' } });
    expect(await same.svc.book('S1')).toBe('booked');
    expect(same.courier.cancel).not.toHaveBeenCalled();
    const gone = setup({ stored: 0, after: { status: 'cancelled' } });
    expect(await gone.svc.book('S1')).toBe('not_due');
    expect(gone.courier.cancel).toHaveBeenCalledWith('MOCK-1');
  });

  it('NFR-REL-04 DV-29 a failed booking is retried later; after the last attempt an operator issue is opened', async () => {
    const fail = async () => { throw new Error('courier down'); };
    const s = setup({ book: fail });
    expect(await s.svc.book('S1')).toBe('retry');
    expect(s.breaker.failure).toHaveBeenCalled();
    expect(s.db.query.mock.calls.find(([q]) => String(q).includes("interval '1 millisecond'"))?.[1]?.slice(0, 2)).toEqual(['S1', 1]);
    const last = setup({ book: fail, row: { booking_attempts: DV_29.attempts - 1 } });
    expect(await last.svc.book('S1')).toBe('gave_up');
    expect(last.db.query.mock.calls.find(([q]) => String(q).includes('INSERT INTO delivery.issues'))?.[1]?.[1]).toBe('booking_failed');
    const ret = setup({ book: fail, row: { booking_attempts: DV_29.attempts - 1, direction: 'return' } });
    await ret.svc.book('S1');
    expect(ret.db.query.mock.calls.find(([q]) => String(q).includes('INSERT INTO delivery.issues'))?.[1]?.[1]).toBe('return_failed');
  });

  it('NFR-REL-03 the job claims due shipments one at a time (SKIP LOCKED) until none is left', async () => {
    let n = 0;
    const db = fakeDb((sql) => {
      if (sql.includes('SKIP LOCKED')) return n++ < 2 ? [[{ id: `S${n}` }], 1] : [[], 0];
      return [];
    });
    const svc = new BookingService(db as never, {} as never, {} as never, {} as never, crypto as never, {} as never, {} as never);
    const book = jest.spyOn(svc, 'book').mockResolvedValueOnce('booked').mockResolvedValueOnce('retry');
    expect(await svc.bookDue()).toBe(1);
    expect(book.mock.calls).toEqual([['S1'], ['S2']]);
  });
});

describe('StatusService', () => {
  const RES = { outcome: 'applied', pickup_recorded: false, pickup_on_time: false, delivered: false, returned: false, after_cancel: false };
  const setup = (o: { direction?: string; res?: Partial<typeof RES>; shipment?: boolean; charge?: string | null } = {}) => {
    const db = fakeDb((sql) => {
      if (sql.includes('SELECT order_id, direction')) return o.shipment === false ? [] : [{ order_id: 'O1', direction: o.direction ?? 'forward' }];
      if (sql.includes('delivery.apply_status')) return [{ ...RES, ...o.res }];
      if (sql.includes('SELECT picked_up_at')) return [{ picked_up_at: T0, delivered_at: T0, return_charge: o.charge ?? null }];
      if (sql.includes('WHERE provider = $1 AND consignment_id')) return o.shipment === false ? [] : [{ id: 'S1' }];
      return [];
    });
    const courier = {
      provider: 'mock',
      verifyWebhook: jest.fn((h: Record<string, string>) => { if (h.bad) throw new CourierSignatureError('bad'); return { consignmentId: 'MOCK-1', status: h.status ?? 'picked_up', occurredAt: T0, eventId: 'E1' }; }),
      status: jest.fn(async () => ({ status: 'in_transit', occurredAt: T0, eventId: 'E2' })),
    };
    const orders = {
      lockForFulfilment: jest.fn(async () => ({})), recordFulfilmentStep: jest.fn(), recordDeliveryEvent: jest.fn(), refundCourierReturned: jest.fn(), recordCourierCost: jest.fn(),
    };
    const params = { current: async () => ({ ms: () => 300_000 }) };
    const svc = new StatusService(db as never, courier as never, orders as never, params as never, { now: () => T0 });
    return { svc, db, courier, orders };
  };
  const report = { status: 'picked_up' as const, occurredAt: T0, eventId: 'E1' };

  it('SEC-PAY-03 IF-COM-03 the webhook is for the configured provider only, verified, and a known consignment', async () => {
    const s = setup();
    expect(await problemOf(s.svc.webhook('pathao', {}, Buffer.from('{}')))).toEqual(['not-found']);
    expect(await problemOf(s.svc.webhook('mock', { bad: '1' }, Buffer.from('{}')))).toEqual(['validation-failed', 'signature:invalid']);
    expect(await setup({ shipment: false }).svc.webhook('mock', {}, Buffer.from('{}'))).toEqual({ received: true, outcome: 'unknown_consignment' });
    expect(await s.svc.webhook('mock', {}, Buffer.from('{}'))).toEqual({ received: true, outcome: 'applied' });
    expect(s.db.query.mock.calls.find(([q]) => String(q).includes('apply_status'))?.[1]?.[3]).toBe('provider_webhook');
  });

  it('FR-DLV-10 FR-PAY-07 "delivered" and "returned" by webhook are confirmed by a status query first', async () => {
    const s = setup();
    await s.svc.webhook('mock', { status: 'delivered' }, Buffer.from('{}'));
    expect(s.courier.status).toHaveBeenCalledWith('MOCK-1');
    expect(s.db.query.mock.calls.find(([q]) => String(q).includes('apply_status'))?.[1]?.slice(1, 4)).toEqual(['in_transit', T0, 'provider_query']);
  });

  it('DC-14 FR-PAY-08 the order is locked first; an on-time pickup is the fulfilment step, a late or after-cancel one is not', async () => {
    const s = setup({ res: { pickup_recorded: true, pickup_on_time: true } });
    await s.svc.apply('S1', report, 'provider_webhook');
    expect(s.orders.lockForFulfilment).toHaveBeenCalledWith('O1', s.db.manager);
    expect(s.orders.recordFulfilmentStep).toHaveBeenCalledWith('O1', 'courier_pickup', T0, s.db.manager);
    const late = setup({ res: { pickup_recorded: true, pickup_on_time: false } });
    await late.svc.apply('S1', report, 'provider_webhook');
    expect(late.orders.recordFulfilmentStep).not.toHaveBeenCalled();
    const dup = setup({ res: { outcome: 'duplicate' } });
    await dup.svc.apply('S1', report, 'provider_webhook');
    expect(dup.orders.recordFulfilmentStep).not.toHaveBeenCalled();
    expect(await problemOf(setup({ shipment: false }).svc.apply('S1', report, 'system'))).toEqual(['not-found']);
  });

  it('FR-DLV-10 FR-DLV-12 I-21 delivery is the delivery event; a return refunds in full, or after a cancellation books only the charge', async () => {
    const d = setup({ res: { delivered: true } });
    await d.svc.apply('S1', report, 'provider_query');
    expect(d.orders.recordDeliveryEvent).toHaveBeenCalledWith('O1', 'courier_delivered', T0, d.db.manager);
    const r = setup({ res: { returned: true }, charge: '6000' });
    await r.svc.apply('S1', report, 'provider_query');
    expect(r.orders.refundCourierReturned).toHaveBeenCalledWith('O1', 6000n, r.db.manager);
    const c = setup({ res: { returned: true, after_cancel: true }, charge: '5000' });
    await c.svc.apply('S1', report, 'provider_query');
    expect(c.orders.recordCourierCost).toHaveBeenCalledWith('O1', 5000n, c.db.manager);
    expect(c.orders.refundCourierReturned).not.toHaveBeenCalled();
    // a return shipment the courier brought back to the buyer: an operator issue, no money moves
    const ret = setup({ direction: 'return', res: { returned: true } });
    await ret.svc.query('S1', 'MOCK-1');
    expect(ret.db.query.mock.calls.some(([q]) => String(q).includes("'return_failed'"))).toBe(true);
    expect(ret.orders.refundCourierReturned).not.toHaveBeenCalled();
  });

  it('I-62 every issue a transaction opened is announced once as delivery.issue.opened', async () => {
    const db = fakeDb((sql) => (sql.includes('FROM delivery.issues') ? [{ id: 'I1', kind: 'status_refused' }] : []));
    await announceNewIssues(db.manager as never, 'O1');
    expect(db.query.mock.calls[1]).toEqual([expect.stringContaining('delivery.outbox'), ['delivery.issue.opened', 'O1', JSON.stringify({ issueId: 'I1', orderId: 'O1', kind: 'status_refused' })]]);
  });
});

describe('ShipmentService', () => {
  const SHIP = (o: Record<string, unknown> = {}) => ({
    id: 'S1', order_id: 'O1', direction: 'forward', provider: 'mock', simulated: true, quote_id: 'Q1', fee: '8000', status: 'booked',
    pickup_due_at: T0, consignment_id: 'MOCK-1', pickup_area_id: 1, dropoff_area_id: 4,
    pickup_address_enc: sealed(shipmentContext('S1', 'pickup_address_enc'), { line1: 'Shop 4', contactName: 'Karim' }),
    dropoff_address_enc: sealed(shipmentContext('S1', 'dropoff_address_enc')), addresses_erased_at: null,
    booked_at: T0, picked_up_at: null, delivered_at: null, returned_at: null, cancelled_at: null, failed_attempts: 0, order_cancelled_at: null, ...o,
  });
  const setup = (answer: Answer = () => [], o: { order?: Record<string, unknown>; courier?: Record<string, unknown> } = {}) => {
    const db = fakeDb(answer);
    const booking = { book: jest.fn(async () => 'booked') };
    const statuses = { query: jest.fn(async () => ({})), apply: jest.fn(async () => ({})) };
    const courier = { provider: 'mock', simulated: true, cancel: jest.fn(async () => 'cancelled'), requestReturn: jest.fn(async () => undefined), status: jest.fn(async () => ({ status: 'picked_up', occurredAt: T0, eventId: 'E' })), ...o.courier };
    const orders = { getOrderForParty: jest.fn(async (_o: string, u: string) => { if (u === 'X') throw new Problem('not-found'); return { buyerId: 'B', sellerId: 'S', ...o.order }; }) };
    const listings = { fulfilmentFacts: jest.fn(async () => ({ weightClass: 'up_to_1kg', sizeClass: 'small' })) };
    const audit = { record: jest.fn(async () => undefined) };
    const svc = new ShipmentService(db as never, booking as never, statuses as never, courier as never, orders as never, crypto as never, listings as never, audit as never);
    return { svc, db, booking, statuses, courier, audit };
  };
  const has = (db: ReturnType<typeof fakeDb>, s: string) => db.query.mock.calls.some(([q]) => String(q).includes(s));

  it('FR-DLV-10 a paid courier order gets one forward shipment with copies of both addresses, then is booked', async () => {
    const s = setup((sql) => {
      if (sql.includes('FROM delivery.quotes q LEFT JOIN')) return [{ fee: '8000', to_area_id: 4, order_id: 'O1', address_id: 'A1', address_enc: sealed('delivery.saved_addresses.address_enc:A1') }];
      if (sql.includes("kind = 'pickup'")) return [{ id: 'A2', area_id: 1, address_enc: sealed('delivery.saved_addresses.address_enc:A2', { line1: 'Shop', contactName: 'K' }) }];
      if (sql.includes('INSERT INTO delivery.shipments')) return [{ id: 'new' }];
      return [];
    });
    const id = await s.svc.createForward({ orderId: 'O1', sellerId: 'S', quoteId: 'Q1', pickupDueAt: T0.toISOString() });
    expect(id).toEqual(expect.any(String));
    expect(s.booking.book).toHaveBeenCalledWith(id);
    const insert = s.db.query.mock.calls.find(([q]) => String(q).includes('INSERT INTO delivery.shipments'))!;
    expect(String((insert[1] as Buffer[])[8])).toContain(shipmentContext(id!, 'dropoff_address_enc')); // re-encrypted under the shipment
    // redelivered: the shipment exists, nothing is booked again
    const again = setup((sql) => (sql.includes('FROM delivery.quotes q LEFT JOIN') ? [{ fee: '8000', to_area_id: 4, order_id: 'O1', address_id: 'A1', address_enc: sealed('delivery.saved_addresses.address_enc:A1') }] : []));
    expect(await again.svc.createForward({ orderId: 'O1', sellerId: 'S', quoteId: 'Q1', pickupDueAt: T0.toISOString() })).toBeNull();
    expect(again.booking.book).not.toHaveBeenCalled();
  });

  it('FR-DLV-07 a drop-off address deleted after payment goes to an operator; a quote not claimed by the order is an error', async () => {
    const gone = setup((sql) => (sql.includes('FROM delivery.quotes q LEFT JOIN') ? [{ fee: '8000', to_area_id: 4, order_id: 'O1', address_id: null, address_enc: null }] : []));
    expect(await gone.svc.createForward({ orderId: 'O1', sellerId: 'S', quoteId: 'Q1', pickupDueAt: T0.toISOString() })).toBeNull();
    expect(gone.db.query.mock.calls.find(([q]) => String(q).includes('INSERT INTO delivery.issues'))?.[1]).toEqual(['O1', JSON.stringify({ reason: 'dropoff_address_deleted' })]);
    await expect(setup(() => []).svc.createForward({ orderId: 'O1', sellerId: 'S', quoteId: 'Q1', pickupDueAt: '' })).rejects.toThrow(/not claimed/);
  });

  it('FR-DLV-07 FR-DLV-14 each party sees their own address and the other\'s district; the seller is asked for a pickup address', async () => {
    const rows = [SHIP(), SHIP({ id: 'S2', direction: 'return', status: 'preparing', pickup_address_enc: null, dropoff_address_enc: null, pickup_area_id: 4, dropoff_area_id: 1 })];
    const answer: Answer = (sql) => {
      if (sql.includes('FROM delivery.shipments WHERE order_id')) return rows;
      if (sql.includes('FROM delivery.areas')) return [{ id: 1, district: 'Dhaka', name_en: 'Dhanmondi', name_bn: 'ধানমন্ডি' }, { id: 4, district: 'Dhaka', name_en: 'Savar', name_bn: 'সাভার' }];
      if (sql.includes('shipment_history')) return [{ from_status: null, to_status: 'preparing', at: T0 }];
      return [];
    };
    const b = await setup(answer).svc.view('B', 'O1');
    expect(b.items[0]).toMatchObject({ simulated: true, cashToCollect: '0', needsPickupAddress: false, myAddress: { ...LINES, area: { nameEn: 'Savar' } }, other: { district: 'Dhaka' } });
    expect(b.items[1].myAddress).toBeNull();
    const s = await setup(answer).svc.view('S', 'O1');
    expect(s.items[0].myAddress).toMatchObject({ line1: 'Shop 4' });
    rows[0] = SHIP({ status: 'preparing', pickup_address_enc: null, pickup_area_id: null, consignment_id: null });
    expect((await setup(answer).svc.view('S', 'O1')).items[0]).toMatchObject({ needsPickupAddress: true, myAddress: null });
    expect(await problemOf(setup(answer).svc.view('X', 'O1'))).toEqual(['not-found']);
  });

  it('FR-DLV-07 the pickup address: the seller\'s own saved pickup address, while the shipment is preparing', async () => {
    const answer = (o: { status?: string; address?: boolean; ship?: boolean }): Answer => (sql) => {
      if (sql.includes("direction = 'forward' FOR UPDATE")) return o.ship === false ? [] : [{ id: 'S1', status: o.status ?? 'preparing', order_cancelled_at: null }];
      if (sql.includes("kind = 'pickup' AND deleted_at")) return o.address === false ? [] : [{ id: 'A2', area_id: 1, address_enc: sealed('delivery.saved_addresses.address_enc:A2') }];
      return [];
    };
    expect(await problemOf(setup(answer({})).svc.setPickupAddress('B', 'O1', 'A2'))).toEqual(['forbidden', 'order:seller-only']);
    expect(await problemOf(setup(answer({ ship: false })).svc.setPickupAddress('S', 'O1', 'A2'))).toEqual(['not-found']);
    expect(await problemOf(setup(answer({ status: 'booked' })).svc.setPickupAddress('S', 'O1', 'A2'))).toEqual(['order-state', 'shipment:already-booked-or-closed']);
    expect(await problemOf(setup(answer({ address: false })).svc.setPickupAddress('S', 'O1', 'A9'))).toEqual(['validation-failed', 'addressId:not-a-pickup-address-of-yours']);
    const ok = setup(answer({}));
    await ok.svc.setPickupAddress('S', 'O1', 'A2');
    expect(ok.booking.book).toHaveBeenCalledWith('S1');
  });

  it('FR-PAY-09 a refund cancels a preparing shipment, cancels a booking with the courier, or asks for the parcel back', async () => {
    const at = (status: string | null): Answer => (sql) => (sql.includes("direction = 'forward' FOR UPDATE") ? (status ? [{ id: 'S1', status, consignment_id: status === 'preparing' ? null : 'MOCK-1', simulated: true }] : []) : []);
    const none = setup(at(null));
    await none.svc.cancelForRefund('O1');
    expect(has(none.db, 'order_cancelled_at')).toBe(false);
    const done = setup(at('delivered'));
    await done.svc.cancelForRefund('O1');
    expect(has(done.db, 'order_cancelled_at')).toBe(false);
    const prep = setup(at('preparing'));
    await prep.svc.cancelForRefund('O1');
    expect(has(prep.db, 'addresses_erased_at = now()')).toBe(true);
    expect(prep.courier.cancel).not.toHaveBeenCalled();
    const booked = setup(at('booked'));
    await booked.svc.cancelForRefund('O1');
    expect(booked.statuses.query).toHaveBeenCalledWith('S1', 'MOCK-1');
    expect(booked.courier.requestReturn).not.toHaveBeenCalled();
    const taken = setup(at('booked'), { courier: { cancel: jest.fn(async () => 'already_picked_up') } });
    await taken.svc.cancelForRefund('O1');
    expect(taken.courier.requestReturn).toHaveBeenCalledWith('MOCK-1');
    const moving = setup(at('in_transit'));
    await moving.svc.cancelForRefund('O1');
    expect(moving.courier.cancel).not.toHaveBeenCalled();
    expect(moving.courier.requestReturn).toHaveBeenCalledWith('MOCK-1');
  });

  it('FR-DLV-11 I-22 DV-32 syncPickup asks once, applies a pickup, and never throws', async () => {
    const booked: Answer = (sql) => (sql.includes("status = 'booked'") ? [{ id: 'S1', consignment_id: 'MOCK-1' }] : []);
    const none = setup(() => []);
    await none.svc.syncPickup('O1');
    expect(none.courier.status).not.toHaveBeenCalled();
    const picked = setup(booked);
    await picked.svc.syncPickup('O1');
    expect(picked.statuses.apply).toHaveBeenCalledWith('S1', { status: 'picked_up', occurredAt: T0, eventId: 'E' }, 'provider_query');
    const still = setup(booked, { courier: { status: jest.fn(async () => ({ status: 'booked', occurredAt: T0, eventId: 'E0' })) } });
    await still.svc.syncPickup('O1');
    expect(still.statuses.apply).not.toHaveBeenCalled();
    const down = setup(booked, { courier: { status: jest.fn(async () => { throw new Error('timeout'); }) } });
    await expect(down.svc.syncPickup('O1')).resolves.toBeUndefined();
  });

  it('FR-DSP-06 return shipments: courier orders that were delivered, from the forward shipment\'s addresses swapped', async () => {
    const forward = (o: Record<string, unknown> = {}): Answer => (sql) => {
      if (sql.includes('JOIN delivery.quotes q ON q.id = s.quote_id')) return o.none ? [] : [{ ...SHIP({ status: 'delivered' }), buyer_id: 'B', listing_id: 'L1', quantity: 1, ...o }];
      if (sql.includes('SELECT district, lat, lng')) return [{ district: 'Dhaka', lat: '23.858', lng: '90.267' }];
      if (sql.includes('make_quote')) return [{ id: 'RQ', to_area_id: 1, billed_kg: 1, fee: '5000', fare_version: 1, expires_at: T0 }];
      if (sql.includes('claim_quote')) return [{ fee: '5000' }];
      if (sql.includes('SELECT to_area_id')) return [{ to_area_id: 1 }];
      return [];
    };
    expect(await problemOf(setup(forward({ none: true })).svc.quoteReturn('O1', 4, 1))).toEqual(['validation-failed', 'order:return-needs-a-courier-order']);
    expect(await problemOf(setup(forward({ status: 'in_transit' })).svc.quoteReturn('O1', 4, 1))).toEqual(['order-state', 'shipment:not-delivered-or-addresses-erased']);
    expect(await problemOf(setup(forward()).svc.quoteReturn('O1', 1, 4))).toEqual(['validation-failed', 'areas:must-be-the-forward-shipment-areas-swapped']);
    expect(await setup(forward()).svc.quoteReturn('O1', 4, 1)).toEqual({ id: 'RQ', orderId: 'O1', fromAreaId: 4, toAreaId: 1, billedKg: 1, fee: '5000', fareVersion: 1, expiresAt: T0.toISOString() });
    const s = setup(forward());
    const id = await s.svc.bookReturn('O1', 'RQ', 'buyer', s.db.manager as never);
    const insert = s.db.query.mock.calls.find(([q]) => String(q).includes('INSERT INTO delivery.shipments'))!;
    expect(String((insert[1] as Buffer[])[7])).toContain('House 12'); // the buyer's address is the return's pickup
    expect(String((insert[1] as Buffer[])[9])).toContain('Shop 4');
    expect(id).toEqual(expect.any(String));
    expect(await problemOf(s.svc.bookReturn('O1', 'RQ', 'nobody' as never, s.db.manager as never))).toEqual(['validation-failed', 'payer:buyer-or-seller']);
  });

  it('FR-DSP-06 the seller confirms a returned item once; nobody else can', async () => {
    const at = (o: { ship?: boolean; status?: string; done?: boolean }): Answer => (sql) => {
      if (sql.includes("direction = 'return' FOR UPDATE")) return o.ship === false ? [] : [{ id: 'R1', status: o.status ?? 'in_transit', simulated: true }];
      if (sql.includes("event_type = 'delivery.return.delivered'")) return o.done ? [{ created_at: T0 }] : [];
      if (sql.includes('SELECT now()')) return [{ at: T0 }];
      return [];
    };
    expect(await problemOf(setup(at({})).svc.returnReceived('B', 'O1'))).toEqual(['forbidden', 'order:seller-only']);
    expect(await problemOf(setup(at({ ship: false })).svc.returnReceived('S', 'O1'))).toEqual(['not-found']);
    expect(await problemOf(setup(at({ status: 'cancelled' })).svc.returnReceived('S', 'O1'))).toEqual(['order-state', 'shipment:return-cancelled']);
    const first = setup(at({}));
    expect(await first.svc.returnReceived('S', 'O1')).toEqual({ status: 'received', at: T0.toISOString() });
    expect(first.audit.record).toHaveBeenCalled();
    const again = setup(at({ done: true }));
    expect(await again.svc.returnReceived('S', 'O1')).toEqual({ status: 'received', at: T0.toISOString() });
    expect(again.audit.record).not.toHaveBeenCalled();
  });
});

describe('RecordsService', () => {
  const issue = (o: Record<string, unknown> = {}) => ({ id: 'I1', order_id: 'O1', kind: 'pickup_after_cancel', detail: {}, status: 'open', created_at: T0, resolved_by: null, resolved_at: null, resolution: null, cursor_at: '2026-11-02T10:00:00.000000Z', ...o });
  const setup = (answer: Answer) => {
    const db = fakeDb(answer);
    const audit = { record: jest.fn(async () => undefined) };
    const params = { current: async () => ({ ms: () => 7 * 86_400_000 }) };
    return { svc: new RecordsService(db as never, crypto as never, audit as never, params as never), db, audit };
  };

  it('FR-DLV-11 FR-DSP-01 not_received is allowed by the database after CP-17 from pickup', async () => {
    const s = setup(() => [{ ok: true }]);
    expect(await s.svc.notReceivedAllowed('O1')).toBe(true);
    expect(s.db.query.mock.calls[0][1]).toEqual(['O1', 7 * 86_400_000]);
  });

  it('SEC-ACC-03 the issue queue pages oldest first; an issue resolves once, with a reason, audited', async () => {
    const page = setup(() => Array.from({ length: 51 }, (_, i) => issue({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}` })));
    const first = await page.svc.openIssues();
    expect(first.items).toHaveLength(50);
    expect(first.nextCursor).toEqual(expect.any(String));
    await page.svc.openIssues(first.nextCursor!);
    expect(page.db.query.mock.calls[1][1]).toEqual(['2026-11-02T10:00:00.000000Z', '00000000-0000-4000-8000-000000000049']);
    expect((await setup(() => [issue()]).svc.openIssues()).nextCursor).toBeNull();

    expect(await problemOf(setup(() => []).svc.resolveIssue('I1', 'ST', 'short'))).toEqual(['validation-failed', 'reason:too-short']);
    expect(await problemOf(setup(() => []).svc.resolveIssue('I1', 'ST', 'checked with the courier'))).toEqual(['not-found']);
    expect(await problemOf(setup(() => [issue({ status: 'resolved' })]).svc.resolveIssue('I1', 'ST', 'checked with the courier'))).toEqual(['validation-failed', 'issue:not-open']);
    const ok = setup((sql) => (sql.includes('FOR UPDATE') ? [issue()] : []));
    await ok.svc.resolveIssue('I1', 'ST', 'checked with the courier');
    expect(ok.audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'delivery.issue.resolved', reason: 'checked with the courier' }), ok.db.manager);
  });

  it('SEC-ACC-05 FR-DSP-05 the fulfilment record masks addresses unless a reason is given, audits a full view, and never has the code', async () => {
    const answer: Answer = (sql) => {
      if (sql.includes('FROM delivery.handovers')) return [{ status: 'completed', due_at: T0, code_version: 1, wrong_entries: 1, locked_at: null, completed_at: T0, cancelled_at: null }];
      if (sql.includes('FROM delivery.meetup_proposals')) return [{ id: 'P1', proposed_by: 'B', point: 'Thana', place_name: null, meet_at: T0, status: 'accepted', created_at: T0, responded_at: T0 }];
      if (sql.includes('FROM delivery.code_entries')) return [{ code_version: 1, correct: false, at: T0 }, { code_version: 1, correct: true, at: T0 }];
      if (sql.includes('FROM delivery.shipments s')) {
        return [{ id: 'S1', direction: 'forward', provider: 'mock', simulated: true, consignment_id: 'MOCK-1', status: 'delivered', fee: '8000', pickup_due_at: T0, booked_at: T0,
          picked_up_at: T0, delivered_at: T0, returned_at: null, cancelled_at: null, order_cancelled_at: null, failed_attempts: 0, return_charge: null, booking_attempts: 0,
          pickup_area_id: 1, dropoff_area_id: 4, p_district: 'Dhaka', p_name: 'Dhanmondi', d_district: 'Dhaka', d_name: 'Savar', addresses_erased_at: null,
          pickup_address_enc: null, dropoff_address_enc: sealed(shipmentContext('S1', 'dropoff_address_enc'), { ...LINES, landmark: 'Mosque' }) }];
      }
      if (sql.includes('shipment_history')) return [{ from_status: null, to_status: 'preparing', source: 'system', event_id: null, at: T0 }];
      if (sql.includes('FROM delivery.issues')) return [issue({ status: 'resolved', resolved_by: 'ST', resolved_at: T0, resolution: 'done and dusted' })];
      return [];
    };
    const masked = setup(answer);
    const r = await masked.svc.fulfilmentRecord('O1');
    expect(r.handover).toMatchObject({ status: 'completed', codeEntries: [{ correct: false }, { correct: true }], proposals: [{ point: 'Thana' }] });
    expect(r.shipments[0].dropoff).toEqual({ area: { id: 4, district: 'Dhaka', nameEn: 'Savar' }, line1: 'H•••', line2: null, landmark: 'M•••', contactName: 'R•••', masked: true, erased: false });
    expect(r.shipments[0].pickup).toMatchObject({ line1: null, masked: true });
    expect(JSON.stringify(r)).not.toMatch(/House|Rahim|"code"/);
    expect(masked.audit.record).not.toHaveBeenCalled();

    const full = setup(answer);
    const f = await full.svc.staffRecord('O1', 'ST', 'Checking the address with the courier');
    expect(f.shipments[0].dropoff).toMatchObject({ line1: 'House 12, Road 5', contactName: 'Rahim Buyer', masked: false });
    expect(full.audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'delivery.address.revealed', objectId: 'O1' }), full.db.manager);
    expect(await problemOf(setup(answer).svc.staffRecord('O1', 'ST', 'short'))).toEqual(['validation-failed', 'reason:too-short']);
    expect(await problemOf(setup(() => []).svc.staffRecord('O1', 'ST'))).toEqual(['not-found']);
    expect(mask('Ábc')).toBe('Á•••');
    expect(mask(undefined)).toBeNull();
  });
});

describe('Courier wiring', () => {
  it('I-21 I-22 the ports answer through the service that owns each method; courier checkout is on', async () => {
    const quotes = { claimQuote: jest.fn(async () => 1n) };
    const shipments = { syncPickup: jest.fn(), quoteReturn: jest.fn(), bookReturn: jest.fn() };
    const handovers = { unlockHandoverCode: jest.fn() };
    const records = { resolveIssue: jest.fn(), fulfilmentRecord: jest.fn(), notReceivedAllowed: jest.fn(), openIssues: jest.fn() };
    const p = new DeliveryPorts(quotes as never, shipments as never, handovers as never, records as never);
    expect(p.shipsCourier).toBe(true);
    const tx = {} as never;
    await p.claimQuote({ quoteId: 'Q', orderId: 'O', buyerId: 'B', listingId: 'L', quantity: 1 }, tx);
    await p.syncPickup('O');
    await p.quoteReturn('O', 1, 2);
    await p.bookReturn('O', 'Q', 'seller', tx);
    await p.unlockHandoverCode('O', 'ST', 'reason');
    await p.resolveIssue('I', 'ST', 'reason');
    await p.fulfilmentRecord('O');
    await p.notReceivedAllowed('O');
    await p.openIssues('c');
    for (const f of [quotes.claimQuote, shipments.syncPickup, shipments.quoteReturn, shipments.bookReturn, handovers.unlockHandoverCode, records.resolveIssue, records.fulfilmentRecord, records.notReceivedAllowed, records.openIssues]) {
      expect(f).toHaveBeenCalledTimes(1);
    }
  });

  it('NFR-REL-03 the booking job runs every minute; the mock\'s webhooks go to the normal handler; auto-advance only when set', async () => {
    const registered: { name: string; intervalMs: number; run(): Promise<unknown> }[] = [];
    const runner = { register: (j: (typeof registered)[number]) => registered.push(j) };
    const booking = { bookDue: jest.fn(async () => 2) };
    const statuses = { webhook: jest.fn(async () => ({ received: true })) };
    const upkeep = { reconcile: jest.fn(async () => ({ done: 3, failed: 0 })), lapseProposals: jest.fn(async () => 1), eraseAddresses: jest.fn(async () => ({ done: 2, failed: 1 })), purgeProviderEvents: jest.fn(async () => 4) };
    const mock = new MockCourier(new FakeRedis() as never, 's', () => T0, 30);
    new DeliveryJobs(runner as never, booking as never, statuses as never, upkeep as never, mock).onModuleInit();
    expect(registered.map((j) => [j.name, j.intervalMs])).toEqual([
      ['delivery.booking', 60_000], ['delivery.reconciliation', 1_800_000], ['delivery.proposal_lapse', 900_000],
      ['delivery.address_erasure', 86_400_000], ['delivery.provider_events', 86_400_000], ['delivery.mock_courier.advance', 30_000],
    ]);
    expect(await Promise.all(registered.map((j) => j.run()))).toEqual([2, 3, 1, 2, 4, 0]);
    const { consignmentId } = await mock.book({ shipmentId: 'S', pickup: ADDR, dropoff: ADDR, parcel: { billedKg: 1, sizeClass: 'small' }, cashToCollect: 0 });
    await mock.advance(consignmentId);
    expect(statuses.webhook).toHaveBeenCalledWith('mock', expect.any(Object), expect.any(Buffer));
    const plain: typeof registered = [];
    new DeliveryJobs({ register: (j: (typeof registered)[number]) => plain.push(j) } as never, booking as never, statuses as never, upkeep as never, { provider: 'pathao' } as never).onModuleInit();
    expect(plain.map((j) => j.name)).toEqual(['delivery.booking', 'delivery.reconciliation', 'delivery.proposal_lapse', 'delivery.address_erasure', 'delivery.provider_events']);
  });

  it('I-19 FR-PAY-09 paid courier orders get a shipment; refunds cancel it; a closed account\'s saved addresses are erased', async () => {
    const handlers: Record<string, (e: unknown) => Promise<void>> = {};
    const bus = { on: (type: string, _name: string, h: (e: unknown) => Promise<void>) => { handlers[type] = h; } };
    const shipments = { createForward: jest.fn(async () => 'S1'), cancelForRefund: jest.fn(async () => undefined) };
    const db = fakeDb(() => []);
    new ShipmentConsumers(bus as never, shipments as never, db as never).onModuleInit();
    const paid = { orderId: 'O1', fulfilment: 'courier', itemKind: 'physical', sellerId: 'S', fulfilmentDueAt: T0.toISOString(), deliveryQuoteId: 'Q1' };
    await handlers['orders.order.paid']({ aggregateId: 'O1', payload: paid });
    expect(shipments.createForward).toHaveBeenCalledWith({ orderId: 'O1', sellerId: 'S', quoteId: 'Q1', pickupDueAt: T0.toISOString() });
    await handlers['orders.order.paid']({ aggregateId: 'O2', payload: { ...paid, fulfilment: 'self_pickup' } });
    expect(shipments.createForward).toHaveBeenCalledTimes(1);
    await handlers['orders.escrow.refunded']({ aggregateId: 'O1', payload: {} });
    expect(shipments.cancelForRefund).toHaveBeenCalledWith('O1');
    await handlers['identity.account.closed']({ aggregateId: 'U1', payload: {} });
    expect(db.query.mock.calls[0][1]).toEqual(['U1']);
  });

  it('SEC-SDL-09 the controllers pass the caller and refuse the wrong kind of principal', async () => {
    const user = { type: 'user', userId: 'U' } as never;
    const staff = { type: 'staff', staffId: 'ST' } as never;
    const shipments = { view: jest.fn(), setPickupAddress: jest.fn(), returnReceived: jest.fn() };
    const c = new ShipmentController(shipments as never);
    await c.view('O', user);
    await c.pickupAddress('O', { addressId: 'A' }, user);
    await c.returnReceived('O', user);
    expect(shipments.setPickupAddress).toHaveBeenCalledWith('U', 'O', 'A');
    expect(() => c.view('O', staff)).toThrow(Problem);
    const statuses = { webhook: jest.fn() };
    new CourierWebhookController(statuses as never).receive('mock', { rawBody: Buffer.from('x') } as never, {});
    expect(statuses.webhook).toHaveBeenCalledWith('mock', {}, Buffer.from('x'));
    new CourierWebhookController(statuses as never).receive('mock', {} as never, {});
    const records = { openIssues: jest.fn(), resolveIssue: jest.fn(), staffRecord: jest.fn() };
    const s = new DeliveryStaffController(records as never);
    await s.issues({ cursor: 'c' });
    await s.resolve('I', { reason: 'r' }, staff);
    await s.record('O', { reason: 'why' }, staff);
    expect(records.staffRecord).toHaveBeenCalledWith('O', 'ST', 'why');
    await expect(s.resolve('I', { reason: 'r' }, user)).rejects.toBeInstanceOf(Problem);
  });

  it('FR-DLV-14 the simulator exists only with the mock courier, moves parcels, and refuses what the courier would not do', async () => {
    const off = new MockCourierController({ provider: 'pathao' } as never);
    expect(await problemOf(off.advance('MOCK-AAAAAAAAAAAA', {}))).toEqual(['not-found']);
    const mock = new MockCourier(new FakeRedis() as never, 's', () => T0);
    const ctl = new MockCourierController(mock);
    expect(await problemOf(ctl.advance('nope', {}))).toEqual(['not-found']);
    expect(await problemOf(ctl.advance('MOCK-AAAAAAAAAAAA', {}))).toEqual(['not-found']);
    const { consignmentId } = await mock.book({ shipmentId: 'S', pickup: ADDR, dropoff: ADDR, parcel: { billedKg: 1, sizeClass: 'small' }, cashToCollect: 0 });
    expect(await problemOf(ctl.advance(consignmentId, { status: 'delivered' }))).toEqual(['validation-failed', 'status:not-from-booked']);
    expect((await ctl.advance(consignmentId, {})).consignment.status).toBe('picked_up');
    const res = { status: jest.fn().mockReturnThis(), set: jest.fn().mockReturnThis(), send: jest.fn() };
    await ctl.page(res as never);
    expect(res.send.mock.calls[0][0]).toContain(consignmentId);
    expect(res.send.mock.calls[0][0]).toContain('Return charge');
    const empty = { status: jest.fn().mockReturnThis(), set: jest.fn().mockReturnThis(), send: jest.fn() };
    await new MockCourierController(new MockCourier(new FakeRedis() as never, 's', () => T0, 10)).page(empty as never);
    expect(empty.send.mock.calls[0][0]).toMatch(/No simulated parcels yet[\s\S]*|by themselves every 10 seconds/);
  });
});
