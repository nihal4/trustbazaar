import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { LIVE, LivePort } from '../../../kernel/live/live';
import { AUDIT_SERVICE, AuditServicePort } from '../../identity/ports';
import { AUCTION_ORDERS, AuctionOrders } from '../adapters/orders';
import { ListingStatusChange } from '../db/entities';
import { publish } from './outbox';

// AuctionCloser (docs/design/03_listings_auctions.pdf section 5.6; FR-AUC-09, FR-AUC-14, NFR-REL-03; U3-05).
// Every instance runs it: each due auction is claimed with SKIP LOCKED and closed in one transaction, in which
// auctions.close_if_due re-decides under the lock (a repeat changes nothing), the winner's order is created through
// Unit 2's port (DC-13: an award without its order cannot commit), and the events and audit entry are written.
// Auctions whose listing is not active (held for review) are left alone (Decisions log, U3-02).

/** DV-17: the close waits this long after end_at, longer than a bid's lock wait (DV-18, 1 s). */
export const CLOSE_GRACE = '2 seconds';
const BATCH = 100;

export type Closed = { auctionId: string; status: 'sold' | 'unsold'; price: string | null };

/** listing active -> ended_unsold, with its history row and event (FR-AUC-09, FR-AUC-15). */
export async function endUnsold(m: EntityManager, listingId: string, reason: string): Promise<void> {
  const [l] = (await m.query(`SELECT seller_id, item_kind, status FROM listings.listings WHERE id = $1 FOR UPDATE`, [listingId])) as {
    seller_id: string; item_kind: string; status: string;
  }[];
  if (!l || l.status !== 'active') return;
  await m.query(`UPDATE listings.listings SET status = 'ended_unsold' WHERE id = $1`, [listingId]);
  await m.getRepository(ListingStatusChange).insert({ listingId, fromStatus: 'active', toStatus: 'ended_unsold', actorType: 'system', actorId: null, reason });
  await publish(m, 'listings.listing.ended_unsold', listingId, { listingId, sellerId: l.seller_id, itemKind: l.item_kind, reason });
}

@Injectable()
export class AuctionCloser {
  private readonly log = new Logger('AuctionCloser');

  constructor(
    private readonly db: DataSource,
    @Inject(AUCTION_ORDERS) private readonly orders: AuctionOrders,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditServicePort,
    @Inject(LIVE) private readonly live: LivePort,
  ) {}

  /** The job: every auction due by end_at + DV-17. One failure (say, the order) leaves that auction open for the next run. */
  async closeDue(): Promise<number> {
    const due = (await this.db.query(
      `SELECT a.listing_id AS id FROM auctions.auctions a JOIN listings.listings l ON l.id = a.listing_id
        WHERE a.status = 'open' AND a.end_at + $1::interval <= now() AND l.status = 'active'
        ORDER BY a.end_at LIMIT ${BATCH}`,
      [CLOSE_GRACE],
    )) as { id: string }[];
    let n = 0;
    for (const { id } of due) {
      try {
        const closed = await this.closeOne(id);
        if (closed) {
          n++;
          this.announce(closed);
        }
      } catch (err) {
        this.log.error(`auction ${id} not closed, retried on the next run: ${(err as Error).message}`);
      }
    }
    return n;
  }

  /** Closes one auction if it is still open and due; null when another instance has it or nothing changed. */
  async closeOne(auctionId: string): Promise<Closed | null> {
    return this.db.transaction(async (m) => {
      const claimed = await m.query(
        `SELECT 1 FROM auctions.auctions a WHERE a.listing_id = $1 AND a.status = 'open'
            AND EXISTS (SELECT 1 FROM listings.listings l WHERE l.id = a.listing_id AND l.status = 'active')
          FOR UPDATE OF a SKIP LOCKED`,
        [auctionId],
      );
      if (claimed.length === 0) return null;
      const [{ status }] = (await m.query(`SELECT auctions.close_if_due($1, $2::interval) AS status`, [auctionId, CLOSE_GRACE])) as { status: string }[];
      if (status === 'awarded') return this.award(m, auctionId);
      if (status === 'unsold') return this.unsold(m, auctionId);
      return null; // not due yet: a late bid moved end_at on (section 5.2)
    });
  }

  private async award(m: EntityManager, auctionId: string): Promise<Closed> {
    const [a] = (await m.query(
      `SELECT seller_id, winner_id, final_price::text AS price FROM auctions.auctions WHERE listing_id = $1`, [auctionId],
    )) as { seller_id: string; winner_id: string; price: string }[];
    // the single unit is held for the winner until paid (sold), or released when no bidder is left (Decisions log, U3-05)
    const held = await m.query(
      `UPDATE listings.listings SET quantity_available = quantity_available - 1, quantity_reserved = quantity_reserved + 1
        WHERE id = $1 AND quantity_available = 1 RETURNING id`,
      [auctionId],
    );
    if (held.length === 0) throw new Error(`auction ${auctionId}: the listing's unit is not available`);
    const order = await this.orders.createAuctionOrder({ listingId: auctionId, winnerId: a.winner_id, price: BigInt(a.price), kind: 'auction' }, m);
    await publish(m, 'auctions.auction.awarded', auctionId, {
      auctionId, listingId: auctionId, sellerId: a.seller_id, winnerId: a.winner_id, price: a.price, orderId: order.id,
    });
    await this.audit.record({
      actorType: 'system', action: 'auctions.auction.awarded', objectType: 'auction', objectId: auctionId,
      before: { status: 'open' }, after: { status: 'awarded', winnerId: a.winner_id, price: a.price, orderId: order.id },
    }, m);
    return { auctionId, status: 'sold', price: a.price };
  }

  private async unsold(m: EntityManager, auctionId: string): Promise<Closed> {
    const [a] = (await m.query(
      `SELECT seller_id, bid_count, current_price::text AS price FROM auctions.auctions WHERE listing_id = $1`, [auctionId],
    )) as { seller_id: string; bid_count: number; price: string | null }[];
    const reason = a.bid_count === 0 ? 'no_bids' : 'reserve_not_met';
    await endUnsold(m, auctionId, `auction closed: ${reason.replace(/_/g, ' ')}`);
    await publish(m, 'auctions.auction.unsold', auctionId, { auctionId, listingId: auctionId, sellerId: a.seller_id, reason });
    await this.audit.record({
      actorType: 'system', action: 'auctions.auction.unsold', objectType: 'auction', objectId: auctionId,
      before: { status: 'open' }, after: { status: 'unsold' }, reason,
    }, m);
    return { auctionId, status: 'unsold', price: null };
  }

  /** After commit, best effort (section 3.2): the final status and price to the auction's room. */
  private announce(c: Closed): void {
    try {
      this.live.toRoom(`auction:${c.auctionId}`, 'auction.closed', { auctionId: c.auctionId, status: c.status, finalPrice: c.price });
    } catch (err) {
      this.log.warn(`auction.closed for ${c.auctionId} not sent: ${(err as Error).message}`);
    }
  }
}
