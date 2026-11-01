import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource, QueryFailedError } from 'typeorm';
import { IdempotencyKeys } from '../../../kernel/http/idempotency';
import { Problem } from '../../../kernel/http/problems';
import { LIVE, LivePort } from '../../../kernel/live/live';
import { IDENTITY_QUERY, IdentityQuery, RATE_LIMITER, RateLimiterPort } from '../../identity/ports';
import { Bid } from '../db/entities';
import type { BidOutcome } from '../db/enums';
import type { AuctionQuery, AuctionState } from '../ports';
import { readAuctionState } from './auction-state';
import { ListingService } from './listing.service';
import { publish } from './outbox';

// BidService (docs/design/03_listings_auctions.pdf sections 3.2, 5.3 and 5.4; FR-AUC-02 to FR-AUC-13, FR-AUC-17;
// I-53). The database decides: auctions.place_bid applies the rules under the auction's row lock, with the
// transaction's start as the receipt time. This service gates the request before the lock, maps the function's
// refusals to stable codes, and after commit sends the live messages. Maximums, the reserve amount and
// identities never leave it except a bidder's own maximum, to that bidder (FR-AUC-08).

/** The refusals of section 3.2, answered 422 bid-refused with the code as the reason. */
export const REFUSALS = ['below_minimum', 'max_not_higher', 'auction_ended', 'auction_not_open', 'seller_cannot_bid', 'bidder_restricted'] as const;
export type Refusal = (typeof REFUSALS)[number];

export interface BidResult {
  bidId: string;
  /** leading; outbid (another bidder's proxy answered at once); raised_own_max (the leader raised it) */
  outcome: BidOutcome;
  /** The bidder's own maximum, shown only to them. */
  yourMaximum: string;
  /** The auction's public state after the bid (I-53: with seq and serverTime). */
  state: AuctionState;
}

interface Placed {
  bid_id: string;
  outcome: BidOutcome;
  price: string;
  leader_alias: number;
  end_at: Date;
  extended: boolean;
  previous_leader: string | null;
  version: string;
}

