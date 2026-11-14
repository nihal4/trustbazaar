import { Inject, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { CLOCK, Clock } from '../../../kernel/clock';
import { CONFIG_PORT, ConfigPort } from '../../../kernel/config-port';
import { Problem } from '../../../kernel/http/problems';
import {
  AUDIT_SERVICE, AuditServicePort, CallContext, IDENTITY_COMMANDS, IdentityCommands, IDENTITY_QUERY, IdentityQuery, STAFF_QUERY, StaffQuery,
} from '../../identity/ports';
import type { SanctionKind } from '../db/enums';
import type { Restrictions, SanctionPort } from '../ports';

// Sanctions and seller strikes (docs/design/07_disputes_trust_staff.pdf sections 6.3 and 6.4; FR-TNS-03, FR-TNS-04,
// FR-TNS-05; U7-04).
//  - An operator applies one of the sanctions of FR-TNS-03 with a reason, and an end or "until review". An account
//    suspension also suspends the account in Unit 1 (sessions end) in the same transaction. The fraud flag (any
//    suspension) holds the user's payouts (Unit 2). Listing removal needs Unit 3's ListingsCommands (U3-08): until
//    then it answers feature-off.
//  - A sanction is never edited: shortening or ending it is a lift, with a reason. Lifting an account suspension
//    needs four-eyes approval (CP-30): it proposes Unit 1's account.reinstate, and the sanction is lifted when
//    Unit 1 reinstates the account (identity.account.reinstated).
//  - SanctionPort answers from trust.restrictions over the live sanctions; expired ones stop counting by themselves.
//  - Strikes (FR-TNS-04) are recorded by trust.record_strike, which suspends selling automatically, once, at CP-47.

const SUSPENSIONS: readonly SanctionKind[] = ['selling_suspended', 'buying_suspended', 'account_suspended'];
export type RelatedType = 'report' | 'dispute' | 'signal';

interface SanctionRow { id: string; user_id: string; kind: SanctionKind; lifted_at: Date | null }

@Injectable()
export class SanctionService implements SanctionPort {
  constructor(
    private readonly db: DataSource,
    @Inject(IDENTITY_COMMANDS) private readonly identity: IdentityCommands,
    @Inject(IDENTITY_QUERY) private readonly users: IdentityQuery,
    @Inject(STAFF_QUERY) private readonly staff: StaffQuery,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditServicePort,
    @Inject(CONFIG_PORT) private readonly params: ConfigPort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** SanctionPort (Unit 1's assertCanTransact and @Verified, I-43). */
  async restrictions(userId: string): Promise<Restrictions> {
    const [r] = (await this.db.query(`SELECT can_sell, can_buy_bid, fraud_hold FROM trust.restrictions($1)`, [userId])) as { can_sell: boolean; can_buy_bid: boolean; fraud_hold: boolean }[];
    return { canSell: r.can_sell, canBuyBid: r.can_buy_bid, fraudHold: r.fraud_hold };
  }

  /** POST /staff/users/{id}/sanctions (FR-TNS-03). */
  async apply(
    staffId: string, userId: string,
    a: { kind: SanctionKind; reason: string; endsAt?: Date | null; fraud?: boolean; related?: { type: RelatedType; id: string } },
    ctx: CallContext = {},
  ): Promise<{ sanctionId: string }> {
    const reason = a.reason.normalize('NFC').trim();
    const endsAt = a.endsAt ?? null;
    const fraud = a.fraud === true;
    if (a.kind === 'listing_removal') throw new Problem('feature-off', { errors: [{ field: 'kind', reason: 'listing-removal-not-yet-available' }] });
    if (reason.length < 10) throw new Problem('validation-failed', { errors: [{ field: 'reason', reason: 'too-short' }] });
    if (a.kind === 'warning' && endsAt) throw new Problem('validation-failed', { errors: [{ field: 'endsAt', reason: 'warning-has-no-end' }] });
    if (endsAt && endsAt <= this.clock.now()) throw new Problem('validation-failed', { errors: [{ field: 'endsAt', reason: 'in-the-past' }] });
    if (fraud && !SUSPENSIONS.includes(a.kind)) throw new Problem('validation-failed', { errors: [{ field: 'fraud', reason: 'suspensions-only' }] });
    await this.users.getPublicProfile(userId); // not-found for an unknown user
    await this.staff.assertNoConflict(staffId, [userId]);
    return this.db.transaction(async (m) => {
      const [{ id }] = (await m.query(
        `INSERT INTO trust.sanctions (user_id, kind, reason, fraud, ends_at, created_by, related_type, related_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [userId, a.kind, reason, fraud, endsAt, staffId, a.related?.type ?? null, a.related?.id ?? null],
      )) as { id: string }[];
      if (a.kind === 'account_suspended') await this.identity.suspendAccount(userId, reason, staffId, { fraud, ctx, tx: m, sanctionId: id });
      await this.audit.record({
        actorType: 'staff', actorId: staffId, action: 'trust.sanction.applied', objectType: 'user', objectId: userId,
        after: { sanctionId: id, kind: a.kind, fraud, endsAt: endsAt?.toISOString() ?? null }, reason, sourceIp: ctx.ip ?? null, correlationId: ctx.correlationId ?? null,
      }, m);
      await this.publish(m, 'trust.sanction.applied', userId, { userId, sanctionId: id, kind: a.kind, reason, fraud, endsAt: endsAt?.toISOString() ?? null, automatic: false });
      return { sanctionId: id };
    });
  }

  /**
   * DELETE /staff/users/{id}/sanctions: lifts a live suspension with a reason. An account suspension is not lifted
   * here: four-eyes approval of Unit 1's account.reinstate is proposed, and the lift follows the reinstatement.
   */
  async lift(staffId: string, userId: string, sanctionId: string, liftReason: string, ctx: CallContext = {}): Promise<{ sanctionId: string; status: 'lifted' | 'proposed'; approvalId?: string }> {
    const reason = liftReason.normalize('NFC').trim();
    if (reason.length < 10) throw new Problem('validation-failed', { errors: [{ field: 'reason', reason: 'too-short' }] });
    const [s] = (await this.db.query(`SELECT id, user_id, kind, lifted_at FROM trust.sanctions WHERE id = $1 AND user_id = $2`, [sanctionId, userId])) as SanctionRow[];
    if (!s || s.lifted_at) throw new Problem('not-found');
    if (!SUSPENSIONS.includes(s.kind)) throw new Problem('validation-failed', { errors: [{ field: 'sanctionId', reason: 'not-liftable' }] }); // a warning is a record
    await this.staff.assertNoConflict(staffId, [userId]);
    if (s.kind === 'account_suspended') {
      const approval = await this.identity.proposeReinstatement(userId, reason, staffId, ctx); // CP-30
      return { sanctionId, status: 'proposed', approvalId: approval.id };
    }
    await this.db.transaction(async (m) => {
      const rows = (await m.query(
        `UPDATE trust.sanctions SET lifted_at = now(), lifted_by = $2, lift_reason = $3 WHERE id = $1 AND lifted_at IS NULL RETURNING id`, [sanctionId, staffId, reason],
      )) as unknown[];
      if ((Array.isArray(rows[0]) ? rows[0] : rows).length === 0) throw new Problem('not-found'); // lifted meanwhile
      await this.audit.record({
        actorType: 'staff', actorId: staffId, action: 'trust.sanction.lifted', objectType: 'user', objectId: userId,
        after: { sanctionId, kind: s.kind }, reason, sourceIp: ctx.ip ?? null, correlationId: ctx.correlationId ?? null,
      }, m);
      await this.publish(m, 'trust.sanction.lifted', userId, { userId, sanctionId, kind: s.kind });
    });
    return { sanctionId, status: 'lifted' };
  }

  /** identity.account.reinstated (CP-30 approved): the live account suspensions are lifted with that approval. */
  async onReinstated(p: { userId: string; approvalId: string; decidedBy?: string | null; reason?: string | null }): Promise<number> {
    if (!p.decidedBy) throw new Error(`identity.account.reinstated for ${p.userId}: no decidedBy`); // retried, then reported (K-04)
    const reason = (p.reason ?? '').trim().length >= 10 ? (p.reason as string).trim() : 'Account reinstated after four-eyes approval';
    return this.db.transaction(async (m) => {
      const rows = (await m.query(
        `UPDATE trust.sanctions SET lifted_at = now(), lifted_by = $2, lift_reason = $3, lift_approval_id = $4
          WHERE user_id = $1 AND kind = 'account_suspended' AND lifted_at IS NULL RETURNING id`,
        [p.userId, p.decidedBy, reason, p.approvalId],
      )) as unknown[];
      const lifted = (Array.isArray(rows[0]) ? rows[0] : rows) as { id: string }[];
      for (const { id } of lifted) await this.publish(m, 'trust.sanction.lifted', p.userId, { userId: p.userId, sanctionId: id, kind: 'account_suspended' });
      return lifted.length;
    });
  }

  /** FR-TNS-04: a strike, once per order and reason; at CP-47 strikes in its window, selling is suspended (once). */
  async strike(sellerId: string, reason: 'unilateral_cancel' | 'missed_deadline' | 'dispute_lost', orderId: string): Promise<boolean> {
    const cp = (await this.params.current()).get<{ strikes: number; window: string }>('CP-47');
    const [{ suspended }] = (await this.db.query(
      `SELECT trust.record_strike($1, $2, $3, $4::interval, $5) AS suspended`, [sellerId, reason, orderId, cp.window, cp.strikes],
    )) as { suspended: boolean }[];
    return suspended;
  }

  private async publish(m: EntityManager, type: string, userId: string, payload: Record<string, unknown>): Promise<void> {
    await m.query(`INSERT INTO disputes.outbox (event_type, aggregate_id, payload) VALUES ($1, $2, $3)`, [type, userId, JSON.stringify(payload)]);
  }
}
