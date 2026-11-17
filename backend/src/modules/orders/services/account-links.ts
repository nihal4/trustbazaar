import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { AccountLink, AccountLinkSource, LinkVia } from '../../../kernel/links/account-links';

// FR-TNS-08 (U7-09): accounts paid out to the same wallet number or the same bank account (its blind index), at any
// time: a replaced payout account still counts. Payment instruments join with the real providers (U2-09).
const SHARED = `
  SELECT 'payout_wallet' AS via, a.user_id AS first_user, b.user_id AS later_user, b.created_at
    FROM payments.payout_accounts a
    JOIN payments.payout_accounts b ON b.wallet_e164 = a.wallet_e164 AND b.user_id <> a.user_id
                                   AND (a.created_at, a.id) < (b.created_at, b.id)
  UNION ALL
  SELECT 'payout_bank', a.user_id, b.user_id, b.created_at
    FROM payments.payout_accounts a
    JOIN payments.payout_accounts b ON b.account_number_bidx = a.account_number_bidx AND b.user_id <> a.user_id
                                   AND (a.created_at, a.id) < (b.created_at, b.id)`;

@Injectable()
export class PayoutLinks implements AccountLinkSource {
  constructor(private readonly db: DataSource) {}

  async pairs(): Promise<AccountLink[]> {
    const rows = (await this.db.query(
      `SELECT via, later_user, first_user, min(created_at) AS at FROM (${SHARED}) s GROUP BY via, later_user, first_user ORDER BY 4, 2, 3`,
    )) as { via: LinkVia; later_user: string; first_user: string; at: Date }[];
    return rows.map((r) => ({ via: r.via, userId: r.later_user, linkedTo: r.first_user, at: r.at }));
  }

  async linkedTo(userId: string, others: string[]): Promise<{ userId: string; via: LinkVia }[]> {
    if (others.length === 0) return [];
    const rows = (await this.db.query(
      `SELECT DISTINCT o.user_id, CASE WHEN o.wallet_e164 = u.wallet_e164 THEN 'payout_wallet' ELSE 'payout_bank' END AS via
         FROM payments.payout_accounts u
         JOIN payments.payout_accounts o ON (o.wallet_e164 = u.wallet_e164 OR o.account_number_bidx = u.account_number_bidx)
        WHERE u.user_id = $1 AND o.user_id = ANY($2::uuid[]) AND o.user_id <> $1 ORDER BY 1, 2`,
      [userId, others],
    )) as { user_id: string; via: LinkVia }[];
    return rows.map((r) => ({ userId: r.user_id, via: r.via }));
  }
}
