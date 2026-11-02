import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { IDENTITY_QUERY, IdentityQuery } from '../../identity/ports';
import { publish } from './outbox';

// ShillDetector (docs/design/03_listings_auctions.pdf section 5.8; FR-AUC-18; U3-06). It never blocks a bid: it raises
// flags with a score for the operators' queue (auctions.flags, auctions.flag.raised). It runs every few minutes on open
// auctions with many bids and on auctions that have just closed. A kind is raised at most once per auction, so a flag
// an operator has reviewed is not raised again. The design gives no thresholds; these are the team's starting values
// (Decisions log, U3-06), kept together here so they can become parameters. The linked-to-seller check (FR-TNS-08)
// needs Unit 1 and Unit 2 queries that do not exist yet and comes with U7-04.
export const SHILL = {
  /** open auctions are scanned from this many bids */
  minBids: 10,
  /** and closed ones for this long after closing */
  closedWithin: '15 minutes',
  /** new_account_cluster: bidders verified less than this long before their first bid on the auction */
  newAccountDays: 7,
  newBidders: 2,
  /** a raise of at most this many minimum increments over the price it met counts as small */
  smallRaiseIncrements: 2,
  smallRaises: 3,
  /** last_second_pattern: a bid in the final minute of at least this many auctions within the window */
  lastSeconds: '60 seconds',
  lastSecondAuctions: 3,
  lastSecondWindow: '30 days',
  /** self_outbid_pattern: raised the price on this many of one seller's closed auctions within the window, won none */
  selfOutbidAuctions: 3,
  selfOutbidWindow: '90 days',
} as const;

type Kind = 'new_account_cluster' | 'last_second_pattern' | 'self_outbid_pattern';
interface Raised { kind: Kind; score: number; detail: Record<string, unknown> }

/** 0 to 1, rising by `step` for each unit past the threshold; three decimals (numeric(4,3)). */
const scoreOf = (base: number, over: number, step: number): number => Math.round(Math.min(1, base + Math.max(0, over) * step) * 1000) / 1000;

@Injectable()
export class ShillDetector {
  private readonly log = new Logger('ShillDetector');

  constructor(
    private readonly db: DataSource,
    @Inject(IDENTITY_QUERY) private readonly identity: IdentityQuery,
  ) {}

  /** The job: open auctions with many bids, and auctions closed in the last few minutes. Returns the flags raised. */
  async scanDue(): Promise<number> {
    const due = (await this.db.query(
      `SELECT listing_id FROM auctions.auctions
        WHERE (status = 'open' AND bid_count >= $1) OR (status IN ('awarded', 'unsold') AND closed_at > now() - $2::interval)
        ORDER BY listing_id`,
      [SHILL.minBids, SHILL.closedWithin],
    )) as { listing_id: string }[];
    let n = 0;
    for (const { listing_id } of due) {
      try {
        n += await this.scan(listing_id);
      } catch (err) {
        this.log.warn(`auction ${listing_id} not scanned, retried on the next run: ${(err as Error).message}`);
      }
    }
    return n;
  }

  /** One auction: each pattern found and not yet flagged on it becomes a flag and an event. */
  async scan(auctionId: string): Promise<number> {
    const found = [await this.newAccountCluster(auctionId), await this.lastSecond(auctionId), await this.selfOutbid(auctionId)]
      .filter((r): r is Raised => r !== null);
    let raised = 0;
    for (const r of found) {
      await this.db.transaction(async (m) => {
        // one flag per kind and auction, also under parallel scans by several instances
        await m.query(`SELECT pg_advisory_xact_lock(hashtextextended('auctions.flag:' || $1 || ':' || $2, 0))`, [auctionId, r.kind]);
        const [exists] = (await m.query(`SELECT 1 FROM auctions.flags WHERE auction_id = $1 AND kind = $2`, [auctionId, r.kind])) as unknown[];
        if (exists) return;
        const [{ id }] = (await m.query(
          `INSERT INTO auctions.flags (auction_id, kind, score, detail) VALUES ($1, $2, $3, $4) RETURNING id::text`,
          [auctionId, r.kind, r.score, JSON.stringify(r.detail)],
        )) as { id: string }[];
        await publish(m, 'auctions.flag.raised', auctionId, { auctionId, flagId: id, kind: r.kind, score: r.score });
        raised++;
      });
    }
    return raised;
  }

