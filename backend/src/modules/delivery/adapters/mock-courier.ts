import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import type Redis from 'ioredis';
import type { ShipmentStatus } from '../db/enums';
import {
  CourierPort, CourierSignatureError, CourierStatusReport, CourierUnavailableError, CourierWebhookEvent, type CourierAddress, type SizeClass,
} from './courier-port';

// The mock courier (docs/design/04_delivery.pdf section 7.10; C-3; FR-DLV-14; U4-04). It plays the provider's side
// of CourierPort inside the backend: a booking API that honours the merchant reference, a status API, and signed
// webhooks sent to the normal webhook handler. Its "provider side" is a Redis record per consignment, as the mock
// payment provider keeps one per attempt (U2-03). Parcels move only when an operator advances them on the simulator
// page, or, if MOCK_COURIER_AUTO_ADVANCE_SECONDS is set, by themselves along the happy path (Decisions log, U4-04).
// Nothing here is a real parcel: every shipment it books is labelled simulated.

const TTL_SECONDS = 60 * 24 * 60 * 60;
const KEY = {
  consignment: (id: string) => `mockcourier:c:${id}`,
  ref: (shipmentId: string) => `mockcourier:ref:${shipmentId}`,
  lock: (id: string) => `mockcourier:lock:${id}`,
  recent: 'mockcourier:recent',
  auto: 'mockcourier:auto',
};
export const MOCK_HEADERS = { timestamp: 'x-mock-courier-timestamp', signature: 'x-mock-courier-signature' } as const;

export interface MockEvent { id: string; status: ShipmentStatus; at: string; charge?: string }
export interface MockConsignment {
  id: string;
  ref: string;
  status: ShipmentStatus;
  bookedAt: string;
  parcel: { billedKg: number; sizeClass: SizeClass };
  /** the areas only: the simulator page never shows an address */
  from: string;
  to: string;
  returnRequested: boolean;
  events: MockEvent[];
}

/** The provider's own rules for moving a parcel (the courier side of figure 4). */
export const MOCK_NEXT: Partial<Record<ShipmentStatus, ShipmentStatus[]>> = {
  booked: ['picked_up'],
  picked_up: ['in_transit', 'delivered', 'delivery_failed', 'returned_to_seller'],
  in_transit: ['delivered', 'delivery_failed', 'returned_to_seller'],
  delivery_failed: ['in_transit', 'delivered', 'returned_to_seller'],
};
const HAPPY: Partial<Record<ShipmentStatus, ShipmentStatus>> = { booked: 'picked_up', picked_up: 'in_transit', in_transit: 'delivered', delivery_failed: 'in_transit' };

export type WebhookSink = (headers: Record<string, string>, rawBody: Buffer) => Promise<unknown>;

export class MockCourier implements CourierPort {
  readonly provider = 'mock' as const;
  readonly simulated = true;
  private sink: WebhookSink | null = null;

  constructor(
    private readonly redis: Redis,
    /** COURIER_WEBHOOK_SECRET if set; otherwise a random secret for this process, which signs and checks its own webhooks */
    private readonly secret: string = randomBytes(32).toString('hex'),
    private readonly now: () => Date = () => new Date(),
    /** seconds between automatic steps; 0 = only the simulator moves parcels */
    readonly autoAdvanceSeconds = 0,
  ) {}

  /** The webhook endpoint's handler: the mock "sends" its webhooks to it, signed, as a provider would over HTTPS. */
  setWebhookSink(sink: WebhookSink): void {
    this.sink = sink;
  }

  async book(p: Parameters<CourierPort['book']>[0]): Promise<{ consignmentId: string }> {
    if (p.cashToCollect !== 0) throw new Error('the mock courier never collects cash (FR-DLV-05)');
    const id = `MOCK-${randomBytes(6).toString('hex').toUpperCase()}`;
    // SEC-PAY-07: the merchant reference is claimed once; a repeated booking gets the first consignment
    const won = await this.redis.set(KEY.ref(p.shipmentId), id, 'EX', TTL_SECONDS, 'NX');
    if (won !== 'OK') {
      const existing = await this.redis.get(KEY.ref(p.shipmentId));
      if (!existing) throw new CourierUnavailableError('mock courier: booking reference lost');
      return { consignmentId: existing };
    }
    const at = this.now();
    const c: MockConsignment = {
      id, ref: p.shipmentId, status: 'booked', bookedAt: at.toISOString(), parcel: p.parcel,
      from: areaOf(p.pickup), to: areaOf(p.dropoff), returnRequested: false,
      events: [{ id: `${id}-0`, status: 'booked', at: at.toISOString() }],
    };
    await this.save(c);
    await this.redis.zadd(KEY.recent, at.getTime(), id);
    await this.redis.zremrangebyrank(KEY.recent, 0, -201); // the simulator lists the latest 200
    if (this.autoAdvanceSeconds > 0) await this.redis.zadd(KEY.auto, at.getTime() + this.autoAdvanceSeconds * 1000, id);
    return { consignmentId: id };
  }

