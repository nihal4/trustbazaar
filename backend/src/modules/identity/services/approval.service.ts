import { Inject, Injectable } from '@nestjs/common';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { CLOCK, Clock } from '../../../kernel/clock';
import { Problem } from '../../../kernel/http/problems';
import type { StaffRole } from '../db/enums';
import { AuditService } from './audit.service';
import { RequestContext } from './session.service';

// Four-eyes approvals for every unit (FR-OPS-05, CP-30; Unit 1 section 6.7). propose() writes the proposal
// with its expiry (DV-5); decide() records a second staff member's decision and, if approved, runs the
// handler registered for the action in the same transaction, then sets executed_at: the decision and its
// effect both happen or neither does. The database refuses self-approval and a second open proposal for the
// same action and target. Every proposal and decision is audited with the approval id (FR-OPS-07).
export const APPROVAL_EXPIRY_HOURS = 72; // DV-5

export interface ApprovalView {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  payload: Record<string, unknown>;
  reason: string;
  requiredRole: StaffRole;
  proposedBy: string;
  proposedAt: Date;
  expiresAt: Date;
  decidedBy: string | null;
  decidedAt: Date | null;
  decision: 'approved' | 'rejected' | 'expired' | null;
  decisionNote: string | null;
  executedAt: Date | null;
}

export interface Proposal {
  action: string;
  targetType: string;
  targetId: string;
  payload?: Record<string, unknown>;
  reason: string;
  requiredRole: StaffRole;
  byStaffId: string;
}

export type ApprovalHandler = (a: ApprovalView, tx: EntityManager, ctx: RequestContext) => Promise<void>;

const COLUMNS = `id, action, target_type, target_id, payload, reason, required_role, proposed_by, proposed_at, expires_at,
                 decided_by, decided_at, decision, decision_note, executed_at`;
const view = (r: Record<string, unknown>): ApprovalView => ({
  id: r.id as string,
  action: r.action as string,
  targetType: r.target_type as string,
  targetId: r.target_id as string,
  payload: r.payload as Record<string, unknown>,
  reason: r.reason as string,
  requiredRole: r.required_role as StaffRole,
  proposedBy: r.proposed_by as string,
  proposedAt: r.proposed_at as Date,
  expiresAt: r.expires_at as Date,
  decidedBy: r.decided_by as string | null,
  decidedAt: r.decided_at as Date | null,
  decision: r.decision as ApprovalView['decision'],
  decisionNote: r.decision_note as string | null,
  executedAt: r.executed_at as Date | null,
});
const rowsOf = <T>(result: unknown): T[] =>
  (Array.isArray(result) && Array.isArray(result[0]) && typeof result[1] === 'number' ? result[0] : result) as T[];
const isUniqueViolation = (e: unknown) => e instanceof QueryFailedError && (e as unknown as { code?: string }).code === '23505';

@Injectable()
export class ApprovalService {
  private readonly handlers = new Map<string, ApprovalHandler>();

