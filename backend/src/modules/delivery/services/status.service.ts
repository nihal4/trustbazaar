import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CLOCK, Clock } from '../../../kernel/clock';
import { CONFIG_PORT, ConfigPort } from '../../../kernel/config-port';
import { Problem } from '../../../kernel/http/problems';
import { COURIER, CourierPort, CourierSignatureError, type CourierStatusReport } from '../adapters/courier-port';
import { FULFILMENT_ORDERS, FulfilmentOrders } from '../adapters/orders';
import type { ShipmentStatus, StatusSource } from '../db/enums';
import { announceNewIssues } from './outbox';

// StatusIngestor (docs/design/04_delivery.pdf section 7.4; FR-DLV-10 to FR-DLV-12; SEC-PAY-03, SEC-PAY-04; U4-04).
// Reports come by webhook, by a status query (syncPickup, cancellation, and U4-05's reconciliation) and can arrive
// twice, late or out of order. delivery.apply_status decides (duplicate, stale, implied pickup, refused); this
// service authenticates, confirms the money-moving statuses by a query, and acts on the result in one transaction
// that locks the order first (DC-14).

export interface ApplyResult {
  outcome: 'applied' | 'duplicate' | 'stale' | 'refused';
  pickup_recorded: boolean;
  pickup_on_time: boolean;
  delivered: boolean;
  returned: boolean;
  after_cancel: boolean;
}

/** delivered and returned_to_seller move money: a webhook reporting them is only a hint (section 7.4, step 2). */
const MONEY_MOVING: ShipmentStatus[] = ['delivered', 'returned_to_seller'];

@Injectable()
export class StatusService {
  private readonly log = new Logger('DeliveryStatus');

  constructor(
    private readonly db: DataSource,
    @Inject(COURIER) private readonly courier: CourierPort,
    @Inject(FULFILMENT_ORDERS) private readonly orders: FulfilmentOrders,
    @Inject(CONFIG_PORT) private readonly params: ConfigPort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** POST /webhooks/courier/{provider}: verified, then applied (or confirmed by a query first). */
  async webhook(provider: string, headers: Record<string, string | string[] | undefined>, rawBody: Buffer): Promise<{ received: true; outcome: string }> {
    if (provider !== this.courier.provider) throw new Problem('not-found');
    const tolerance = (await this.params.current()).ms('CP-32', 'tolerance') / 1000;
    let event;
    try {
      event = this.courier.verifyWebhook(headers, rawBody, this.clock.now(), tolerance);
    } catch (err) {
      if (err instanceof CourierSignatureError || err instanceof SyntaxError) {
        throw new Problem('validation-failed', { errors: [{ field: 'signature', reason: 'invalid' }] });
      }
      throw err;
    }
    const [s] = (await this.db.query(
      `SELECT id FROM delivery.shipments WHERE provider = $1 AND consignment_id = $2`, [this.courier.provider, event.consignmentId],
    )) as { id: string }[];
    if (!s) {
      this.log.warn(`courier webhook for an unknown consignment ${event.consignmentId}: ignored`);
      return { received: true, outcome: 'unknown_consignment' };
    }
    if (MONEY_MOVING.includes(event.status)) {
      const confirmed = await this.courier.status(event.consignmentId);
      return { received: true, outcome: (await this.apply(s.id, confirmed, 'provider_query')).outcome };
    }
    return { received: true, outcome: (await this.apply(s.id, event, 'provider_webhook')).outcome };
  }

  /** Asks the courier and applies the answer (a status query: money-moving statuses are accepted from it). */
  async query(shipmentId: string, consignmentId: string): Promise<ApplyResult> {
    return this.apply(shipmentId, await this.courier.status(consignmentId), 'provider_query');
  }

  /**
   * Section 7.4, steps 3 and 4, in one transaction: the order first (DC-14), then delivery.apply_status (which locks
   * the shipment and records the event id), then the escrow calls its flags ask for.
   */
  async apply(shipmentId: string, r: CourierStatusReport, source: StatusSource): Promise<ApplyResult> {
    return this.db.transaction(async (m) => {
      const [s] = (await m.query(`SELECT order_id, direction FROM delivery.shipments WHERE id = $1`, [shipmentId])) as { order_id: string; direction: 'forward' | 'return' }[];
      if (!s) throw new Problem('not-found');
      await this.orders.lockForFulfilment(s.order_id, m);
      const [res] = (await m.query(
        `SELECT * FROM delivery.apply_status($1, $2::delivery.shipment_status, $3, $4::delivery.status_source, $5, $6)`,
        [shipmentId, r.status, r.occurredAt, source, r.eventId, r.returnCharge?.toString() ?? null],
      )) as ApplyResult[];
      if (res.outcome === 'applied') {
        const [after] = (await m.query(
          `SELECT picked_up_at, delivered_at, return_charge FROM delivery.shipments WHERE id = $1`, [shipmentId],
        )) as { picked_up_at: Date | null; delivered_at: Date | null; return_charge: string | null }[];
        const charge = BigInt(after.return_charge ?? '0');
        if (s.direction === 'forward') {
          // FR-PAY-08: the step only for a pickup by the deadline; a late or after-cancel pickup is recorded but not counted
          if (res.pickup_recorded && res.pickup_on_time && !res.after_cancel) await this.orders.recordFulfilmentStep(s.order_id, 'courier_pickup', after.picked_up_at!, m);
          // FR-DLV-10: the query-confirmed delivery is the delivery event
          if (res.delivered && !res.after_cancel) await this.orders.recordDeliveryEvent(s.order_id, 'courier_delivered', after.delivered_at!, m);
          if (res.returned) {
            // FR-DLV-12: the buyer gets everything back; after a cancellation the refund is made, so only the charge is booked (I-21)
            if (res.after_cancel) await this.orders.recordCourierCost(s.order_id, charge, m);
            else await this.orders.refundCourierReturned(s.order_id, charge, m);
          }
        } else if (res.returned) {
          // a return shipment the courier could not deliver to the seller: an operator arranges it (section 7.11)
          await m.query(
            `INSERT INTO delivery.issues (order_id, kind, detail) VALUES ($1, 'return_failed', $2) ON CONFLICT DO NOTHING`,
            [s.order_id, JSON.stringify({ shipment: shipmentId, returnCharge: charge.toString() })],
          );
        }
      }
      await announceNewIssues(m, s.order_id);
      return res;
    });
  }
}
