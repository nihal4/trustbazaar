import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { CONFIG_PORT, ConfigPort } from '../../../kernel/config-port';
import { EventBus, OutboxEvent } from '../../../kernel/events/event-bus';
import { Problem } from '../../../kernel/http/problems';
import { AUDIT_SERVICE, AuditServicePort, IDENTITY_QUERY, IdentityQuery } from '../../identity/ports';
import { AUCTION_ORDERS, AuctionOrders } from '../adapters/orders';
import { endUnsold } from './auction-closer.service';
import { publish } from './outbox';

// SecondChanceService (docs/design/03_listings_auctions.pdf section 5.6; FR-AUC-15, FR-AUC-16; U3-05). When Unit 2
// reports an auction or second-chance order unpaid (orders.order.payment_expired), the buyer gets a strike (CP-12;
// a second-chance buyer too: Decisions log, U3-05) and the next eligible bidder is offered the item at their highest
// bid for CP-11. An accepted offer becomes a second_chance order in the same transaction; a declined or expired
// one passes to the next bidder; with nobody left the listing ends unsold and its unit is released.
// Every change locks the auction row first, so a redelivered event, the expiry job and a decision never race.

export type Decision = 'accept' | 'decline';
const BATCH = 100;

/** expired: decided on the database's clock, as bids are (AS-2) */
interface OfferRow { id: string; auction_id: string; bidder_id: string; price: string; status: string; expired: boolean }

@Injectable()
export class SecondChanceService implements OnModuleInit {
  private readonly log = new Logger('SecondChanceService');

  constructor(
    private readonly db: DataSource,
    private readonly bus: EventBus,
    @Inject(AUCTION_ORDERS) private readonly orders: AuctionOrders,
    @Inject(IDENTITY_QUERY) private readonly identity: IdentityQuery,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditServicePort,
    @Inject(CONFIG_PORT) private readonly params: ConfigPort,
  ) {}

  onModuleInit(): void {
    this.bus.on('orders.order.payment_expired', 'auctions.second_chance', (e) => this.onPaymentExpired(e));
  }

  /** A strike once per order (FR-AUC-16), then the next offer. A redelivered event finds its strike and does nothing. */
  async onPaymentExpired(e: Pick<OutboxEvent, 'aggregateId' | 'payload'>): Promise<void> {
    const { kind, listingId, buyerId } = e.payload as { kind?: string; listingId?: string; buyerId?: string };
    if (kind !== 'auction' && kind !== 'second_chance') return;
    if (typeof listingId !== 'string' || typeof buyerId !== 'string') throw new Error(`payment_expired ${e.aggregateId} lacks listingId or buyerId`);
    const cp12 = (await this.params.current()).get<{ strikes: number; window: string; suspension: string }>('CP-12');
    await this.db.transaction(async (m) => {
      const locked = await m.query(`SELECT 1 FROM auctions.auctions WHERE listing_id = $1 FOR UPDATE`, [listingId]);
      if (locked.length === 0) throw new Error(`payment_expired ${e.aggregateId}: no auction ${listingId}`);
      if ((await m.query(`SELECT 1 FROM auctions.strikes WHERE order_id = $1`, [e.aggregateId])).length > 0) return; // handled before
      const [{ restricted }] = (await m.query(
        `SELECT auctions.record_strike($1, $2, $3, $4, $5::interval, $6::interval) AS restricted`,
        [buyerId, listingId, e.aggregateId, cp12.strikes, cp12.window, cp12.suspension],
      )) as { restricted: boolean }[];
      if (restricted) {
        const [{ until }] = (await m.query(`SELECT until FROM auctions.bidding_restrictions WHERE user_id = $1`, [buyerId])) as { until: Date }[];
        await publish(m, 'auctions.bidder.restricted', listingId, { userId: buyerId, until: until.toISOString(), reason: 'non_payment_strikes' });
      }
      await this.audit.record({
        actorType: 'system', action: 'auctions.strike.recorded', objectType: 'user', objectId: buyerId,
        after: { auctionId: listingId, orderId: e.aggregateId, restricted },
      }, m);
      await this.offerNext(m, listingId);
    });
  }

