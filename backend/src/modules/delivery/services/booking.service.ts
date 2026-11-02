import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { IDENTITY_CRYPTO, IDENTITY_QUERY, IdentityCryptoPort, IdentityQuery } from '../../identity/ports';
import { LISTINGS_QUERIES, ListingsQueries } from '../../listings/ports';
import { COURIER, CourierAddress, CourierPort, type SizeClass } from '../adapters/courier-port';
import { FULFILMENT_ORDERS, FulfilmentOrders } from '../adapters/orders';
import { CourierBreaker } from './courier-breaker';
import { announceNewIssues, publish } from './outbox';
import { openShipment } from './shipment-address';

// BookingWorker (docs/design/04_delivery.pdf section 7.2; SEC-PAY-07; NFR-REL-04; U4-04). A shipment in `preparing`
// with both addresses is booked with the courier, the shipment id as the merchant reference and no cash to collect.
// The call is made outside any transaction; the booking is stored only if the shipment is still preparing, so a
// booking that races a cancellation or another instance changes nothing twice. A failure is retried with DV-29's
// backoff; after the last attempt an operator issue is opened (booking_failed, or return_failed for a return).

/** DV-29: from 1 minute, doubling to at most 1 hour; 8 attempts. */
export const DV_29 = { firstMs: 60_000, maxMs: 3_600_000, attempts: 8 } as const;
/** How long the job's claim on a due shipment lasts before another instance may try it. */
const CLAIM = '5 minutes';
const BATCH = 50;

export type BookingOutcome = 'booked' | 'waiting_for_pickup_address' | 'retry' | 'gave_up' | 'not_due';

/** The wait before the next attempt (with jitter, never above the maximum). */
export function backoffMs(attempts: number, random: number = Math.random()): number {
  const base = Math.min(DV_29.firstMs * 2 ** Math.max(0, attempts - 1), DV_29.maxMs);
  return Math.min(Math.round(base * (0.75 + random * 0.5)), DV_29.maxMs);
}

interface Row {
  id: string; order_id: string; direction: 'forward' | 'return'; status: string; order_cancelled_at: Date | null; booking_attempts: number;
  pickup_address_enc: Buffer | null; dropoff_address_enc: Buffer | null; pickup_area_id: number | null; dropoff_area_id: number;
  billed_kg: number; listing_id: string; buyer_id: string; consignment_id: string | null;
}

@Injectable()
export class BookingService {
  private readonly log = new Logger('DeliveryBooking');

  constructor(
    private readonly db: DataSource,
    private readonly breaker: CourierBreaker,
    @Inject(COURIER) private readonly courier: CourierPort,
    @Inject(FULFILMENT_ORDERS) private readonly orders: FulfilmentOrders,
    @Inject(IDENTITY_CRYPTO) private readonly crypto: IdentityCryptoPort,
    @Inject(IDENTITY_QUERY) private readonly identity: IdentityQuery,
    @Inject(LISTINGS_QUERIES) private readonly listings: ListingsQueries,
  ) {}

  /** The booking job (every minute): each due shipment is claimed by one instance (SKIP LOCKED), then booked. */
  async bookDue(): Promise<number> {
    let n = 0;
    for (let i = 0; i < BATCH; i++) {
      const [claimed] = (await this.db.query(
        `UPDATE delivery.shipments SET next_booking_at = now() + $1::interval
          WHERE id = (SELECT id FROM delivery.shipments
                       WHERE status = 'preparing' AND next_booking_at <= now() AND pickup_address_enc IS NOT NULL AND order_cancelled_at IS NULL
                       ORDER BY next_booking_at LIMIT 1 FOR UPDATE SKIP LOCKED)
          RETURNING id`, [CLAIM],
      ).then((r: unknown[]) => (Array.isArray(r[0]) ? r[0] : r))) as { id: string }[];
      if (!claimed) break;
      if ((await this.book(claimed.id)) === 'booked') n++;
    }
    return n;
  }