/** A refusal of place_bid (SQLSTATE P0001) as a problem; the lock wait of DV-18 (55P03) as "try again". */
export function fromPlaceBid(err: unknown): never {
  if (err instanceof QueryFailedError) {
    const d = err.driverError as { code?: string; message?: string };
    if (d.code === '55P03') throw new Problem('auction-busy', { retryAfter: 1 });
    if (d.code === 'P0001' && d.message) {
      const m = d.message;
      if (m.startsWith('auction_not_found')) throw new Problem('not-found');
      const reason = REFUSALS.find((r) => m === r || m.startsWith(`${r}:`) || m.startsWith(`${r} `));
      if (reason === 'below_minimum') {
        const minimum = /(\d+)\s*$/.exec(m)?.[1];
        throw new Problem('bid-refused', { errors: [{ field: 'maximum', reason, ...(minimum ? { minimum } : {}) }] });
      }
      if (reason === 'bidder_restricted') {
        // 'bidder_restricted until 2026-11-20 10:00:00+00': the end of the restriction, so the bidder knows (FR-AUC-16)
        const until = Date.parse(m.slice('bidder_restricted until '.length).trim().replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00'));
        throw new Problem('bid-refused', { errors: [{ field: 'maximum', reason, ...(Number.isFinite(until) ? { until: new Date(until).toISOString() } : {}) }] });
      }
      if (reason) throw new Problem('bid-refused', { errors: [{ field: 'maximum', reason }] });
    }
  }
  throw err;
}

@Injectable()
export class BidService implements AuctionQuery {
  private readonly log = new Logger('BidService');

  constructor(
    private readonly db: DataSource,
    private readonly listings: ListingService,
    private readonly idempotency: IdempotencyKeys,
    @Inject(IDENTITY_QUERY) private readonly identity: IdentityQuery,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiterPort,
    @Inject(LIVE) private readonly live: LivePort,
  ) {}

  /**
   * FR-AUC-02 to FR-AUC-07: a bid, or a new maximum. With an Idempotency-Key a repeat answers with the first
   * bid's outcome and the current state, and places nothing (I-53). The proxy's own answers are part of this
   * one decision and consume no rate limit (FR-AUC-17).
   */
  async place(userId: string, auctionId: string, maximum: string, idempotencyKey: string | undefined): Promise<BidResult & { repeated: boolean }> {
    const { id, repeated } = await this.idempotency.once('bid', userId, idempotencyKey, async () => {
      // section 5.4, before the lock: the bidder may transact, within CP-35 for this auction, and the listing is visible
      await this.identity.assertCanTransact(userId, 'bid');
      await this.limiter.consume('bid', `${userId}:${auctionId}`);
      await this.listings.visible(auctionId, userId);
      return (await this.decide(userId, auctionId, maximum)).bid_id;
    });
    const bid = await this.db.getRepository(Bid).findOneBy({ id, bidderId: userId, auctionId });
    if (!bid) throw new Problem('not-found'); // the key was used for another auction
    return { bidId: bid.id, outcome: bid.outcome, yourMaximum: bid.maxAmount, state: await this.getPublicState(auctionId), repeated };
  }

  /** One transaction around place_bid, begun only now: its start is the receipt time (FR-AUC-04). */
  private async decide(userId: string, auctionId: string, maximum: string): Promise<Placed> {
    let placed!: Placed;
    let state: AuctionState | null = null;
    await this.db
      .transaction(async (m) => {
        [placed] = (await m.query(
          `SELECT bid_id::text, outcome, price::text, leader_alias, end_at, extended, previous_leader, version::text
             FROM auctions.place_bid($1, $2, $3)`,
          [auctionId, userId, maximum],
        )) as Placed[];
        // the lead changed hands: the previous leader's notification history (FR-NTF-01), in the same transaction (DC-6)
        if (this.leadTaken(placed, userId)) {
          await publish(m, 'auctions.bid.outbid', auctionId, {
            auctionId, userId: placed.previous_leader, price: placed.price, bidId: placed.bid_id,
          });
        }
        state = await readAuctionState(m, auctionId);
      })
      .catch(fromPlaceBid);
    this.broadcast(auctionId, userId, placed, state);
    return placed;
  }

  private leadTaken(p: Placed, bidderId: string): p is Placed & { previous_leader: string } {
    return p.outcome === 'leading' && p.previous_leader !== null && p.previous_leader !== bidderId;
  }

  /** After commit, best effort (section 5.4): a lost message is repaired by the next one or by /state. */
  private broadcast(auctionId: string, bidderId: string, placed: Placed, state: AuctionState | null): void {
    try {
      if (state) this.live.toRoom(`auction:${auctionId}`, 'auction.state', { ...state });
      if (this.leadTaken(placed, bidderId)) {
        this.live.toUser(placed.previous_leader, 'auction.outbid', { auctionId, price: placed.price, seq: Number(placed.version) });
      }
    } catch (err) {
      this.log.warn(`live messages for auction ${auctionId} not sent: ${(err as Error).message}`);
    }
  }

  /** GET /auctions/{id}/state, under the listing page's visibility rule. */
  async state(auctionId: string, viewerId: string | undefined): Promise<AuctionState> {
    await this.listings.visible(auctionId, viewerId);
    return this.getPublicState(auctionId);
  }

  /** AuctionQuery (Units 2 and 7). */
  async getPublicState(auctionId: string): Promise<AuctionState> {
    const s = await readAuctionState(this.db, auctionId);
    if (!s) throw new Problem('not-found');
    return s;
  }

  /**
   * FR-AUC-13: the history by alias, newest first, replayed in bid-id order through the same rules (section 5.3).
   * A leading bid shows the price it set, an outbid one the bidder's own amount; voided bids are left out.
   */
  async history(auctionId: string, viewerId: string | undefined) {
    await this.listings.visible(auctionId, viewerId);
    if (!(await readAuctionState(this.db, auctionId))) throw new Problem('not-found');
    const rows = (await this.db.query(
      `SELECT bid_id::text, received_at, alias_no, shown_amount::text, is_leading
         FROM auctions.replay($1) WHERE counted ORDER BY bid_id DESC`,
      [auctionId],
    )) as { bid_id: string; received_at: Date; alias_no: number; shown_amount: string; is_leading: boolean }[];
    return {
      items: rows.map((r) => ({ id: r.bid_id, bidderAlias: r.alias_no, amount: r.shown_amount, leading: r.is_leading, at: r.received_at.toISOString() })),
    };
  }

  /** GET /auctions/{id}/my-status: the caller's own maximum and whether they lead, for them only. */
  async myStatus(auctionId: string, userId: string) {
    await this.listings.visible(auctionId, userId);
    const [r] = (await this.db.query(
      `SELECT a.leader_id = $2 AS leading,
              (SELECT max(b.max_amount) FROM auctions.bids b
                WHERE b.auction_id = a.listing_id AND b.bidder_id = $2 AND b.voided_at IS NULL)::text AS maximum,
              (SELECT ba.alias_no FROM auctions.bidder_aliases ba WHERE ba.auction_id = a.listing_id AND ba.bidder_id = $2) AS alias
         FROM auctions.auctions a WHERE a.listing_id = $1`,
      [auctionId, userId],
    )) as { leading: boolean | null; maximum: string | null; alias: number | null }[];
    if (!r) throw new Problem('not-found');
    return { hasBid: r.maximum !== null, yourMaximum: r.maximum, leading: r.leading === true, yourAlias: r.alias };
  }
}