  /** The next eligible bidder at their highest bid for CP-11, or the end: unit released, listing ended unsold. */
  private async offerNext(m: EntityManager, auctionId: string): Promise<void> {
    const [next] = (await m.query(`SELECT bidder, price::text AS price FROM auctions.next_second_chance($1)`, [auctionId])) as {
      bidder: string | null; price: string | null;
    }[];
    if (!next?.bidder) {
      await m.query(`SELECT listings.release($1, 1)`, [auctionId]);
      await endUnsold(m, auctionId, 'no second-chance bidder left');
      return;
    }
    const window = (await this.params.current()).ms('CP-11');
    const [offer] = (await m.query(
      `INSERT INTO auctions.second_chance_offers (auction_id, bidder_id, price, expires_at)
       VALUES ($1, $2, $3, now() + $4 * interval '1 millisecond') RETURNING id, expires_at`,
      [auctionId, next.bidder, next.price, window],
    )) as { id: string; expires_at: Date }[];
    await publish(m, 'auctions.offer.made', auctionId, {
      offerId: offer.id, auctionId, userId: next.bidder, price: next.price, expiresAt: offer.expires_at.toISOString(),
    });
  }

  /** POST /auctions/{id}/second-chance/{oid}/decision: only the offered bidder, only while the offer is open. */
  async decide(userId: string, auctionId: string, offerId: string, decision: Decision) {
    if (decision === 'accept') await this.identity.assertCanTransact(userId, 'buy'); // checked again on acceptance
    return this.db.transaction(async (m) => {
      await m.query(`SELECT 1 FROM auctions.auctions WHERE listing_id = $1 FOR UPDATE`, [auctionId]);
      const o = await this.lockOffer(m, offerId, auctionId);
      if (!o || o.bidder_id !== userId) throw new Problem('not-found');
      if (o.status !== 'offered' || o.expired) throw new Problem('offer-closed');
      if (decision === 'decline') {
        await m.query(`UPDATE auctions.second_chance_offers SET status = 'declined', decided_at = now() WHERE id = $1`, [offerId]);
        await this.offerNext(m, auctionId);
        return { offerId, status: 'declined' as const, orderId: null };
      }
      const order = await this.orders.createAuctionOrder({ listingId: auctionId, winnerId: userId, price: BigInt(o.price), kind: 'second_chance' }, m);
      await m.query(`UPDATE auctions.second_chance_offers SET status = 'accepted', decided_at = now(), order_id = $2 WHERE id = $1`, [offerId, order.id]);
      await this.audit.record({
        actorType: 'user', actorId: userId, action: 'auctions.offer.accepted', objectType: 'auction', objectId: auctionId,
        after: { offerId, price: o.price, orderId: order.id },
      }, m);
      return { offerId, status: 'accepted' as const, orderId: order.id };
    });
  }

  /** The job: offers past CP-11 expire and pass to the next bidder. */
  async expireDue(): Promise<number> {
    const due = (await this.db.query(
      `SELECT id, auction_id FROM auctions.second_chance_offers WHERE status = 'offered' AND expires_at <= now() ORDER BY expires_at LIMIT ${BATCH}`,
    )) as { id: string; auction_id: string }[];
    let n = 0;
    for (const d of due) {
      try {
        if (await this.expireOne(d.id, d.auction_id)) n++;
      } catch (err) {
        this.log.error(`offer ${d.id} not expired, retried on the next run: ${(err as Error).message}`);
      }
    }
    return n;
  }

  private expireOne(offerId: string, auctionId: string): Promise<boolean> {
    return this.db.transaction(async (m) => {
      if ((await m.query(`SELECT 1 FROM auctions.auctions WHERE listing_id = $1 FOR UPDATE SKIP LOCKED`, [auctionId])).length === 0) return false;
      const o = await this.lockOffer(m, offerId, auctionId);
      if (!o || o.status !== 'offered' || !o.expired) return false; // decided meanwhile
      await m.query(`UPDATE auctions.second_chance_offers SET status = 'expired', decided_at = now() WHERE id = $1`, [offerId]);
      await publish(m, 'auctions.offer.expired', auctionId, { offerId, auctionId, userId: o.bidder_id });
      await this.offerNext(m, auctionId);
      return true;
    });
  }

  private async lockOffer(m: EntityManager, offerId: string, auctionId: string): Promise<OfferRow | undefined> {
    const [o] = (await m.query(
      `SELECT id, auction_id, bidder_id, price::text AS price, status, expires_at <= now() AS expired FROM auctions.second_chance_offers
        WHERE id = $1 AND auction_id = $2 FOR UPDATE`,
      [offerId, auctionId],
    )) as OfferRow[];
    return o;
  }
}
