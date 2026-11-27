import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { EventBus, OutboxEvent } from '../../../kernel/events/event-bus';

// The featured label (docs/design/03_listings_auctions.pdf sections 3.4 and 7.3; FR-MON-05). Unit 2 sells the
// placement; its events set or clear listings.featured_until, which search reads (featured_until > now()):
//  - payments.featured.started: featured_until becomes the later of its current value and the period's end, so a
//    second purchase that follows the first extends the label, and a redelivered event changes nothing.
//  - payments.featured.ended: featured_until is cleared only if no later period has moved it beyond this end.
@Injectable()
export class FeaturedConsumers implements OnModuleInit {
  constructor(
    private readonly db: DataSource,
    private readonly bus: EventBus,
  ) {}

  onModuleInit(): void {
    this.bus.on('payments.featured.started', 'listings.featured', (e) => this.started(e));
    this.bus.on('payments.featured.ended', 'listings.featured', (e) => this.ended(e));
  }

  async started(e: OutboxEvent): Promise<void> {
    const { listingId, endsAt } = e.payload as { listingId: string; endsAt: string };
    await this.db.query(`UPDATE listings.listings SET featured_until = greatest(featured_until, $2::timestamptz) WHERE id = $1`, [listingId, endsAt]);
  }

  async ended(e: OutboxEvent): Promise<void> {
    const { listingId, endsAt } = e.payload as { listingId: string; endsAt: string };
    await this.db.query(`UPDATE listings.listings SET featured_until = NULL WHERE id = $1 AND featured_until <= $2::timestamptz`, [listingId, endsAt]);
  }
}