  constructor(
    private readonly db: DataSource,
    private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Each four-eyes action has exactly one handler; units register theirs when their module starts. */
  registerHandler(action: string, handler: ApprovalHandler): void {
    if (this.handlers.has(action)) throw new Error(`approval handler for ${action} is already registered`);
    this.handlers.set(action, handler);
  }

  async propose(p: Proposal, ctx: RequestContext, tx?: EntityManager): Promise<ApprovalView> {
    if (!this.handlers.has(p.action)) throw new Error(`no approval handler for ${p.action}`);
    if (p.reason.trim().length < 10) throw new Problem('validation-failed', { errors: [{ field: 'reason', reason: 'at-least-10-characters' }] });
    const work = async (m: EntityManager) => {
      const now = this.clock.now();
      const [row] = await m.query(
        `INSERT INTO identity.approvals (action, target_type, target_id, payload, reason, required_role, proposed_by, proposed_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING ${COLUMNS}`,
        [p.action, p.targetType, p.targetId, JSON.stringify(p.payload ?? {}), p.reason.trim(), p.requiredRole, p.byStaffId, now,
         new Date(now.getTime() + APPROVAL_EXPIRY_HOURS * 3_600_000)],
      );
      await this.audit.record(m, {
        actorType: 'staff', actorId: p.byStaffId, action: 'staff.approval.proposed', objectType: p.targetType, objectId: p.targetId,
        after: { action: p.action, payload: p.payload ?? {} }, reason: p.reason.trim(), approvalId: row.id,
        sourceIp: ctx.ip, correlationId: ctx.correlationId,
      });
      return view(row);
    };
    try {
      return tx ? await work(tx) : await this.db.transaction(work);
    } catch (e) {
      if (isUniqueViolation(e)) throw new Problem('already-proposed');
      throw e;
    }
  }

  /** FR-OPS-05: a second staff member of the required role decides; an approval runs its handler at once. */
  async decide(id: string, by: { staffId: string; role: StaffRole }, decision: 'approved' | 'rejected', note: string | undefined, ctx: RequestContext): Promise<ApprovalView> {
    const outcome = await this.db.transaction(async (m): Promise<ApprovalView | 'expired'> => {
      const now = this.clock.now();
      const [row] = await m.query(`SELECT ${COLUMNS} FROM identity.approvals WHERE id = $1 FOR UPDATE`, [id]);
      if (!row) throw new Problem('not-found');
      const a = view(row);
      if (a.decision !== null) throw new Problem('approval-closed');
      if (a.expiresAt <= now) {
        await this.expireIn(m, a.id, now); // committed, then refused below
        return 'expired';
      }
      if (a.proposedBy === by.staffId) throw new Problem('own-proposal');
      if (a.requiredRole !== by.role) throw new Problem('forbidden');

      const [decided] = rowsOf<Record<string, unknown>>(
        await m.query(
          `UPDATE identity.approvals SET decided_by = $2, decided_at = $3, decision = $4, decision_note = $5 WHERE id = $1 RETURNING ${COLUMNS}`,
          [id, by.staffId, now, decision, note?.trim() || null],
        ),
      );
      let result = view(decided);
      if (decision === 'approved') {
        const handler = this.handlers.get(a.action);
        if (!handler) throw new Error(`no approval handler for ${a.action}`);
        await handler(result, m, ctx);
        const [executed] = rowsOf<Record<string, unknown>>(
          await m.query(`UPDATE identity.approvals SET executed_at = $2 WHERE id = $1 RETURNING ${COLUMNS}`, [id, now]),
        );
        result = view(executed);
      }
      await this.audit.record(m, {
        actorType: 'staff', actorId: by.staffId, action: `staff.approval.${decision}`, objectType: a.targetType, objectId: a.targetId,
        before: { proposedBy: a.proposedBy, action: a.action }, after: { decision, executed: result.executedAt !== null },
        reason: note?.trim() || null, approvalId: a.id, sourceIp: ctx.ip, correlationId: ctx.correlationId,
      });
      return result;
    });
    if (outcome === 'expired') throw new Problem('approval-closed');
    return outcome;
  }

  /** The open proposals a staff member may decide: their role, not their own, not expired. */
  async openFor(staffId: string, role: StaffRole): Promise<ApprovalView[]> {
    const rows = await this.db.query(
      `SELECT ${COLUMNS} FROM identity.approvals
       WHERE decision IS NULL AND required_role = $1 AND proposed_by <> $2 AND expires_at > $3
       ORDER BY proposed_at LIMIT 200`,
      [role, staffId, this.clock.now()],
    );
    return rows.map(view);
  }

  /** DV-5: marks proposals past their expiry as expired. Run by the job runner (K-05); returns how many. */
  async expireStale(): Promise<number> {
    return this.db.transaction(async (m) => {
      const now = this.clock.now();
      const stale: { id: string }[] = await m.query(
        `SELECT id FROM identity.approvals WHERE decision IS NULL AND expires_at <= $1 FOR UPDATE SKIP LOCKED`,
        [now],
      );
      for (const s of stale) await this.expireIn(m, s.id, now);
      return stale.length;
    });
  }

  private async expireIn(m: EntityManager, id: string, now: Date): Promise<void> {
    await m.query(`UPDATE identity.approvals SET decision = 'expired', decided_at = $2 WHERE id = $1 AND decision IS NULL`, [id, now]);
    await this.audit.record(m, { actorType: 'system', action: 'staff.approval.expired', objectType: 'approval', objectId: id, approvalId: id });
  }
}
