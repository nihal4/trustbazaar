import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { CONFIG_PORT, ConfigPort } from '../../../kernel/config-port';
import { Problem } from '../../../kernel/http/problems';
import { FileVault } from '../crypto/file-vault';
import type { AccountClosureCheck, AccountClosureChecks, ClosureStage } from '../ports';
import { AuditService } from './audit.service';
import { publish } from './outbox';
import { RequestContext, SessionService } from './session.service';

// Account closure and erasure (docs/design/01_identity_access.pdf section 6.10; FR-ACC-11, FR-PRV-04; U1-09).
//  - POST /me/close (step-up 'account.close'): Unit 1's own reason (a KYC submission under review) and every
//    registered AccountClosureCheck are asked why the account cannot close yet; any reason refuses the closure with
//    the reasons listed (account-not-closable). Otherwise one transaction sets closed, closed_at and
//    erase_after = closed_at + CP-41, ends every session, audits and writes identity.account.closed; the other units
//    stop processing for the user (Listings ends the active listings, Delivery forgets the addresses).
//  - The erasure job (daily): accounts past erase_after that no unit holds (the checks again, at the 'erasure' stage)
//    are erased by identity.erase_user, which empties the personal fields, removes MFA factors and the identity
//    claim and crypto-shreds the KYC data; the files' blobs are then deleted. An account held stays for the next run.
//    The same job erases KYC data rejected more than 30 days ago without a resubmission (identity.erase_rejected_kyc).

export interface ErasureRun {
  erased: number;
  held: number;
  rejectedKyc: number;
}

@Injectable()
export class ClosureService implements AccountClosureChecks {
  private readonly log = new Logger('ClosureService');
  private readonly checks: AccountClosureCheck[] = [];

  constructor(
    private readonly db: DataSource,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly vault: FileVault,
    @Inject(CONFIG_PORT) private readonly params: ConfigPort,
  ) {}

  /** Registers a check that decides whether an account may be closed; a unit registers each of its checks once. */
  register(check: AccountClosureCheck): void {
    if (this.checks.some((c) => c.name === check.name)) throw new Error(`closure check ${check.name} registered twice`);
    this.checks.push(check);
  }

  /** Every reason, from Unit 1 and the registered checks, sorted and without repeats. */
  async blockers(userId: string, stage: ClosureStage, m: EntityManager = this.db.manager): Promise<string[]> {
    const own = (await m.query(`SELECT 1 FROM identity.kyc_submissions WHERE user_id = $1 AND status = 'pending_review'`, [userId])) as unknown[];
    const reasons = own.length ? ['kyc-under-review'] : [];
    for (const c of this.checks) reasons.push(...(await c.blockers(userId, stage, m)));
    return [...new Set(reasons)].sort();
  }

  /** POST /me/close. */
  async close(userId: string, ctx: RequestContext): Promise<void> {
    const cp41 = (await this.params.current()).get<string>('CP-41');
    await this.db.transaction(async (m) => {
      const [u] = (await m.query(`SELECT account_status FROM identity.users WHERE id = $1 FOR UPDATE`, [userId])) as { account_status: string }[];
      if (!u || u.account_status === 'closed') throw new Problem('not-found');
      const reasons = await this.blockers(userId, 'closure', m);
      if (reasons.length) throw new Problem('account-not-closable', { errors: reasons.map((reason) => ({ field: 'account', reason })) });
      const [[{ erase_after }]] = (await m.query(
        `UPDATE identity.users SET account_status = 'closed', closed_at = now(), erase_after = now() + $2::interval, updated_at = now()
          WHERE id = $1 RETURNING erase_after`,
        [userId, cp41],
      )) as [{ erase_after: Date }[], number]; // UPDATE ... RETURNING answers [rows, count]
      await this.sessions.endAllIn(m, userId, null, 'closed', ctx);
      await this.audit.record(m, {
        actorType: 'user',
        actorId: userId,
        action: 'identity.account.closed',
        objectType: 'user',
        objectId: userId,
        before: { accountStatus: u.account_status },
        after: { accountStatus: 'closed', eraseAfter: erase_after },
        sourceIp: ctx.ip ?? null,
        correlationId: ctx.correlationId ?? null,
      });
      await publish(m, 'identity.account.closed', userId, { userId, eraseAfter: new Date(erase_after).toISOString() });
    });
  }

  /** The erasure job (FR-PRV-04). */
  async eraseDue(limit = 200): Promise<ErasureRun> {
    const due = (await this.db.query(
      `SELECT id FROM identity.users WHERE account_status = 'closed' AND erased_at IS NULL AND erase_after <= now() ORDER BY erase_after LIMIT $1`,
      [limit],
    )) as { id: string }[];
    const run: ErasureRun = { erased: 0, held: 0, rejectedKyc: 0 };
    for (const { id } of due) {
      const holds = await this.blockers(id, 'erasure');
      if (holds.length) {
        run.held++;
        this.log.log({ msg: 'erasure held', userId: id, holds });
        continue;
      }
      const keys = await this.db.transaction(async (m) => {
        const rows = (await m.query(`SELECT storage_key FROM identity.erase_user($1)`, [id])) as { storage_key: string }[];
        await this.audit.record(m, {
          actorType: 'system',
          action: 'identity.account.erased',
          objectType: 'user',
          objectId: id,
          after: { kycFiles: rows.length },
        });
        return rows.map((r) => r.storage_key);
      });
      await this.deleteBlobs(keys);
      run.erased++;
    }
    const rejected = (await this.db.query(`SELECT storage_key FROM identity.erase_rejected_kyc($1)`, [limit])) as { storage_key: string }[];
    await this.deleteBlobs(rejected.map((r) => r.storage_key));
    run.rejectedKyc = rejected.length;
    return run;
  }

  /** The data keys are already destroyed; a blob left behind by a failed delete is unreadable, and logged. */
  private async deleteBlobs(keys: string[]): Promise<void> {
    for (const k of keys) {
      await this.vault.erase('kyc', k).catch((e: Error) => this.log.warn({ msg: 'KYC blob not deleted (its key is destroyed)', storageKey: k, error: e }));
    }
  }
}
