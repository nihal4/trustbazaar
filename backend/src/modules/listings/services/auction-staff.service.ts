import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { Problem } from '../../../kernel/http/problems';
import { LIVE, LivePort } from '../../../kernel/live/live';
import { AUDIT_SERVICE, AuditServicePort } from '../../identity/ports';
import type { AuctionState } from '../ports';
import { readAuctionState } from './auction-state';
import { publish } from './outbox';

// Operator actions on bids and auctions (docs/design/03_listings_auctions.pdf sections 3.1, 5.5, 5.7 and 6.1;
// FR-AUC-08, FR-AUC-10, FR-LST-08; U3-06). Each is audited with its reason (DC-8) in the transaction it records,
// and announced by an outbox event (DC-6); after commit the auction's room gets the new state (best effort).

/** A reason long enough to mean something in the audit log (as for Unit 1's staff actions). */
export const MIN_REASON = 10;

const reasonOf = (reason: string, field = 'reason'): string => {
  const r = reason?.trim() ?? '';
  if (r.length < MIN_REASON) throw new Problem('validation-failed', { errors: [{ field, reason: 'too-short' }] });
  return r;
};

@Injectable()
export class AuctionStaffService {
  private readonly log = new Logger('AuctionStaffService');

  constructor(
    private readonly db: DataSource,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditServicePort,
    @Inject(LIVE) private readonly live: LivePort,
  ) {}

  /**
   * POST /staff/bids/{bid}/void (FR-AUC-10): an open auction only. auctions.recompute replays the remaining bids in
   * processing order; the end time is not shortened. The bidders whose position changed are named in the event.
   */
  async voidBid(staffId: string, bidId: string, rawReason: string): Promise<{ bidId: string; state: AuctionState }> {
    const reason = reasonOf(rawReason);
    if (!/^\d{1,18}$/.test(bidId)) throw new Problem('not-found');
    const state = await this.db.transaction(async (m) => {
      const [b] = (await m.query(`SELECT auction_id, bidder_id, voided_at FROM auctions.bids WHERE id = $1`, [bidId])) as {
        auction_id: string; bidder_id: string; voided_at: Date | null;
      }[];
      if (!b) throw new Problem('not-found');
      const before = await this.lockOpen(m, b.auction_id);
      if (b.voided_at) throw new Problem('listing-state', { errors: [{ field: 'bid', reason: 'already-voided' }] });
      await m.query(`UPDATE auctions.bids SET voided_at = now(), voided_by = $2, void_reason = $3 WHERE id = $1`, [bidId, staffId, reason]);
      await m.query(`SELECT auctions.recompute($1)`, [b.auction_id]);
      const [after] = (await m.query(`SELECT leader_id FROM auctions.auctions WHERE listing_id = $1`, [b.auction_id])) as { leader_id: string | null }[];
      await publish(m, 'auctions.bid.voided', b.auction_id, {
        auctionId: b.auction_id, bidId, bidderId: b.bidder_id, previousLeader: before.leader_id, leader: after.leader_id,
      });
      await this.audit.record({
        actorType: 'staff', actorId: staffId, action: 'auctions.bid.voided', objectType: 'auction', objectId: b.auction_id,
        after: { bidId, bidderId: b.bidder_id }, reason,
      }, m);
      return (await readAuctionState(m, b.auction_id))!;
    });
    this.broadcast(state, null);
    return { bidId, state };
  }

  /**
   * POST /staff/auctions/{id}/cancel (FR-LST-08): an open auction, with bids or without, is cancelled with its listing.
   * Every bidder is named in auctions.auction.cancelled, for their notice. Nothing is reserved before the award (U3-05).
   */
  async cancel(staffId: string, auctionId: string, rawReason: string): Promise<AuctionState> {
    const reason = reasonOf(rawReason);
    const state = await this.db.transaction(async (m) => {
      const a = await this.lockOpen(m, auctionId);
      const [l] = (await m.query(`SELECT status, item_kind FROM listings.listings WHERE id = $1 FOR UPDATE`, [auctionId])) as { status: string; item_kind: string }[];
      if (l.status !== 'active') throw new Problem('listing-state'); // a listing in review is removed instead (U3-08)
      await m.query(`UPDATE auctions.auctions SET status = 'cancelled', closed_at = now(), version = version + 1 WHERE listing_id = $1`, [auctionId]);
      await m.query(`UPDATE listings.listings SET status = 'cancelled' WHERE id = $1`, [auctionId]);
      await m.query(
        `INSERT INTO listings.status_history (listing_id, from_status, to_status, actor_type, actor_id, reason) VALUES ($1, 'active', 'cancelled', 'staff', $2, $3)`,
        [auctionId, staffId, `cancelled by an operator: ${reason}`],
      );
      const bidders = ((await m.query(`SELECT DISTINCT bidder_id FROM auctions.bids WHERE auction_id = $1`, [auctionId])) as { bidder_id: string }[])
        .map((r) => r.bidder_id);
      await publish(m, 'auctions.auction.cancelled', auctionId, { auctionId, sellerId: a.seller_id, bidderIds: bidders, by: 'operator' });
      await publish(m, 'listings.listing.cancelled', auctionId, { listingId: auctionId, sellerId: a.seller_id, itemKind: l.item_kind });
      await this.audit.record({
        actorType: 'staff', actorId: staffId, action: 'auctions.auction.cancelled', objectType: 'auction', objectId: auctionId,
        after: { bidders: bidders.length }, reason,
      }, m);
      return (await readAuctionState(m, auctionId))!;
    });
    this.broadcast(state, { auctionId, status: 'cancelled', finalPrice: null });
    return state;
  }

