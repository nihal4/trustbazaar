import { Injectable, OnModuleInit } from '@nestjs/common';
import { EventBus } from '../../../kernel/events/event-bus';
import { OwnershipReviewService } from '../services/ownership-review.service';

// FR-GAM-04 (docs/design/05_game_accounts.pdf section 3.3): a game-account listing that ends unsold, is cancelled or is
// removed releases its player-ID claim. Idempotent: a released claim is not released again.
const LISTING_ENDED = ['listings.listing.ended_unsold', 'listings.listing.cancelled', 'listings.listing.removed'];

@Injectable()
export class ClaimConsumers implements OnModuleInit {
  constructor(
    private readonly bus: EventBus,
    private readonly review: OwnershipReviewService,
  ) {}

  onModuleInit(): void {
    for (const type of LISTING_ENDED) {
      this.bus.on(type, 'game_accounts.claims', async (e) => {
        if (e.payload.itemKind !== 'game_account') return;
        await this.review.releaseForListing(typeof e.payload.listingId === 'string' ? e.payload.listingId : e.aggregateId);
      });
    }
  }
}
