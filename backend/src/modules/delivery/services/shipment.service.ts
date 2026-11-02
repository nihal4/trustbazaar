import { randomUUID } from 'crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { Problem } from '../../../kernel/http/problems';
import { AUDIT_SERVICE, AuditServicePort, IDENTITY_CRYPTO, IdentityCryptoPort } from '../../identity/ports';
import { LISTINGS_QUERIES, ListingsQueries } from '../../listings/ports';
import { COURIER, CourierPort } from '../adapters/courier-port';
import { FULFILMENT_ORDERS, FulfilmentOrders } from '../adapters/orders';
import type { ShipmentStatus } from '../db/enums';
import type { ReturnQuote } from '../ports';
import type { AddressLines } from './address.service';
import { BookingService } from './booking.service';
import { announceNewIssues, publish } from './outbox';
import { MAX_COURIER_KG, QUOTE_VALIDITY } from './quote.service';
import { fromDeliveryDb } from './refusals';
import { openSaved, openShipment, sealForShipment } from './shipment-address';
import { StatusService } from './status.service';

// ShipmentService (docs/design/04_delivery.pdf sections 7.1 to 7.9; FR-DLV-10 to FR-DLV-14; FR-DSP-06(d); U4-04).
// A paid courier order gets its forward shipment, with the claimed quote and fee and copies of both addresses
// (re-encrypted under the shipment), and is booked at once. Each party sees only their own address; the other party
// is a district (FR-DLV-07). A refund before delivery cancels the booking, or asks for a return if the courier has
// the parcel. Return shipments (dispute outcome (d)) are for courier orders only, from the forward shipment's
// addresses swapped (Decisions log, U4-04).

/** DV-32 */
export const SYNC_TIMEOUT_MS = 10_000;
const FINAL: ShipmentStatus[] = ['delivered', 'returned_to_seller', 'cancelled'];

export interface ShipmentView {
  id: string;
  direction: 'forward' | 'return';
  status: ShipmentStatus;
  /** FR-DLV-14, NFR-CMP-05: the client shows "simulated" on every mock shipment */
  simulated: boolean;
  provider: string;
  consignmentId: string | null;
  fee: string;
  /** FR-DLV-05: the item is paid for; the courier collects nothing */
  cashToCollect: '0';
  pickupDueAt: string | null;
  bookedAt: string | null;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  returnedAt: string | null;
  cancelledAt: string | null;
  failedAttempts: number;
  /** the seller of a forward shipment still has to give the pickup address */
  needsPickupAddress: boolean;
  /** the caller's own address on this shipment; null once erased (DV-30) */
  myAddress: (AddressLines & { area: AreaView }) | null;
  /** the other party: their district only (FR-DLV-07) */
  other: { district: string | null };
  history: { from: ShipmentStatus | null; to: ShipmentStatus; at: string }[];
}
interface AreaView { id: number; district: string; nameEn: string; nameBn: string }

interface ShipmentRow {
  id: string; order_id: string; direction: 'forward' | 'return'; provider: string; simulated: boolean; quote_id: string; fee: string; status: ShipmentStatus;
  pickup_due_at: Date | null; consignment_id: string | null; pickup_area_id: number | null; dropoff_area_id: number;
  pickup_address_enc: Buffer | null; dropoff_address_enc: Buffer | null; addresses_erased_at: Date | null;
  booked_at: Date | null; picked_up_at: Date | null; delivered_at: Date | null; returned_at: Date | null; cancelled_at: Date | null;
  failed_attempts: number; order_cancelled_at: Date | null;
}

const iso = (d: Date | null) => d?.toISOString() ?? null;

@Injectable()
export class ShipmentService {
  private readonly log = new Logger('DeliveryShipments');