  /** Several newly verified bidders pushing the price up in small steps. */
  private async newAccountCluster(auctionId: string): Promise<Raised | null> {
    const raises = (await this.db.query(
      `WITH b AS (
         SELECT b.id, b.bidder_id, b.max_amount, b.received_at,
                coalesce(lag(b.price_after) OVER (ORDER BY b.id), a.start_price) AS met,
                a.inc_bps, a.inc_min, a.seller_id
           FROM auctions.bids b JOIN auctions.auctions a ON a.listing_id = b.auction_id
          WHERE b.auction_id = $1 AND b.voided_at IS NULL)
       SELECT bidder_id, min(received_at) AS first_bid,
              count(*) FILTER (WHERE max_amount <= met + $2 * auctions.increment(met, inc_bps, inc_min))::int AS small
         FROM b WHERE bidder_id <> seller_id GROUP BY bidder_id`,
      [auctionId, SHILL.smallRaiseIncrements],
    )) as { bidder_id: string; first_bid: Date; small: number }[];
    const windowMs = SHILL.newAccountDays * 86_400_000;
    const fresh: { bidderId: string; small: number }[] = [];
    for (const r of raises) {
      const p = await this.identity.getPrincipal(r.bidder_id).catch(() => null);
      if (p?.verifiedAt && r.first_bid.getTime() - p.verifiedAt.getTime() < windowMs) fresh.push({ bidderId: r.bidder_id, small: r.small });
    }
    const small = fresh.reduce((s, f) => s + f.small, 0);
    if (fresh.length < SHILL.newBidders || small < SHILL.smallRaises) return null;
    return {
      kind: 'new_account_cluster',
      score: scoreOf(0.5, (fresh.length - SHILL.newBidders) * 1.5 + (small - SHILL.smallRaises), 0.1),
      detail: { bidders: await this.aliases(auctionId, fresh.map((f) => f.bidderId)), smallRaises: small, newAccountDays: SHILL.newAccountDays },
    };
  }

  /** Bidders who bid in the final minute of many auctions. */
  private async lastSecond(auctionId: string): Promise<Raised | null> {
    const rows = (await this.db.query(
      `SELECT x.bidder_id, count(DISTINCT x.auction_id)::int AS auctions
         FROM auctions.bids x JOIN auctions.auctions a ON a.listing_id = x.auction_id
        WHERE x.bidder_id IN (SELECT bidder_id FROM auctions.bids WHERE auction_id = $1 AND voided_at IS NULL)
          AND x.voided_at IS NULL AND x.received_at > now() - $2::interval
          AND x.received_at > a.end_at - $3::interval AND x.received_at <= a.end_at
        GROUP BY x.bidder_id HAVING count(DISTINCT x.auction_id) >= $4`,
      [auctionId, SHILL.lastSecondWindow, SHILL.lastSeconds, SHILL.lastSecondAuctions],
    )) as { bidder_id: string; auctions: number }[];
    if (rows.length === 0) return null;
    const most = Math.max(...rows.map((r) => r.auctions));
    return {
      kind: 'last_second_pattern',
      score: scoreOf(0.4, most - SHILL.lastSecondAuctions + (rows.length - 1), 0.15),
      detail: {
        bidders: await this.aliases(auctionId, rows.map((r) => r.bidder_id)),
        auctions: Object.fromEntries(rows.map((r) => [r.bidder_id, r.auctions])), windowDays: 30,
      },
    };
  }

  /** Bidders who raise the price on one seller's auctions but never win them. */
  private async selfOutbid(auctionId: string): Promise<Raised | null> {
    const rows = (await this.db.query(
      `WITH seller AS (SELECT seller_id FROM auctions.auctions WHERE listing_id = $1),
            raised AS (
              SELECT b.bidder_id, b.auction_id, a.winner_id
                FROM auctions.bids b JOIN auctions.auctions a ON a.listing_id = b.auction_id
               WHERE a.seller_id = (SELECT seller_id FROM seller) AND a.status IN ('awarded', 'unsold')
                 AND a.closed_at > now() - $2::interval AND b.voided_at IS NULL
                 AND b.price_after > coalesce((SELECT p.price_after FROM auctions.bids p
                                                WHERE p.auction_id = b.auction_id AND p.id < b.id AND p.voided_at IS NULL
                                                ORDER BY p.id DESC LIMIT 1), 0)
                 AND b.bidder_id IN (SELECT bidder_id FROM auctions.bids WHERE auction_id = $1 AND voided_at IS NULL))
       SELECT bidder_id, count(DISTINCT auction_id)::int AS auctions
         FROM raised GROUP BY bidder_id
       HAVING count(DISTINCT auction_id) >= $3 AND bool_and(winner_id IS DISTINCT FROM bidder_id)`,
      [auctionId, SHILL.selfOutbidWindow, SHILL.selfOutbidAuctions],
    )) as { bidder_id: string; auctions: number }[];
    if (rows.length === 0) return null;
    const most = Math.max(...rows.map((r) => r.auctions));
    return {
      kind: 'self_outbid_pattern',
      score: scoreOf(0.5, most - SHILL.selfOutbidAuctions + (rows.length - 1), 0.1),
      detail: {
        bidders: await this.aliases(auctionId, rows.map((r) => r.bidder_id)),
        auctions: Object.fromEntries(rows.map((r) => [r.bidder_id, r.auctions])), windowDays: 90,
      },
    };
  }

  /** The detail names bidders as on the auction ("Bidder 2") and by id, for the operator (the flag is staff-only). */
  private async aliases(auctionId: string, ids: string[]): Promise<{ alias: number | null; bidderId: string }[]> {
    const rows = (await this.db.query(
      `SELECT bidder_id, alias_no FROM auctions.bidder_aliases WHERE auction_id = $1 AND bidder_id = ANY($2::uuid[])`, [auctionId, ids],
    )) as { bidder_id: string; alias_no: number }[];
    const by = new Map(rows.map((r) => [r.bidder_id, r.alias_no]));
    return ids.map((id) => ({ alias: by.get(id) ?? null, bidderId: id }));
  }
}