  /**
   * GET /staff/auctions/{id}/maximums (FR-AUC-08): the bidders' maximums, only while a flag on the auction is open;
   * every view is audited. Voided bids are left out, as in the auction's own state.
   */
  async maximums(staffId: string, auctionId: string) {
    return this.db.transaction(async (m) => {
      const [open] = (await m.query(`SELECT 1 FROM auctions.flags WHERE auction_id = $1 AND reviewed_at IS NULL LIMIT 1`, [auctionId])) as unknown[];
      if (!open) throw new Problem('forbidden', { errors: [{ field: 'auction', reason: 'no-open-flag' }] });
      const rows = (await m.query(
        `SELECT ba.alias_no, b.bidder_id, max(b.max_amount)::text AS maximum, count(*)::int AS bids, max(b.received_at) AS last_bid_at
           FROM auctions.bids b JOIN auctions.bidder_aliases ba ON ba.auction_id = b.auction_id AND ba.bidder_id = b.bidder_id
          WHERE b.auction_id = $1 AND b.voided_at IS NULL
          GROUP BY ba.alias_no, b.bidder_id ORDER BY max(b.max_amount) DESC, ba.alias_no`,
        [auctionId],
      )) as { alias_no: number; bidder_id: string; maximum: string; bids: number; last_bid_at: Date }[];
      await this.audit.record({
        actorType: 'staff', actorId: staffId, action: 'auctions.maximums.viewed', objectType: 'auction', objectId: auctionId,
        after: { bidders: rows.length },
      }, m);
      return {
        auctionId,
        bidders: rows.map((r) => ({ alias: r.alias_no, bidderId: r.bidder_id, maximum: r.maximum, bids: r.bids, lastBidAt: r.last_bid_at.toISOString() })),
      };
    });
  }

  /** POST /staff/auctions/{id}/flags/{flagId}/review (Decisions log, U3-06): closes the flag, with the operator's note. */
  async reviewFlag(staffId: string, auctionId: string, flagId: string, rawNote: string): Promise<void> {
    const note = reasonOf(rawNote, 'note');
    if (!/^\d{1,18}$/.test(flagId)) throw new Problem('not-found');
    await this.db.transaction(async (m) => {
      const res = (await m.query(
        `UPDATE auctions.flags SET reviewed_at = now() WHERE id = $1 AND auction_id = $2 AND reviewed_at IS NULL RETURNING kind`, [flagId, auctionId],
      )) as unknown[];
      const [row] = (Array.isArray(res[0]) ? res[0] : res) as { kind: string }[]; // TypeORM: [rows, count] for UPDATE
      if (!row) {
        const [exists] = (await m.query(`SELECT 1 FROM auctions.flags WHERE id = $1 AND auction_id = $2`, [flagId, auctionId])) as unknown[];
        throw exists ? new Problem('listing-state', { errors: [{ field: 'flag', reason: 'already-reviewed' }] }) : new Problem('not-found');
      }
      await this.audit.record({
        actorType: 'staff', actorId: staffId, action: 'auctions.flag.reviewed', objectType: 'auction', objectId: auctionId,
        after: { flagId, kind: row.kind }, reason: note,
      }, m);
    });
  }

  /** The auction row, locked; an auction that is not open cannot be voided in or cancelled. */
  private async lockOpen(m: EntityManager, auctionId: string): Promise<{ seller_id: string; leader_id: string | null }> {
    const [a] = (await m.query(`SELECT seller_id, leader_id, status FROM auctions.auctions WHERE listing_id = $1 FOR UPDATE`, [auctionId])) as {
      seller_id: string; leader_id: string | null; status: string;
    }[];
    if (!a) throw new Problem('not-found');
    if (a.status !== 'open') throw new Problem('listing-state', { errors: [{ field: 'auction', reason: `auction-${a.status}` }] });
    return a;
  }

  private broadcast(state: AuctionState, closed: Record<string, unknown> | null): void {
    try {
      this.live.toRoom(`auction:${state.auctionId}`, 'auction.state', { ...state });
      if (closed) this.live.toRoom(`auction:${state.auctionId}`, 'auction.closed', closed);
    } catch (err) {
      this.log.warn(`live update for ${state.auctionId} not sent: ${(err as Error).message}`); // /state repairs it
    }
  }
}