  constructor(
    private readonly db: DataSource,
    private readonly booking: BookingService,
    private readonly statuses: StatusService,
    @Inject(COURIER) private readonly courier: CourierPort,
    @Inject(FULFILMENT_ORDERS) private readonly orders: FulfilmentOrders,
    @Inject(IDENTITY_CRYPTO) private readonly crypto: IdentityCryptoPort,
    @Inject(LISTINGS_QUERIES) private readonly listings: ListingsQueries,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditServicePort,
  ) {}

  // ---------------------------------------------------------------- created by orders.order.paid (section 7.2)

  /**
   * A paid courier order: the forward shipment in `preparing`, with the claimed quote, its fee and drop-off area, a
   * copy of the buyer's drop-off address, the seller's latest saved pickup address if there is one, and the CP-16
   * pickup deadline. Idempotent (one forward shipment per order). Then the first booking attempt.
   */
  async createForward(o: { orderId: string; sellerId: string; quoteId: string; pickupDueAt: string }): Promise<string | null> {
    const id = randomUUID();
    const created = await this.db.transaction(async (m) => {
      const [q] = (await m.query(
        `SELECT q.fee::text AS fee, q.to_area_id, q.order_id, a.id AS address_id, a.address_enc
           FROM delivery.quotes q LEFT JOIN delivery.saved_addresses a ON a.id = q.dropoff_address_id AND a.deleted_at IS NULL
          WHERE q.id = $1 AND q.purpose = 'checkout'`, [o.quoteId],
      )) as { fee: string; to_area_id: number; order_id: string | null; address_id: string | null; address_enc: Buffer | null }[];
      if (!q || q.order_id !== o.orderId) throw new Error(`order ${o.orderId}: its delivery quote ${o.quoteId} is not claimed by it`);
      if (!q.address_enc) {
        // the buyer deleted the drop-off address after paying: nobody can book, so an operator decides (section 7.11)
        await m.query(`INSERT INTO delivery.issues (order_id, kind, detail) VALUES ($1, 'booking_failed', $2) ON CONFLICT DO NOTHING`,
          [o.orderId, JSON.stringify({ reason: 'dropoff_address_deleted' })]);
        await announceNewIssues(m, o.orderId);
        return false;
      }
      const dropoff = await sealForShipment(this.crypto, id, 'dropoff_address_enc', await openSaved(this.crypto, q.address_id!, q.address_enc));
      const pickup = await this.latestPickupAddress(m, o.sellerId);
      const res = (await m.query(
        `INSERT INTO delivery.shipments (id, order_id, direction, provider, simulated, quote_id, fee, pickup_due_at, dropoff_area_id, dropoff_address_enc,
                                         pickup_area_id, pickup_address_enc, next_booking_at)
         VALUES ($1, $2, 'forward', $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
         ON CONFLICT (order_id, direction) DO NOTHING RETURNING id`,
        [id, o.orderId, this.courier.provider, this.courier.simulated, o.quoteId, q.fee, o.pickupDueAt, q.to_area_id, dropoff,
         pickup?.areaId ?? null, pickup ? await sealForShipment(this.crypto, id, 'pickup_address_enc', pickup.lines) : null],
      )) as { id: string }[];
      if (res.length === 0) return false; // redelivered
      await publish(m, 'delivery.shipment.status_changed', o.orderId, {
        shipment: id, direction: 'forward', status: 'preparing', simulated: this.courier.simulated, at: new Date().toISOString(),
        // section 7.2, step 1: the seller is told to give the pickup address (Unit 6, I-25)
        pickupAddressNeeded: pickup === null, sellerId: o.sellerId, pickupDueAt: o.pickupDueAt,
      });
      return true;
    });
    if (!created) return null;
    await this.booking.book(id);
    return id;
  }

  private async latestPickupAddress(m: EntityManager, sellerId: string): Promise<{ areaId: number; lines: AddressLines } | null> {
    const [a] = (await m.query(
      `SELECT id, area_id, address_enc FROM delivery.saved_addresses WHERE user_id = $1 AND kind = 'pickup' AND deleted_at IS NULL
        ORDER BY created_at DESC, id LIMIT 1`, [sellerId],
    )) as { id: string; area_id: number; address_enc: Buffer }[];
    return a ? { areaId: a.area_id, lines: await openSaved(this.crypto, a.id, a.address_enc) } : null;
  }

