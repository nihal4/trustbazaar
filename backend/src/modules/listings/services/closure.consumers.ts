import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { EventBus, OutboxEvent } from '../../../kernel/events/event-bus';
import { ACCOUNT_CLOSURE_CHECKS, AccountClosureCheck, AccountClosureChecks, ClosureStage } from '../../identity/ports';
import { ListingService } from './listing.service';

// Listings and Auctions at account closure (FR-ACC-11; U1-09; Decisions log, 2026-11-17, agreed with the user).
//  - The check: closure is refused while the user leads a running auction ('leading-bid'), has a second-chance offer
//    open ('offer-open'), or sells an auction that has bids ('auction-with-bids'): bidders keep their chance to win.
//    Outbid bids do not block. Unpaid wins are orders, so Unit 2's check names them.
//  - identity.account.closed: the user's drafts, listings awaiting review and active listings are cancelled, so buyers
//    no longer find them (listings.listing.cancelled releases game-account claims as for any cancellation).
@Injectable()
export class ListingsClosure implements AccountClosureCheck, OnModuleInit {
  readonly name = 'listings';
  private readonly log = new Logger('ListingsClosure');

  constructor(
    private readonly db: DataSource,
    private readonly bus: EventBus,
    private readonly listings: ListingService,
    @Inject(ACCOUNT_CLOSURE_CHECKS) private readonly checks: AccountClosureChecks,
  ) {}

  onModuleInit(): void {
    this.checks.register(this);
    this.bus.on('identity.account.closed', 'listings.closure', (e) => this.onClosed(e));
  }

  async blockers(userId: string, _stage: ClosureStage, tx?: EntityManager): Promise<string[]> {
    const [r] = (await (tx ?? this.db.manager).query(
      `SELECT EXISTS (SELECT 1 FROM auctions.auctions WHERE status = 'open' AND leader_id = $1) AS leading,
              EXISTS (SELECT 1 FROM auctions.second_chance_offers WHERE bidder_id = $1 AND status = 'offered' AND expires_at > now()) AS offer,
              EXISTS (SELECT 1 FROM auctions.auctions WHERE seller_id = $1 AND status = 'open' AND bid_count > 0) AS selling`,
      [userId],
    )) as { leading: boolean; offer: boolean; selling: boolean }[];
    return [...(r.leading ? ['leading-bid'] : []), ...(r.offer ? ['offer-open'] : []), ...(r.selling ? ['auction-with-bids'] : [])];
  }

  async onClosed(e: OutboxEvent): Promise<void> {
    const { userId } = e.payload as { userId: string };
    const ids = (await this.db.query(
      `SELECT id FROM listings.listings WHERE seller_id = $1 AND status IN ('draft', 'pending_review', 'active') ORDER BY created_at`,
      [userId],
    )) as { id: string }[];
    for (const { id } of ids) {
      // a listing an order or a bid reached after the closure check is left for an operator
      await this.listings.cancel(userId, id, true).catch((err: Error) => this.log.warn({ msg: 'listing not cancelled at closure', listingId: id, error: err }));
    }
  }
}
