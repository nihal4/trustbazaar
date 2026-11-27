import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Problem } from '../../../kernel/http/problems';
import { Listing } from '../db/entities';
import type { FulfilmentMethod, ListingsQueries, ListingStatus, ReviewItem, SizeClass, WeightClass } from '../ports';

// ListingsQueries (docs/design/09_integration.pdf section 4; I-61): what other units may read about a listing,
// through this port only (DC-1). threadFacts for Unit 6's chat (U6-02); fulfilmentFacts for Unit 4 (I-23; U3-06).

const METHODS: Record<string, FulfilmentMethod[]> = {
  pickup_only: ['self_pickup'],
  courier_only: ['courier'],
  pickup_or_courier: ['self_pickup', 'courier'],
};

@Injectable()
export class ListingsQueriesService implements ListingsQueries {
  constructor(private readonly db: DataSource) {}

  async fulfilmentFacts(listingId: string): Promise<{
    options: FulfilmentMethod[];
    weightClass: WeightClass | null;
    sizeClass: SizeClass | null;
    district: string;
    approxLat: number;
    approxLng: number;
  }> {
    const l = await this.db.getRepository(Listing).findOne({
      where: { id: listingId },
      select: { itemKind: true, fulfilmentOptions: true, weightClass: true, sizeClass: true, areaDistrict: true, approxLat: true, approxLng: true },
    });
    // a game account changes hands through Unit 5, not by delivery: no fulfilment facts (physical_fields, game_fields)
    if (!l || l.itemKind !== 'physical' || !l.fulfilmentOptions || !l.areaDistrict || l.approxLat === null || l.approxLng === null) {
      throw new Problem('not-found');
    }
    return {
      options: METHODS[l.fulfilmentOptions] ?? [],
      weightClass: l.weightClass,
      sizeClass: l.sizeClass,
      district: l.areaDistrict,
      approxLat: Number(l.approxLat),
      approxLng: Number(l.approxLng),
    };
  }

  async threadFacts(listingId: string): Promise<{ sellerId: string; title: string; status: ListingStatus }> {
    const l = await this.db.getRepository(Listing).findOne({ where: { id: listingId }, select: { sellerId: true, title: true, status: true } });
    if (!l) throw new Problem('not-found');
    return { sellerId: l.sellerId, title: l.title, status: l.status };
  }

  async reviewQueue(limit = 200): Promise<ReviewItem[]> {
    const rows = (await this.db.query(
      `SELECT l.id, l.seller_id, l.title, h.at, h.reason
         FROM listings.listings l
         JOIN LATERAL (SELECT at, reason FROM listings.status_history WHERE listing_id = l.id AND to_status = 'pending_review' ORDER BY at DESC, id DESC LIMIT 1) h ON true
        WHERE l.status = 'pending_review' AND l.item_kind = 'physical'
        ORDER BY h.at, l.id LIMIT $1`,
      [limit],
    )) as { id: string; seller_id: string; title: string; at: Date; reason: string | null }[];
    return rows.map((r) => ({ listingId: r.id, sellerId: r.seller_id, title: r.title, heldAt: r.at, reason: r.reason }));
  }
}