  // ---------------------------------------------------------------- the parties (section 3.1)

  /** GET /orders/{id}/shipments: buyer or seller; each sees their own address and the other's district. */
  async view(userId: string, orderId: string): Promise<{ items: ShipmentView[] }> {
    const order = await this.orders.getOrderForParty(orderId, userId); // not-found for anyone else
    const role: 'buyer' | 'seller' = order.buyerId === userId ? 'buyer' : 'seller';
    const rows = (await this.db.query(`SELECT * FROM delivery.shipments WHERE order_id = $1 ORDER BY direction, created_at`, [orderId])) as ShipmentRow[];
    const areaIds = [...new Set(rows.flatMap((r) => [r.pickup_area_id, r.dropoff_area_id]).filter((x): x is number => x !== null))];
    const areas = (await this.db.query(`SELECT id, district, name_en, name_bn FROM delivery.areas WHERE id = ANY($1::int[])`, [areaIds])) as {
      id: number; district: string; name_en: string; name_bn: string;
    }[];
    const area = (id: number | null): AreaView | null => {
      const a = areas.find((x) => x.id === id);
      return a ? { id: a.id, district: a.district, nameEn: a.name_en, nameBn: a.name_bn } : null;
    };
    const items = await Promise.all(rows.map(async (r): Promise<ShipmentView> => {
      // forward: the seller sends from the pickup address, the buyer receives at the drop-off; a return is the reverse
      const mine: 'pickup' | 'dropoff' = (role === 'seller') === (r.direction === 'forward') ? 'pickup' : 'dropoff';
      const sealed = mine === 'pickup' ? r.pickup_address_enc : r.dropoff_address_enc;
      const myArea = area(mine === 'pickup' ? r.pickup_area_id : r.dropoff_area_id);
      const lines = sealed ? await openShipment(this.crypto, r.id, mine === 'pickup' ? 'pickup_address_enc' : 'dropoff_address_enc', sealed) : null;
      const history = (await this.db.query(
        `SELECT from_status, to_status, at FROM delivery.shipment_history WHERE shipment_id = $1 ORDER BY id`, [r.id],
      )) as { from_status: ShipmentStatus | null; to_status: ShipmentStatus; at: Date }[];
      return {
        id: r.id, direction: r.direction, status: r.status, simulated: r.simulated, provider: r.provider, consignmentId: r.consignment_id, fee: r.fee,
        cashToCollect: '0', pickupDueAt: iso(r.pickup_due_at), bookedAt: iso(r.booked_at), pickedUpAt: iso(r.picked_up_at), deliveredAt: iso(r.delivered_at),
        returnedAt: iso(r.returned_at), cancelledAt: iso(r.cancelled_at), failedAttempts: r.failed_attempts,
        needsPickupAddress: role === 'seller' && r.direction === 'forward' && r.status === 'preparing' && r.pickup_address_enc === null && !r.order_cancelled_at,
        myAddress: lines && myArea ? { ...lines, area: myArea } : null,
        other: { district: area(mine === 'pickup' ? r.dropoff_area_id : r.pickup_area_id)?.district ?? null },
        history: history.map((h) => ({ from: h.from_status, to: h.to_status, at: h.at.toISOString() })),
      };
    }));
    return { items };
  }