  async cancel(consignmentId: string): Promise<'cancelled' | 'already_picked_up'> {
    return this.locked(consignmentId, async (c) => {
      if (c.status === 'cancelled') return 'cancelled';
      if (c.status !== 'booked') return 'already_picked_up';
      this.push(c, 'cancelled');
      await this.save(c);
      await this.redis.zrem(KEY.auto, c.id);
      return 'cancelled';
    });
  }

  async requestReturn(consignmentId: string): Promise<void> {
    await this.locked(consignmentId, async (c) => {
      c.returnRequested = true;
      await this.save(c);
    });
  }

  async status(consignmentId: string): Promise<CourierStatusReport> {
    const c = await this.load(consignmentId);
    const e = c.events[c.events.length - 1];
    return { status: e.status, occurredAt: new Date(e.at), eventId: e.id, ...(e.charge !== undefined ? { returnCharge: BigInt(e.charge) } : {}) };
  }

  verifyWebhook(headers: Record<string, string | string[] | undefined>, rawBody: Buffer, now: Date, toleranceSeconds: number): CourierWebhookEvent {
    const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
    const ts = one(headers[MOCK_HEADERS.timestamp]);
    const sig = one(headers[MOCK_HEADERS.signature]);
    if (!ts || !/^\d{1,12}$/.test(ts) || !sig) throw new CourierSignatureError('missing signature');
    if (Math.abs(Math.floor(now.getTime() / 1000) - Number(ts)) > toleranceSeconds) throw new CourierSignatureError('timestamp outside the tolerance');
    const expected = Buffer.from(`v1=${this.sign(ts, rawBody)}`);
    const given = Buffer.from(sig);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new CourierSignatureError('bad signature');
    const b = JSON.parse(rawBody.toString('utf8')) as { eventId?: unknown; consignmentId?: unknown; status?: unknown; occurredAt?: unknown; returnCharge?: unknown };
    if (typeof b.eventId !== 'string' || typeof b.consignmentId !== 'string' || typeof b.status !== 'string' || typeof b.occurredAt !== 'string') {
      throw new CourierSignatureError('malformed body');
    }
    return {
      eventId: b.eventId, consignmentId: b.consignmentId, status: b.status as ShipmentStatus, occurredAt: new Date(b.occurredAt),
      ...(typeof b.returnCharge === 'string' ? { returnCharge: BigInt(b.returnCharge) } : {}),
    };
  }

  /** The signed request the mock would send: also used by tests to send forged or replayed webhooks. */
  signedWebhook(e: CourierWebhookEvent, at: Date = this.now()): { headers: Record<string, string>; body: Buffer } {
    const body = Buffer.from(JSON.stringify({
      eventId: e.eventId, consignmentId: e.consignmentId, status: e.status, occurredAt: e.occurredAt.toISOString(),
      ...(e.returnCharge !== undefined ? { returnCharge: e.returnCharge.toString() } : {}),
    }));
    const ts = String(Math.floor(at.getTime() / 1000));
    return { headers: { 'content-type': 'application/json', [MOCK_HEADERS.timestamp]: ts, [MOCK_HEADERS.signature]: `v1=${this.sign(ts, body)}` }, body };
  }

  // ---------------------------------------------------------------- the simulator (section 7.10)

  /** The latest consignments, newest first, for the simulator page. */
  async recent(limit = 50): Promise<MockConsignment[]> {
    const ids = await this.redis.zrevrange(KEY.recent, 0, limit - 1);
    const found = await Promise.all(ids.map((id) => this.redis.get(KEY.consignment(id))));
    return found.filter((r): r is string => r !== null).map((r) => JSON.parse(r) as MockConsignment);
  }

