import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ACCOUNT_CLOSURE_CHECKS, AccountClosureCheck, AccountClosureChecks, ClosureStage } from '../../identity/ports';

// Unit 7's AccountClosureCheck (FR-ACC-11, FR-PRV-04; U1-09): a dispute in which the user is buyer or seller and that
// is not decided or withdrawn refuses the closure ('open-dispute') and holds the erasure, so the case can be decided
// with both parties' details.
@Injectable()
export class DisputesClosureCheck implements AccountClosureCheck, OnModuleInit {
  readonly name = 'disputes';

  constructor(
    private readonly db: DataSource,
    @Inject(ACCOUNT_CLOSURE_CHECKS) private readonly checks: AccountClosureChecks,
  ) {}

  onModuleInit(): void {
    this.checks.register(this);
  }

  async blockers(userId: string, _stage: ClosureStage, tx?: EntityManager): Promise<string[]> {
    const rows = (await (tx ?? this.db.manager).query(
      `SELECT 1 FROM disputes.disputes WHERE (buyer_id = $1 OR seller_id = $1) AND status NOT IN ('decided', 'withdrawn') LIMIT 1`,
      [userId],
    )) as unknown[];
    return rows.length ? ['open-dispute'] : [];
  }
}
