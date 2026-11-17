import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ACCOUNT_CLOSURE_CHECKS, AccountClosureCheck, AccountClosureChecks, ClosureStage } from '../../identity/ports';

// Unit 2's AccountClosureCheck (docs/design/01_identity_access.pdf section 4.4; FR-ACC-11, FR-PRV-04; U1-09).
//  - Closure: an order as buyer or seller that is not closed or cancelled ('open-order'; an auction win not yet paid
//    is such an order), and a balance the user owes the platform on the ledger (seller_receivable, 'balance-owed').
//  - Erasure: the same, and money still to reach the user: a payout not yet sent ('payout-pending') or a refund not
//    yet completed ('refund-pending'). The settlement records themselves are kept (SRS Table 7.2).
@Injectable()
export class OrdersClosureCheck implements AccountClosureCheck, OnModuleInit {
  readonly name = 'orders';

  constructor(
    private readonly db: DataSource,
    @Inject(ACCOUNT_CLOSURE_CHECKS) private readonly checks: AccountClosureChecks,
  ) {}

  onModuleInit(): void {
    this.checks.register(this);
  }

  async blockers(userId: string, stage: ClosureStage, tx?: EntityManager): Promise<string[]> {
    const [r] = (await (tx ?? this.db.manager).query(
      `SELECT EXISTS (SELECT 1 FROM orders.orders WHERE (buyer_id = $1 OR seller_id = $1) AND status IN ('awaiting_payment', 'paid')) AS open_order,
              (SELECT coalesce(sum(amount), 0) FROM payments.journal_lines WHERE account_code = 'seller_receivable' AND party_id = $1) > 0 AS owed,
              EXISTS (SELECT 1 FROM payments.payouts WHERE seller_id = $1 AND status <> 'sent') AS payout,
              EXISTS (SELECT 1 FROM payments.refunds f JOIN payments.attempts a ON a.id = f.attempt_id
                       WHERE a.payer_id = $1 AND f.status NOT IN ('succeeded')) AS refund`,
      [userId],
    )) as { open_order: boolean; owed: boolean; payout: boolean; refund: boolean }[];
    const reasons: string[] = [];
    if (r.open_order) reasons.push('open-order');
    if (r.owed) reasons.push('balance-owed');
    if (stage === 'erasure') {
      if (r.payout) reasons.push('payout-pending');
      if (r.refund) reasons.push('refund-pending');
    }
    return reasons;
  }
}