  /**
   * Moves a parcel: to the status given, or along the happy path (pickup, transit, delivery; a parcel whose return was
   * requested goes back to the seller). Then sends the signed webhook. Refuses a move the provider would not make.
   */
  async advance(consignmentId: string, to?: ShipmentStatus, returnCharge?: bigint): Promise<{ consignment: MockConsignment; event: MockEvent; webhook: unknown }> {
    const { c, e } = await this.locked(consignmentId, async (c) => {
      const next = to ?? (c.returnRequested && MOCK_NEXT[c.status]?.includes('returned_to_seller') ? 'returned_to_seller' : HAPPY[c.status]);
      if (!next || !MOCK_NEXT[c.status]?.includes(next)) throw new MockMoveRefused(c.status, next ?? null);
      if (returnCharge !== undefined && next !== 'returned_to_seller') throw new MockMoveRefused(c.status, next);
      const e = this.push(c, next, next === 'returned_to_seller' ? (returnCharge ?? 0n) : undefined);
      await this.save(c);
      if (MOCK_NEXT[next] && this.autoAdvanceSeconds > 0) await this.redis.zadd(KEY.auto, this.now().getTime() + this.autoAdvanceSeconds * 1000, c.id);
      else await this.redis.zrem(KEY.auto, c.id);
      return { c, e };
    });
    const signed = this.signedWebhook({ eventId: e.id, consignmentId: c.id, status: e.status, occurredAt: new Date(e.at), ...(e.charge !== undefined ? { returnCharge: BigInt(e.charge) } : {}) });
    const webhook = this.sink ? await this.sink(signed.headers, signed.body) : null;
    return { consignment: c, event: e, webhook };
  }

  /** MOCK_COURIER_AUTO_ADVANCE_SECONDS: one step for each parcel that is due; returns how many moved. */
  async advanceDue(): Promise<number> {
    if (this.autoAdvanceSeconds <= 0) return 0;
    const due = await this.redis.zrangebyscore(KEY.auto, 0, this.now().getTime(), 'LIMIT', 0, 50);
    let n = 0;
    for (const id of due) {
      // claimed by one instance: whoever removes it moves it
      if ((await this.redis.zrem(KEY.auto, id)) === 0) continue;
      try {
        await this.advance(id);
        n++;
      } catch (err) {
        if (!(err instanceof MockMoveRefused)) throw err;
      }
    }
    return n;
  }

  // ---------------------------------------------------------------- the record

  private push(c: MockConsignment, status: ShipmentStatus, charge?: bigint): MockEvent {
    const e: MockEvent = { id: `${c.id}-${c.events.length}`, status, at: this.now().toISOString(), ...(charge !== undefined ? { charge: charge.toString() } : {}) };
    c.events.push(e);
    c.status = status;
    return e;
  }

  private sign(ts: string, body: Buffer): string {
    return createHmac('sha256', this.secret).update(`${ts}.`).update(body).digest('hex');
  }

  private async load(id: string): Promise<MockConsignment> {
    const raw = await this.redis.get(KEY.consignment(id));
    if (!raw) throw new MockUnknownConsignment(id);
    return JSON.parse(raw) as MockConsignment;
  }

  private async save(c: MockConsignment): Promise<void> {
    await this.redis.set(KEY.consignment(c.id), JSON.stringify(c), 'EX', TTL_SECONDS);
  }

  /** One change at a time per consignment (several instances, the simulator and the job). */
  private async locked<T>(id: string, fn: (c: MockConsignment) => Promise<T>): Promise<T> {
    for (let i = 0; i < 50; i++) {
      if ((await this.redis.set(KEY.lock(id), '1', 'PX', 5000, 'NX')) === 'OK') {
        try {
          return await fn(await this.load(id));
        } finally {
          await this.redis.del(KEY.lock(id));
        }
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new CourierUnavailableError(`mock courier: consignment ${id} is busy`);
  }
}

export class MockMoveRefused extends Error {
  constructor(readonly from: ShipmentStatus, readonly to: ShipmentStatus | null) {
    super(`the mock courier cannot move a parcel from ${from} to ${to ?? 'a next status'}`);
    this.name = 'MockMoveRefused';
  }
}

export class MockUnknownConsignment extends Error {
  constructor(readonly id: string) {
    super(`no mock consignment ${id}`);
    this.name = 'MockUnknownConsignment';
  }
}

const areaOf = (a: CourierAddress) => `${a.area}, ${a.district}`;
