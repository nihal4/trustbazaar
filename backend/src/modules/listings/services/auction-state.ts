import type { EntityManager } from 'typeorm';
import type { AuctionState } from '../ports';

// The public state of one auction (docs/design/03_listings_auctions.pdf section 3.2): what GET /auctions/{id}/state,
// the listing page, a bid's answer and the live auction.state message carry. It never holds a maximum, the
// reserve amount or an identity (FR-AUC-08, SEC-WEB-05): the leader is the per-auction alias. seq is the
// auction's version, so clients drop a message not newer than the one they applied (FR-AUC-11). The minimum
// next bid comes from auctions.increment, the same function place_bid uses (CP-08).
export async function readAuctionState(q: Pick<EntityManager, 'query'>, auctionId: string): Promise<AuctionState | null> {
  const [r] = (await q.query(
    `SELECT a.listing_id, a.status, a.start_price::text, a.current_price::text, a.bid_count, a.end_at, a.version::text,
            a.reserve_price IS NOT NULL AS has_reserve,
            (a.reserve_price IS NULL OR coalesce(a.current_price, 0) >= a.reserve_price) AS reserve_met,
            ba.alias_no AS leader_alias,
            CASE WHEN a.current_price IS NULL THEN a.start_price
                 ELSE a.current_price + auctions.increment(a.current_price, a.inc_bps, a.inc_min) END::text AS minimum_bid,
            clock_timestamp() AS server_time
       FROM auctions.auctions a
       LEFT JOIN auctions.bidder_aliases ba ON ba.auction_id = a.listing_id AND ba.bidder_id = a.leader_id
      WHERE a.listing_id = $1`,
    [auctionId],
  )) as {
    listing_id: string; status: AuctionState['status']; start_price: string; current_price: string | null; bid_count: number;
    end_at: Date; version: string; has_reserve: boolean; reserve_met: boolean; leader_alias: number | null; minimum_bid: string; server_time: Date;
  }[];
  if (!r) return null;
  return {
    auctionId: r.listing_id,
    status: r.status,
    startPrice: r.start_price,
    price: r.current_price,
    bidCount: r.bid_count,
    leaderAlias: r.leader_alias,
    endAt: r.end_at.toISOString(),
    hasReserve: r.has_reserve,
    reserveMet: r.reserve_met,
    minimumBid: r.status === 'open' ? r.minimum_bid : null,
    serverTime: r.server_time.toISOString(),
    seq: Number(r.version),
  };
}