  /** PUT /orders/{id}/shipment/pickup-address: the seller's saved pickup address, while the shipment is preparing. */
  async setPickupAddress(userId: string, orderId: string, addressId: string): Promise<{ items: ShipmentView[] }> {
    const order = await this.orders.getOrderForParty(orderId, userId);
    if (order.sellerId !== userId) throw new Problem('forbidden', { errors: [{ field: 'order', reason: 'seller-only' }] });
    const id = await this.db.transaction(async (m) => {
      const [s] = (await m.query(
        `SELECT id, status, order_cancelled_at FROM delivery.shipments WHERE order_id = $1 AND direction = 'forward' FOR UPDATE`, [orderId],
      )) as { id: string; status: ShipmentStatus; order_cancelled_at: Date | null }[];
      if (!s) throw new Problem('not-found');
      if (s.status !== 'preparing' || s.order_cancelled_at) throw new Problem('order-state', { errors: [{ field: 'shipment', reason: 'already-booked-or-closed' }] });
      const [a] = (await m.query(
        `SELECT id, area_id, address_enc FROM delivery.saved_addresses WHERE id = $1 AND user_id = $2 AND kind = 'pickup' AND deleted_at IS NULL`, [addressId, userId],
      )) as { id: string; area_id: number; address_enc: Buffer }[];
      if (!a) throw new Problem('validation-failed', { errors: [{ field: 'addressId', reason: 'not-a-pickup-address-of-yours' }] });
      const sealed = await sealForShipment(this.crypto, s.id, 'pickup_address_enc', await openSaved(this.crypto, a.id, a.address_enc));
      await m.query(
        `UPDATE delivery.shipments SET pickup_area_id = $2, pickup_address_enc = $3, booking_attempts = 0, next_booking_at = now() WHERE id = $1`,
        [s.id, a.area_id, sealed],
      );
      return s.id;
    });
    await this.booking.book(id);
    return this.view(userId, orderId);
  }

  // ---------------------------------------------------------------- cancellation (section 7.6)

  /**
   * orders.escrow.refunded before the delivery event (FR-PAY-09, a missed deadline): a preparing shipment is
   * cancelled; a booked one is cancelled with the courier; a parcel the courier already has is sent back. A
   * shipment that is final (delivered, returned, cancelled) is left alone. Redelivery is harmless.
   */
  async cancelForRefund(orderId: string): Promise<void> {
    const s = await this.db.transaction(async (m) => {
      const [s] = (await m.query(
        `SELECT id, status, consignment_id, simulated FROM delivery.shipments WHERE order_id = $1 AND direction = 'forward' FOR UPDATE`, [orderId],
      )) as { id: string; status: ShipmentStatus; consignment_id: string | null; simulated: boolean }[];
      if (!s || FINAL.includes(s.status)) return null;
      await m.query(`UPDATE delivery.shipments SET order_cancelled_at = coalesce(order_cancelled_at, now()) WHERE id = $1`, [s.id]);
      if (s.status === 'preparing') {
        // never booked, so the courier never had the addresses: they are erased with the cancellation (shipment_addresses
        // allows a cancelled shipment without a pickup address only once erased; Decisions log, U4-04)
        await m.query(
          `UPDATE delivery.shipments SET status = 'cancelled', cancelled_at = now(), last_source = 'system', last_event_id = NULL,
                  pickup_address_enc = NULL, dropoff_address_enc = NULL, addresses_erased_at = now() WHERE id = $1`, [s.id],
        );
        await publish(m, 'delivery.shipment.status_changed', orderId, { shipment: s.id, direction: 'forward', status: 'cancelled', simulated: s.simulated, at: new Date().toISOString() });
        return null;
      }
      return s;
    });
    if (!s?.consignment_id) return;
    // the courier is called after the commit; a failure throws, so the event is delivered again later
    if (s.status === 'booked' && (await this.courier.cancel(s.consignment_id)) === 'cancelled') {
      await this.statuses.query(s.id, s.consignment_id);
      return;
    }
    // the courier has the parcel: record what it reports (a pickup now opens pickup_after_cancel) and ask for it back
    await this.statuses.query(s.id, s.consignment_id);
    await this.courier.requestReturn(s.consignment_id);
  }

  // ---------------------------------------------------------------- syncPickup (section 7.5; I-22)

