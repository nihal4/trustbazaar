import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { Problem } from '../../../kernel/http/problems';
import { ListingStatusChange } from '../db/entities';
import type { ListingsCommands } from '../ports';
import { publish } from './outbox';

// ListingsCommands (docs/design/03_listings_auctions.pdf section 3.3): the staff decisions on a listing held for review
// (pending_review). approveForPublication and returnToDraft are added for Unit 5's ownership review (U5-02, agreed with
// the user); remove() and the staff review endpoints come with U3-08. Each change is written to status_history with
// the staff member and the reason, in the caller's transaction when given.
@Injectable()
export class ListingCommandsService implements ListingsCommands {
  constructor(private readonly db: DataSource) {}

  async approveForPublication(listingId: string, byStaffId: string, reason: string, tx?: EntityManager): Promise<void> {
    await this.within(tx, async (m) => {
      const l = await this.held(m, listingId);
      if (!l) throw new Problem('listing-state');
      await m.query(`UPDATE listings.listings SET status = 'active', published_at = now() WHERE id = $1`, [listingId]);
      if (l.sale_format === 'auction') {
        // a held auction takes no bids; its clock restarts at approval (Decisions log, U3-02)
        await m.query(
          `UPDATE auctions.auctions SET starts_at = now(), original_end_at = now() + (original_end_at - starts_at), end_at = now() + (original_end_at - starts_at)
            WHERE listing_id = $1 AND status = 'open' AND bid_count = 0`,
          [listingId],
        );
      }
      await this.history(m, listingId, 'active', byStaffId, reason);
      await publish(m, 'listings.listing.published', listingId, { listingId, sellerId: l.seller_id, itemKind: l.item_kind, saleFormat: l.sale_format });
    });
  }

  async returnToDraft(listingId: string, byStaffId: string, reason: string, tx?: EntityManager): Promise<boolean> {
    return this.within(tx, async (m) => {
      if (!(await this.held(m, listingId))) return false;
      await m.query(`UPDATE listings.listings SET status = 'draft' WHERE id = $1`, [listingId]);
      await this.history(m, listingId, 'draft', byStaffId, reason);
      return true;
    });
  }

  private async held(m: EntityManager, listingId: string) {
    const [l] = (await m.query(`SELECT seller_id, item_kind, sale_format, status FROM listings.listings WHERE id = $1 FOR UPDATE`, [listingId])) as
      { seller_id: string; item_kind: string; sale_format: string; status: string }[];
    return l?.status === 'pending_review' ? l : null;
  }

  private history(m: EntityManager, listingId: string, to: 'active' | 'draft', staffId: string, reason: string) {
    return m.getRepository(ListingStatusChange).insert({ listingId, fromStatus: 'pending_review', toStatus: to, actorType: 'staff', actorId: staffId, reason });
  }

  private within<T>(tx: EntityManager | undefined, fn: (m: EntityManager) => Promise<T>): Promise<T> {
    return tx ? fn(tx) : this.db.transaction(fn);
  }
}