  /** Books one shipment now, if it is still preparing and has both addresses. Never throws for a courier failure. */
  async book(shipmentId: string): Promise<BookingOutcome> {
    const [s] = (await this.db.query(
      `SELECT s.id, s.order_id, s.direction, s.status, s.order_cancelled_at, s.booking_attempts, s.pickup_address_enc, s.dropoff_address_enc,
              s.pickup_area_id, s.dropoff_area_id, s.consignment_id, q.billed_kg, q.listing_id, q.buyer_id
         FROM delivery.shipments s JOIN delivery.quotes q ON q.id = s.quote_id WHERE s.id = $1`, [shipmentId],
    )) as Row[];
    if (!s || s.status !== 'preparing' || s.order_cancelled_at) return 'not_due';
    if (!s.pickup_address_enc || !s.dropoff_address_enc || s.pickup_area_id === null) return 'waiting_for_pickup_address';

    let consignmentId: string;
    try {
      const request = await this.request(s);
      consignmentId = (await this.courier.book(request)).consignmentId;
    } catch (err) {
      this.log.warn(`booking shipment ${s.id} failed: ${(err as Error).message}`);
      await this.breaker.failure();
      return this.failed(s);
    }
    await this.breaker.success();

    const stored = await this.db.transaction(async (m) => {
      const res = (await m.query(
        `UPDATE delivery.shipments SET status = 'booked', consignment_id = $2, booked_at = now(), last_source = 'system', last_event_id = NULL, next_booking_at = NULL
          WHERE id = $1 AND status = 'preparing' AND order_cancelled_at IS NULL RETURNING simulated`, [s.id, consignmentId],
      )) as unknown[];
      const rows = (Array.isArray(res[0]) ? res[0] : res) as { simulated: boolean }[];
      if (rows.length === 0) return false;
      await publish(m, 'delivery.shipment.status_changed', s.order_id, {
        shipment: s.id, direction: s.direction, status: 'booked', simulated: rows[0].simulated, at: new Date().toISOString(),
      });
      return true;
    });
    if (stored) return 'booked';
    // another instance stored this same consignment (the reference is the shipment id), or the order was cancelled meanwhile
    const [now] = (await this.db.query(`SELECT status, consignment_id, order_cancelled_at FROM delivery.shipments WHERE id = $1`, [s.id])) as {
      status: string; consignment_id: string | null; order_cancelled_at: Date | null;
    }[];
    if (now.consignment_id === consignmentId) return 'booked';
    if (now.order_cancelled_at || now.status === 'cancelled') {
      await this.courier.cancel(consignmentId).catch((err: Error) => this.log.warn(`cancelling consignment ${consignmentId} of a cancelled shipment failed: ${err.message}`));
    }
    return 'not_due';
  }

  /** What the courier receives (FR-PRV-01): both addresses and the parties' verified mobile numbers, nothing else. */
  private async request(s: Row): Promise<Parameters<CourierPort['book']>[0]> {
    const facts = await this.orders.getOrderForParty(s.order_id, s.buyer_id);
    const [pickupParty, dropoffParty] = s.direction === 'forward' ? [facts.sellerId, facts.buyerId] : [facts.buyerId, facts.sellerId];
    const areas = (await this.db.query(`SELECT id, district, name_en FROM delivery.areas WHERE id = ANY($1::int[])`, [[s.pickup_area_id, s.dropoff_area_id]])) as {
      id: number; district: string; name_en: string;
    }[];
    const area = (id: number | null) => areas.find((a) => a.id === id)!;
    const address = async (party: string, column: 'pickup_address_enc' | 'dropoff_address_enc', areaId: number | null): Promise<CourierAddress> => {
      const lines = await openShipment(this.crypto, s.id, column, (column === 'pickup_address_enc' ? s.pickup_address_enc : s.dropoff_address_enc)!);
      return { ...lines, phone: await this.identity.getVerifiedPhone(party), district: area(areaId).district, area: area(areaId).name_en };
    };
    const sizeClass = ((await this.listings.fulfilmentFacts(s.listing_id)).sizeClass ?? 'small') as SizeClass;
    return {
      shipmentId: s.id,
      pickup: await address(pickupParty, 'pickup_address_enc', s.pickup_area_id),
      dropoff: await address(dropoffParty, 'dropoff_address_enc', s.dropoff_area_id),
      parcel: { billedKg: s.billed_kg, sizeClass },
      cashToCollect: 0,
    };
  }

  private async failed(s: Row): Promise<BookingOutcome> {
    const attempts = s.booking_attempts + 1;
    return this.db.transaction(async (m) => {
      if (attempts >= DV_29.attempts) {
        await m.query(`UPDATE delivery.shipments SET booking_attempts = $2, next_booking_at = NULL WHERE id = $1 AND status = 'preparing'`, [s.id, attempts]);
        await m.query(
          `INSERT INTO delivery.issues (order_id, kind, detail) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [s.order_id, s.direction === 'forward' ? 'booking_failed' : 'return_failed', JSON.stringify({ shipment: s.id, attempts })],
        );
        await announceNewIssues(m, s.order_id);
        return 'gave_up';
      }
      await m.query(
        `UPDATE delivery.shipments SET booking_attempts = $2, next_booking_at = now() + $3 * interval '1 millisecond' WHERE id = $1 AND status = 'preparing'`,
        [s.id, attempts, backoffMs(attempts)],
      );
      return 'retry';
    });
  }
}
