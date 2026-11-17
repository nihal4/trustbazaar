import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { AccountLinkSource } from '../../../kernel/links/account-links';
import { IDENTITY_ACCOUNT_LINKS } from '../../identity/ports';
import { ORDERS_ACCOUNT_LINKS, ORDERS_PORT, OrdersPort } from '../../orders/ports';
import { DisputeQueries } from '../ports';

// FR-TNS-08 (docs/design/07_disputes_trust_staff.pdf sections 6.2 and 8; U7-09): the daily linked-account check. Every
// pair of accounts that share a browser (Unit 1) or a payout wallet or bank account (Unit 2) becomes one
// linked_accounts signal per pair and kind, about the account that came second; a pair already signalled, reviewed or
// not, is not raised again. Payment instruments join with the real providers (U2-09). It also answers Unit 3's
// DisputeQueries, the disputed sales its relisting flag compares a new listing with (FR-TNS-02).
@Injectable()
export class LinkedAccountsService implements DisputeQueries {
  private readonly log = new Logger('LinkedAccounts');

  constructor(
    private readonly db: DataSource,
    @Inject(IDENTITY_ACCOUNT_LINKS) private readonly devices: AccountLinkSource,
    @Inject(ORDERS_ACCOUNT_LINKS) private readonly payouts: AccountLinkSource,
    @Inject(ORDERS_PORT) private readonly orders: OrdersPort,
  ) {}

  /** The job: returns the signals raised. */
  async check(): Promise<number> {
    let raised = 0;
    for (const source of [this.devices, this.payouts]) {
      for (const l of await source.pairs()) {
        const [a, b] = [l.userId, l.linkedTo].sort();
        const rows = (await this.db.query(
          `INSERT INTO trust.signals (kind, source_ref, subject_user, detail) VALUES ('linked_accounts', $1, $2, $3)
           ON CONFLICT ON CONSTRAINT signal_once DO NOTHING RETURNING id`,
          [`${l.via}:${a}:${b}`, l.userId, JSON.stringify({ via: l.via, userId: l.userId, linkedTo: l.linkedTo, since: l.at.toISOString() })],
        )) as unknown[];
        raised += rows.length;
      }
    }
    if (raised > 0) this.log.log(`${raised} linked-account signals raised`);
    return raised;
  }

  /** DisputeQueries (FR-TNS-02): the listings of the seller's orders disputed in the window, newest first. */
  async disputedListings(sellerId: string, withinDays: number): Promise<string[]> {
    const rows = (await this.db.query(
      `SELECT DISTINCT ON (order_id) order_id, opened_at FROM disputes.disputes
        WHERE seller_id = $1 AND opened_at > now() - make_interval(days => $2) ORDER BY order_id, opened_at DESC`,
      [sellerId, withinDays],
    )) as { order_id: string; opened_at: Date }[];
    rows.sort((x, y) => y.opened_at.getTime() - x.opened_at.getTime());
    const listings: string[] = [];
    for (const r of rows) {
      const o = await this.orders.getOrderForParty(r.order_id, sellerId);
      if (!listings.includes(o.listing.id)) listings.push(o.listing.id);
    }
    return listings;
  }
}
