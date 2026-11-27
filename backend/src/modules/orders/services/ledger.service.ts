import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { Problem } from '../../../kernel/http/problems';
import type { EntryKind } from '../db/enums';
import { Line, post } from './ledger';

// LedgerService (docs/design/02_orders_payments.pdf section 4.3, the component table of section 3; FR-PAY-13,
// FR-MON-09, DR-05): posts balanced journal entries, and answers balances and the revenue log.
//  - Posting is ledger.ts's post(), which the services that move money already call inside their own transactions.
//  - A balance is the sum of the lines on one account (and one party): debits positive, credits negative. A liability
//    such as seller_payable is therefore negative while the platform owes it; owed() turns it into the amount owed.
//  - The revenue log is the view payments.revenue_log: every line on a revenue_* account, kept separate from the
//    settlement records as FR-MON-09 asks. Revenue is shown positive.

export interface RevenueLine {
  entryId: string;
  createdAt: string;
  kind: EntryKind;
  orderId: string | null;
  account: string;
  revenue: string; // poisha
}

const DAY_MS = 86_400_000;
const PAGE_ENTRIES = 50;

@Injectable()
export class LedgerService {
  constructor(private readonly db: DataSource) {}

  /** Posts a set of balanced ledger lines for an order, in the caller's transaction. */
  post(m: EntityManager, kind: EntryKind, orderId: string | null, sourceId: string | null, memo: string, lines: Line[]): Promise<void> {
    return post(m, kind, orderId, sourceId, memo, lines);
  }

  /** The sum of the lines on an account, for one party or (partyId undefined) for all of them. */
  async balance(account: string, partyId?: string | null, m: EntityManager = this.db.manager): Promise<bigint> {
    const [row] = (await m.query(
      `SELECT coalesce(sum(amount), 0)::text AS s FROM payments.journal_lines
        WHERE account_code = $1 AND ($2::boolean OR party_id IS NOT DISTINCT FROM $3::uuid)`,
      [account, partyId === undefined, partyId ?? null],
    )) as { s: string }[];
    return BigInt(row.s);
  }

  /** What the platform owes a party on a liability account (seller_payable, buyer_refund_payable ...). */
  async owed(account: string, partyId: string, m?: EntityManager): Promise<bigint> {
    return -(await this.balance(account, partyId, m));
  }

  /**
   * GET /staff/payments/revenue-log (FR-MON-09): the revenue lines from `from` (inclusive) to `to` (exclusive),
   * newest entry first, with the total of each revenue account over the whole range; at most 366 days. A page holds
   * whole journal entries (about 100 lines); the cursor is the last entry's id (entry ids only grow).
   */
  async revenueLog(from: Date, to: Date, cursor?: string): Promise<{ items: RevenueLine[]; totals: Record<string, string>; nextCursor: string | null }> {
    if (!(from < to) || to.getTime() - from.getTime() > 366 * DAY_MS) {
      throw new Problem('validation-failed', { errors: [{ field: 'to', reason: 'range-1-to-366-days' }] });
    }
    if (cursor !== undefined && cursor !== '' && !/^[1-9]\d{0,17}$/.test(cursor)) {
      throw new Problem('validation-failed', { errors: [{ field: 'cursor', reason: 'format' }] });
    }
    const rows = (await this.db.query(
      `SELECT r.entry_id::text AS entry_id, r.created_at, r.kind, r.order_id, r.account_code, r.revenue::text AS revenue FROM payments.revenue_log r
        WHERE r.entry_id IN (SELECT DISTINCT entry_id FROM payments.revenue_log
                            WHERE created_at >= $1 AND created_at < $2 AND ($3::bigint IS NULL OR entry_id < $3::bigint)
                            ORDER BY entry_id DESC LIMIT $4)
        ORDER BY r.entry_id DESC, r.account_code`, // by the column, not the text output, where '99' sorts above '100'
      [from, to, cursor || null, PAGE_ENTRIES + 1],
    )) as { entry_id: string; created_at: Date; kind: EntryKind; order_id: string | null; account_code: string; revenue: string }[];
    const entries = [...new Set(rows.map((r) => r.entry_id))].sort((a, b) => (BigInt(b) > BigInt(a) ? 1 : -1)); // newest first, as numbers
    const more = entries.length > PAGE_ENTRIES;
    const page = more ? rows.filter((r) => r.entry_id !== entries[PAGE_ENTRIES]) : rows;
    const totals = (await this.db.query(
      `SELECT account_code, sum(revenue)::text AS total FROM payments.revenue_log
        WHERE created_at >= $1 AND created_at < $2 GROUP BY account_code ORDER BY account_code`,
      [from, to],
    )) as { account_code: string; total: string }[];
    return {
      items: page.map((r) => ({
        entryId: r.entry_id,
        createdAt: r.created_at.toISOString(),
        kind: r.kind,
        orderId: r.order_id,
        account: r.account_code,
        revenue: r.revenue,
      })),
      totals: Object.fromEntries(totals.map((t) => [t.account_code, t.total])),
      nextCursor: more ? entries[PAGE_ENTRIES - 1] : null,
    };
  }
}