  /** DeliveryPort.syncPickup: asks the courier once, within DV-32, and applies the answer. Never throws. */
  async syncPickup(orderId: string): Promise<void> {
    try {
      const [s] = (await this.db.query(
        `SELECT id, consignment_id FROM delivery.shipments WHERE order_id = $1 AND direction = 'forward' AND status = 'booked'`, [orderId],
      )) as { id: string; consignment_id: string }[];
      if (!s) return;
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`no answer within ${SYNC_TIMEOUT_MS} ms`)), SYNC_TIMEOUT_MS);
      });
      try {
        const report = await Promise.race([this.courier.status(s.consignment_id), timeout]);
        if (report.status !== 'booked') await this.statuses.apply(s.id, report, 'provider_query');
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      this.log.warn(`syncPickup for order ${orderId}: ${(err as Error).message}; the deadline refund goes ahead`);
    }
  }

  // ---------------------------------------------------------------- returns (section 7.9; FR-DSP-06(d))

  /** DeliveryCommands.quoteReturn: courier orders only, from the forward shipment's drop-off area to its pickup area. */
  async quoteReturn(orderId: string, fromAreaId: number, toAreaId: number): Promise<ReturnQuote> {
    const f = await this.forwardForReturn(this.db.manager, orderId);
    if (fromAreaId !== f.dropoff_area_id || toAreaId !== f.pickup_area_id) {
      throw new Problem('validation-failed', { errors: [{ field: 'areas', reason: 'must-be-the-forward-shipment-areas-swapped' }] });
    }
    const facts = await this.listings.fulfilmentFacts(f.listing_id);
    const [from] = (await this.db.query(`SELECT district, lat, lng FROM delivery.areas WHERE id = $1`, [fromAreaId])) as { district: string; lat: string; lng: string }[];
    const [q] = (await this.db.query(
      `SELECT id, to_area_id, billed_kg, fee::text, fare_version, expires_at
         FROM delivery.make_quote('return', $1, $2, $3, 'pickup_or_courier'::listings.fulfilment_options, $4::listings.weight_class, $5::listings.size_class,
                                  $6, $7, $8, $9, $10::interval, $11)`,
      [f.buyer_id, f.listing_id, f.quantity, facts.weightClass, facts.sizeClass, from.district, from.lat, from.lng, toAreaId, QUOTE_VALIDITY, MAX_COURIER_KG],
    ).catch(fromDeliveryDb)) as { id: string; to_area_id: number; billed_kg: number; fee: string; fare_version: number; expires_at: Date }[];
    return { id: q.id, orderId, fromAreaId, toAreaId: q.to_area_id, billedKg: q.billed_kg, fee: q.fee, fareVersion: q.fare_version, expiresAt: q.expires_at.toISOString() };
  }

  /** DeliveryCommands.bookReturn: claims the quote and creates the return shipment in the caller's transaction. */
  async bookReturn(orderId: string, quoteId: string, payer: 'buyer' | 'seller', tx: EntityManager): Promise<string> {
    if (payer !== 'buyer' && payer !== 'seller') throw new Problem('validation-failed', { errors: [{ field: 'payer', reason: 'buyer-or-seller' }] });
    const f = await this.forwardForReturn(tx, orderId);
    const fee = (await tx.query(
      `SELECT delivery.claim_quote($1, $2, $3, $4, $5, 'return')::text AS fee`, [quoteId, orderId, f.buyer_id, f.listing_id, f.quantity],
    ).catch(fromDeliveryDb)) as { fee: string }[];
    const [q] = (await tx.query(`SELECT to_area_id FROM delivery.quotes WHERE id = $1`, [quoteId])) as { to_area_id: number }[];
    const id = randomUUID();
    // the buyer sends from where the item was delivered, to where the seller sent it from
    const buyerLines = await openShipment(this.crypto, f.id, 'dropoff_address_enc', f.dropoff_address_enc!);
    const sellerLines = await openShipment(this.crypto, f.id, 'pickup_address_enc', f.pickup_address_enc!);
    await tx.query(
      `INSERT INTO delivery.shipments (id, order_id, direction, provider, simulated, quote_id, fee, pickup_area_id, pickup_address_enc,
                                       dropoff_area_id, dropoff_address_enc, next_booking_at)
       VALUES ($1, $2, 'return', $3, $4, $5, $6, $7, $8, $9, $10, now())`,
      [id, orderId, this.courier.provider, this.courier.simulated, quoteId, fee[0].fee, f.dropoff_area_id,
       await sealForShipment(this.crypto, id, 'pickup_address_enc', buyerLines), q.to_area_id,
       await sealForShipment(this.crypto, id, 'dropoff_address_enc', sellerLines)],
    ).catch(fromDeliveryDb);
    await publish(tx, 'delivery.shipment.status_changed', orderId, {
      shipment: id, direction: 'return', status: 'preparing', simulated: this.courier.simulated, payer, at: new Date().toISOString(),
    });
    return id;
  }

  /** POST /orders/{id}/return/received: the seller confirms the returned item arrived; Unit 7 then completes the refund. */
  async returnReceived(userId: string, orderId: string): Promise<{ status: 'received'; at: string }> {
    const order = await this.orders.getOrderForParty(orderId, userId);
    if (order.sellerId !== userId) throw new Problem('forbidden', { errors: [{ field: 'order', reason: 'seller-only' }] });
    return this.db.transaction(async (m) => {
      const [s] = (await m.query(
        `SELECT id, status, simulated FROM delivery.shipments WHERE order_id = $1 AND direction = 'return' FOR UPDATE`, [orderId],
      )) as { id: string; status: ShipmentStatus; simulated: boolean }[];
      if (!s) throw new Problem('not-found');
      if (s.status === 'cancelled') throw new Problem('order-state', { errors: [{ field: 'shipment', reason: 'return-cancelled' }] });
      const [done] = (await m.query(
        `SELECT created_at FROM delivery.outbox WHERE aggregate_id = $1 AND event_type = 'delivery.return.delivered' ORDER BY id LIMIT 1`, [orderId],
      )) as { created_at: Date }[];
      if (done) return { status: 'received' as const, at: done.created_at.toISOString() }; // already known: once only
      const [{ at }] = (await m.query(`SELECT now() AS at`)) as { at: Date }[]; // the outbox row's created_at: the same answer on a repeat
      await publish(m, 'delivery.return.delivered', orderId, {
        shipment: s.id, direction: 'return', status: 'received_by_seller', confirmedBy: 'seller', simulated: s.simulated, at: at.toISOString(),
      });
      await this.audit.record({ actorType: 'user', actorId: userId, action: 'delivery.return.received', objectType: 'order', objectId: orderId, after: { shipment: s.id } }, m);
      return { status: 'received' as const, at: at.toISOString() };
    });
  }

  private async forwardForReturn(m: EntityManager, orderId: string) {
    const [f] = (await m.query(
      `SELECT s.id, s.status, s.pickup_area_id, s.dropoff_area_id, s.pickup_address_enc, s.dropoff_address_enc, q.buyer_id, q.listing_id, q.quantity
         FROM delivery.shipments s JOIN delivery.quotes q ON q.id = s.quote_id WHERE s.order_id = $1 AND s.direction = 'forward'`, [orderId],
    )) as { id: string; status: ShipmentStatus; pickup_area_id: number | null; dropoff_area_id: number; pickup_address_enc: Buffer | null;
            dropoff_address_enc: Buffer | null; buyer_id: string; listing_id: string; quantity: number }[];
    // a meetup order is returned by meetup, arranged by Unit 7 (Decisions log, U4-04)
    if (!f) throw new Problem('validation-failed', { errors: [{ field: 'order', reason: 'return-needs-a-courier-order' }] });
    if (f.status !== 'delivered' || !f.pickup_address_enc || !f.dropoff_address_enc || f.pickup_area_id === null) {
      throw new Problem('order-state', { errors: [{ field: 'shipment', reason: 'not-delivered-or-addresses-erased' }] });
    }
    return f;
  }
}
