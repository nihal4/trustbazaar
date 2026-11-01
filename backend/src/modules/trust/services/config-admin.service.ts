import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { Problem } from '../../../kernel/http/problems';
import {
  Approval, APPROVAL_SERVICE, ApprovalServicePort, AUDIT_SERVICE, AuditServicePort, CallContext,
} from '../../identity/ports';
import { ConfigService } from './config.service';

// Parameter changes by administrators (Unit 7 section "Parameters and Feature Switches"; FR-OPS-03,
// FR-OPS-08, FR-OPS-09, SEC-IRM-04). A change publishes a new version: the previous values with the changes
// applied; versions are never edited. staff.config_violations checks the whole candidate set against every
// rule of the SRS table and all broken rules are reported together. Switches, CP-30 and CP-36 change only
// through an approved proposal (four-eyes); its handler publishes with the approval. Every publication is
// audited with the values before and after.
export const FOUR_EYES_CODES = (code: string) => code.startsWith('SW-') || code === 'CP-30' || code === 'CP-36';

export interface ConfigVersionView {
  version: number;
  createdBy: string | null;
  reason: string;
  approvalId: string | null;
  createdAt: Date;
}

const isDbRuleError = (e: unknown) =>
  e instanceof QueryFailedError && ['23514', '22007', '22P02', '22023'].includes((e as unknown as { code?: string }).code ?? '');

@Injectable()
export class ConfigAdminService implements OnModuleInit {
  constructor(
    private readonly db: DataSource,
    private readonly config: ConfigService,
    @Inject(APPROVAL_SERVICE) private readonly approvals: ApprovalServicePort,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditServicePort,
  ) {}

  onModuleInit(): void {
    // CP-30 'emergency.control' for the switches; 'config.publish' for CP-30 and CP-36 themselves.
    for (const action of ['emergency.control', 'config.publish']) {
      this.approvals.registerHandler(action, async (a, tx) => {
        const changes = (a.payload as { changes: Record<string, unknown> }).changes;
        await this.publishIn(tx, changes, a.proposedBy, a.reason, a.id, { approvedBy: a.decidedBy });
      });
    }
  }

  async currentSet(): Promise<{ version: number; values: Record<string, unknown> }> {
    const [{ version }] = await this.db.query(`SELECT staff.current_config_version() AS version`);
    const [{ set }] = await this.db.query(`SELECT staff.config_as_json($1) AS set`, [version]);
    return { version, values: set };
  }

  async versions(): Promise<ConfigVersionView[]> {
    const rows = await this.db.query(
      `SELECT version, created_by, reason, approval_id, created_at FROM staff.config_versions ORDER BY version DESC LIMIT 200`,
    );
    return rows.map((r: Record<string, unknown>) => ({
      version: r.version as number, createdBy: r.created_by as string | null, reason: r.reason as string,
      approvalId: r.approval_id as string | null, createdAt: r.created_at as Date,
    }));
  }

  /** FR-OPS-09: every broken rule of the candidate set, without publishing. */
  async violations(changes: Record<string, unknown>): Promise<string[]> {
    const { values } = await this.currentSet();
    const unknown = Object.keys(changes).filter((k) => !(k in values)).map((k) => `unknown parameter ${k}`);
    if (unknown.length) return unknown;
    try {
      const [{ bad }] = await this.db.query(`SELECT staff.config_violations($1::jsonb || $2::jsonb, $1::jsonb) AS bad`, [
        JSON.stringify(values), JSON.stringify(changes),
      ]);
      return bad as string[];
    } catch (e) {
      if (isDbRuleError(e)) return ['a value has the wrong form (for example "15 minutes" for a duration)'];
      throw e;
    }
  }

  /** FR-OPS-03: a change without four-eyes items; returns the new version. */
  async publish(changes: Record<string, unknown>, byStaffId: string, reason: string, ctx?: CallContext): Promise<{ version: number }> {
    const guarded = Object.keys(changes).filter(FOUR_EYES_CODES);
    if (guarded.length) throw new Problem('four-eyes-required', { errors: guarded.map((code) => ({ field: code, reason: 'four-eyes' })) });
    return this.db.transaction(async (m) => ({ version: await this.publishIn(m, changes, byStaffId, reason, null, { ctx }) }));
  }

  /** SEC-IRM-04: switches, CP-30 and CP-36 are proposed; a second administrator's approval publishes them. */
  async propose(changes: Record<string, unknown>, byStaffId: string, reason: string, ctx?: CallContext): Promise<Approval> {
    await this.check(changes);
    const action = Object.keys(changes).some((k) => k.startsWith('SW-')) ? 'emergency.control' : 'config.publish';
    return this.approvals.propose(
      { action, targetType: 'config', targetId: '00000000-0000-0000-0000-00000000c0f1', payload: { changes }, reason, requiredRole: 'administrator', byStaffId },
      ctx,
    );
  }

  private async check(changes: Record<string, unknown>): Promise<void> {
    if (Object.keys(changes).length === 0) throw new Problem('validation-failed', { errors: [{ field: 'changes', reason: 'empty' }] });
    const bad = await this.violations(changes);
    if (bad.length) throw new Problem('config-invalid', { errors: bad.map((rule) => ({ rule })) });
  }

  private async publishIn(
    m: EntityManager,
    changes: Record<string, unknown>,
    byStaffId: string,
    reason: string,
    approvalId: string | null,
    o: { ctx?: CallContext; approvedBy?: string | null },
  ): Promise<number> {
    await this.check(changes);
    const [{ set: before }] = await m.query(`SELECT staff.config_as_json(staff.current_config_version()) AS set`);
    let version: number;
    try {
      [{ version }] = await m.query(`SELECT staff.publish_config($1::jsonb, $2, $3, $4) AS version`, [JSON.stringify(changes), byStaffId, reason, approvalId]);
    } catch (e) {
      if (isDbRuleError(e)) throw new Problem('config-invalid', { errors: [{ rule: 'the database refused the set; check the values and try again' }] });
      throw e;
    }
    const changed = Object.keys(changes);
    await this.audit.record(
      {
        actorType: 'staff', actorId: o.approvedBy ?? byStaffId, action: 'staff.config.published', objectType: 'config_version',
        before: Object.fromEntries(changed.map((k) => [k, before[k]])), after: { version, ...changes }, reason, approvalId,
        sourceIp: o.ctx?.ip ?? null, correlationId: o.ctx?.correlationId ?? null,
      },
      m,
    );
    this.config.invalidate();
    return version;
  }
}
