import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { collectRows, DataExportSource } from '../../../kernel/privacy/data-export';

// Unit 3's part of the data export (FR-PRV-03; U7-11): the user's listings with their clarifications, photos (their
// details, not the files) and status history, and as a bidder their bids, second-chance offers, strikes and bidding
// restrictions. Staff ids are left out.
const Q = {
  listings: `SELECT to_jsonb(l) AS r FROM listings.listings l WHERE seller_id = $1 ORDER BY created_at, id`,
  clarifications: `SELECT to_jsonb(c) AS r FROM listings.clarifications c JOIN listings.listings l ON l.id = c.listing_id WHERE l.seller_id = $1 ORDER BY c.created_at, c.id`,
  photos: `SELECT to_jsonb(p) - 'storage_key' AS r FROM listings.listing_photos p JOIN listings.listings l ON l.id = p.listing_id WHERE l.seller_id = $1 ORDER BY p.listing_id, p.position`,
  listingHistory: `SELECT to_jsonb(h) - 'actor_id' AS r FROM listings.status_history h JOIN listings.listings l ON l.id = h.listing_id WHERE l.seller_id = $1 ORDER BY h.at, h.id`,
  bids: `SELECT to_jsonb(b) - '{bidder_id,voided_by}'::text[] AS r FROM auctions.bids b WHERE bidder_id = $1 ORDER BY received_at, id`,
  secondChanceOffers: `SELECT to_jsonb(o) - 'bidder_id' AS r FROM auctions.second_chance_offers o WHERE bidder_id = $1 ORDER BY offered_at, id`,
  auctionStrikes: `SELECT to_jsonb(s) - 'user_id' AS r FROM auctions.strikes s WHERE user_id = $1 ORDER BY at, id`,
  biddingRestrictions: `SELECT to_jsonb(b) - 'user_id' AS r FROM auctions.bidding_restrictions b WHERE user_id = $1`,
};

@Injectable()
export class ListingsDataExport implements DataExportSource {
  readonly section = 'listings';
  constructor(private readonly db: DataSource) {}
  exportFor(userId: string) {
    return collectRows(this.db, Q, userId);
  }
}
