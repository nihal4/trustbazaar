import { Inject, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { CONFIG_PORT, ConfigPort } from '../../../kernel/config-port';
import { Problem } from '../../../kernel/http/problems';
import { LISTINGS_QUERIES, ListingsQueries, type FulfilmentMethod } from '../../listings/ports';
import type { DeliveryPort } from '../ports';
import { fromDeliveryDb, refusal } from './refusals';
import type { Zone } from './areas.service';

// QuoteService (docs/design/04_delivery.pdf section 5; FR-DLV-01, FR-DLV-02, FR-DLV-08, FR-DLV-09; I-21; U4-02). The
// database decides: listings.distance_km (Unit 3's pure function), delivery.recommended_method, billed_kg, zone_at,
// route_zone, fare and make_quote. Listing facts come only through ListingsQueries (DC-1). A quote is bound to the
// buyer, the listing, the quantity and the buyer's saved drop-off address, valid for DV-23, and claimed once by Unit 2.

/** DV-23 */
export const QUOTE_VALIDITY = '30 minutes';
/** DV-24 */
export const MAX_COURIER_KG = 10;

const OPTIONS_ENUM = (m: FulfilmentMethod[]): string =>
  m.includes('self_pickup') && m.includes('courier') ? 'pickup_or_courier' : m.includes('courier') ? 'courier_only' : 'pickup_only';

export interface FulfilmentOptionsView {
  listingId: string;
  areaId: number;
  quantity: number;
  methods: FulfilmentMethod[];
  /** whole kilometres between the listing's rounded location and the area's centroid (FR-DLV-01) */
  distanceKm: number;
  recommended: FulfilmentMethod;
  /** indicative: computed as a quote would be, not stored (section 5.5, step 1) */
  courier: { available: true; fee: string; billedKg: number; zone: Zone; fareVersion: number } | { available: false; reason: 'courier_not_offered' | 'parcel_too_large' };
}

export interface QuoteView {
  id: string;
  listingId: string;
  quantity: number;
  addressId: string;
  areaId: number;
  zone: Zone;
  billedKg: number;
  distanceKm: number;
  fee: string;
  fareVersion: number;
  expiresAt: string;
}

@Injectable()
export class QuoteService implements DeliveryPort {
  /** Shipments and booking come with U4-04; until then a paid courier order could not ship (Decisions log, U4-02). */
  readonly shipsCourier = false;

  constructor(
    private readonly db: DataSource,
    @Inject(LISTINGS_QUERIES) private readonly listings: ListingsQueries,
    @Inject(CONFIG_PORT) private readonly params: ConfigPort,
  ) {}

  /** GET /listings/{id}/fulfilment-options?areaId=&quantity= */
  async options(buyerId: string, listingId: string, areaId: number, quantity: number): Promise<FulfilmentOptionsView> {
    const facts = await this.facts(buyerId, listingId);
    const threshold = (await this.params.current()).get<number>('CP-14');
    const [r] = (await this.db.query(
      `WITH a AS (SELECT * FROM delivery.areas WHERE id = $1 AND active),
            k AS (SELECT delivery.billed_kg($5::listings.weight_class, $6::listings.size_class, $7, $8) AS kg),
            v AS (SELECT delivery.fare_version_at(now()) AS v)
       SELECT round(listings.distance_km($2, $3, a.lat, a.lng)::numeric, 1)::float AS distance,
              delivery.recommended_method($4::listings.fulfilment_options, listings.distance_km($2, $3, a.lat, a.lng)::numeric, $9) AS recommended,
              k.kg, v.v AS version, delivery.route_zone(delivery.zone_at($10, $2, $3), a.zone) AS zone,
              CASE WHEN k.kg IS NULL OR v.v IS NULL THEN NULL
                   ELSE delivery.fare(v.v, delivery.route_zone(delivery.zone_at($10, $2, $3), a.zone), k.kg)::text END AS fee
         FROM a, k, v`,
      [areaId, facts.approxLat, facts.approxLng, OPTIONS_ENUM(facts.options), facts.weightClass, facts.sizeClass, quantity, MAX_COURIER_KG, threshold, facts.district],
    )) as { distance: number; recommended: FulfilmentMethod; kg: number | null; version: number | null; zone: Zone; fee: string | null }[];
    if (!r) throw new Problem('validation-failed', { errors: [{ field: 'areaId', reason: 'unknown' }] });

    const offered = facts.options.includes('courier');
    const courier: FulfilmentOptionsView['courier'] = !offered
      ? { available: false, reason: 'courier_not_offered' }
      : r.kg === null || r.fee === null
        ? { available: false, reason: 'parcel_too_large' }
        : { available: true, fee: r.fee, billedKg: r.kg, zone: r.zone, fareVersion: r.version! };
    // a courier recommendation that cannot be priced falls back to self pickup where the seller allows it
    const recommended: FulfilmentMethod = r.recommended === 'courier' && !courier.available && facts.options.includes('self_pickup') ? 'self_pickup' : r.recommended;
    return { listingId, areaId, quantity, methods: facts.options, distanceKm: Math.round(r.distance), recommended, courier };
  }

  /** POST /delivery/quotes: a binding quote to the buyer's saved drop-off address (FR-DLV-08). */
  async issue(buyerId: string, q: { listingId: string; quantity: number; addressId: string }): Promise<QuoteView> {
    const [addr] = (await this.db.query(
      `SELECT area_id FROM delivery.saved_addresses WHERE id = $1 AND user_id = $2 AND kind = 'dropoff' AND deleted_at IS NULL`, [q.addressId, buyerId],
    )) as { area_id: number }[];
    if (!addr) throw new Problem('validation-failed', { errors: [{ field: 'addressId', reason: 'not-a-dropoff-address-of-yours' }] });
    const facts = await this.facts(buyerId, q.listingId);
    if (!facts.options.includes('courier')) throw refusal('fulfilment', 'courier_not_offered');
    const [row] = (await this.db.query(
      `SELECT id, listing_id, quantity, dropoff_address_id, to_area_id, zone, billed_kg, distance_km::float AS distance_km, fee::text, fare_version, expires_at
         FROM delivery.make_quote('checkout', $1, $2, $3, $4::listings.fulfilment_options, $5::listings.weight_class, $6::listings.size_class,
                                  $7, $8, $9, $10, $11::interval, $12, $13)`,
      [buyerId, q.listingId, q.quantity, OPTIONS_ENUM(facts.options), facts.weightClass, facts.sizeClass, facts.district, facts.approxLat, facts.approxLng,
       addr.area_id, QUOTE_VALIDITY, MAX_COURIER_KG, q.addressId],
    ).catch(fromDeliveryDb)) as {
      id: string; listing_id: string; quantity: number; dropoff_address_id: string; to_area_id: number; zone: Zone; billed_kg: number; distance_km: number;
      fee: string; fare_version: number; expires_at: Date;
    }[];
    return {
      id: row.id, listingId: row.listing_id, quantity: row.quantity, addressId: row.dropoff_address_id, areaId: row.to_area_id, zone: row.zone,
      billedKg: row.billed_kg, distanceKm: Math.round(row.distance_km), fee: row.fee, fareVersion: row.fare_version, expiresAt: row.expires_at.toISOString(),
    };
  }

  /** DeliveryPort.claimQuote (I-21), inside Unit 2's order transaction (DC-13). */
  async claimQuote(q: { quoteId: string; orderId: string; buyerId: string; listingId: string; quantity: number }, tx: EntityManager): Promise<bigint> {
    const [r] = (await tx.query(
      `SELECT delivery.claim_quote($1, $2, $3, $4, $5)::text AS fee`, [q.quoteId, q.orderId, q.buyerId, q.listingId, q.quantity],
    ).catch(fromDeliveryDb)) as { fee: string }[];
    return BigInt(r.fee);
  }

  /** The listing's facts, if it can be bought now by this buyer: active, not their own, a physical item. */
  private async facts(buyerId: string, listingId: string) {
    const t = await this.listings.threadFacts(listingId);
    if (t.status !== 'active') throw new Problem('not-found');
    if (t.sellerId === buyerId) throw new Problem('forbidden', { errors: [{ field: 'listingId', reason: 'own-listing' }] });
    return this.listings.fulfilmentFacts(listingId); // not-found for a game account
  }
}
