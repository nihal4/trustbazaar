import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { CLOCK, Clock } from '../../../kernel/clock';
import { Problem } from '../../../kernel/http/problems';
import { PasswordHasher } from '../crypto/password';
import type { StaffRole } from '../db/enums';
import { ApprovalService, ApprovalView } from './approval.service';
import { AuditService } from './audit.service';
import { bangladeshiMobile } from './phone';
import { RequestContext, SessionService } from './session.service';

// Staff accounts (Unit 1 section 6.8; FR-OPS-03, FR-OPS-04, FR-OPS-06). Only an administrator creates staff:
// the account starts in pending_mfa with a generated password, shown once to that administrator and handed
// over in person. Disabling ends the account's sessions. Resetting a staff member's MFA is the four-eyes
// action staff.mfa_reset: once a second administrator approves, the factor is removed, the sessions end and
// the account is back in pending_mfa. Conflicts of interest (FR-OPS-06): declared ones, and any user with the
// staff member's own mobile number or e-mail (the NID comparison joins when KYC claims exist, U1-06).
export interface StaffSummary {
  id: string;
  email: string;
  displayName: string;
  role: StaffRole;
  status: string;
  createdAt: Date;
  createdBy: string | null;
  disabledAt: Date | null;
}

export interface NewStaff {
  email: string;
  displayName: string;
  role: StaffRole;
  phone?: string;
}

const summary = (r: Record<string, unknown>): StaffSummary => ({
  id: r.id as string,
  email: r.email as string,
  displayName: r.display_name as string,
  role: r.role as StaffRole,
  status: r.status as string,
  createdAt: r.created_at as Date,
  createdBy: r.created_by as string | null,
  disabledAt: r.disabled_at as Date | null,
});
const rowsOf = <T>(result: unknown): T[] =>
  (Array.isArray(result) && Array.isArray(result[0]) && typeof result[1] === 'number' ? result[0] : result) as T[];
const isUniqueViolation = (e: unknown) => e instanceof QueryFailedError && (e as unknown as { code?: string }).code === '23505';

/** A generated first password: 128 random bits, readable in four groups. */
export const initialPassword = () => randomBytes(16).toString('base64url').replace(/(.{6})(?=.)/g, '$1-');

@Injectable()
export class StaffService implements OnModuleInit {
  constructor(
    private readonly db: DataSource,
    private readonly sessions: SessionService,
    private readonly passwords: PasswordHasher,
    private readonly approvals: ApprovalService,
    private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    this.approvals.registerHandler('staff.mfa_reset', (a, m, ctx) => this.resetMfaIn(m, a, ctx));
  }

  async list(): Promise<StaffSummary[]> {
    const rows = await this.db.query(
      `SELECT id, email, display_name, role, status, created_at, created_by, disabled_at FROM identity.staff_accounts ORDER BY created_at`,
    );
    return rows.map(summary);
  }

  /** FR-OPS-04: an administrator creates a staff account; the first password is returned once. */
  async create(byStaffId: string, n: NewStaff, ctx: RequestContext): Promise<{ staff: StaffSummary; initialPassword: string }> {
    const phone = n.phone ? bangladeshiMobile(n.phone) : null;
    if (n.phone && !phone) throw new Problem('validation-failed', { errors: [{ field: 'phone', reason: 'not-bangladeshi-mobile' }] });
    const password = initialPassword();
    const hash = await this.passwords.hash(password);
    try {
      return await this.db.transaction(async (m) => {
        const [row] = await m.query(
          `INSERT INTO identity.staff_accounts (email, display_name, role, status, password_hash, phone_e164, created_by, created_at)
           VALUES ($1, $2, $3, 'pending_mfa', $4, $5, $6, $7)
           RETURNING id, email, display_name, role, status, created_at, created_by, disabled_at`,
          [n.email.trim().toLowerCase(), n.displayName.trim(), n.role, hash, phone, byStaffId, this.clock.now()],
        );
        await this.audit.record(m, {
          actorType: 'staff', actorId: byStaffId, action: 'staff.account.created', objectType: 'staff', objectId: row.id,
          after: { email: row.email, role: row.role, status: row.status }, sourceIp: ctx.ip, correlationId: ctx.correlationId,
        });
        return { staff: summary(row), initialPassword: password };
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new Problem('contact-unavailable');
      throw e;
    }
  }

  /** Disabling ends every session of the account at once (SEC-SES-05). An administrator cannot disable themself. */
  async disable(byStaffId: string, staffId: string, reason: string, ctx: RequestContext): Promise<StaffSummary> {
    if (byStaffId === staffId) throw new Problem('forbidden');
    return this.db.transaction(async (m) => {
      const now = this.clock.now();
      const [before] = await m.query(`SELECT status FROM identity.staff_accounts WHERE id = $1 FOR UPDATE`, [staffId]);
      if (!before) throw new Problem('not-found');
      if (before.status === 'disabled') throw new Problem('approval-closed');
      const [row] = rowsOf<Record<string, unknown>>(await m.query(
        `UPDATE identity.staff_accounts SET status = 'disabled', disabled_at = $2, disabled_by = $3 WHERE id = $1
         RETURNING id, email, display_name, role, status, created_at, created_by, disabled_at`,
        [staffId, now, byStaffId],
      ));
      await this.sessions.endAllStaffIn(m, staffId, 'staff_disabled', byStaffId, ctx);
      await this.audit.record(m, {
        actorType: 'staff', actorId: byStaffId, action: 'staff.account.disabled', objectType: 'staff', objectId: staffId,
        before: { status: before.status }, after: { status: 'disabled' }, reason, sourceIp: ctx.ip, correlationId: ctx.correlationId,
      });
      return summary(row);
    });
  }

  /** FR-OPS-03: an MFA reset is proposed; a second administrator approves it (staff.mfa_reset). */
  proposeMfaReset(byStaffId: string, staffId: string, reason: string, ctx: RequestContext): Promise<ApprovalView> {
    return this.approvals.propose(
      { action: 'staff.mfa_reset', targetType: 'staff', targetId: staffId, reason, requiredRole: 'administrator', byStaffId },
      ctx,
    );
  }

  /** FR-OPS-06: a declared conflict of interest with a user. */
  async declareConflict(staffId: string, userId: string, reason: string, ctx: RequestContext): Promise<void> {
    await this.db.transaction(async (m) => {
      const [u] = await m.query(`SELECT 1 FROM identity.users WHERE id = $1`, [userId]);
      if (!u) throw new Problem('not-found');
      await m.query(
        `INSERT INTO identity.staff_conflicts (staff_id, user_id, reason, declared_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (staff_id, user_id) DO UPDATE SET reason = EXCLUDED.reason`,
        [staffId, userId, reason.trim(), this.clock.now()],
      );
      await this.audit.record(m, {
        actorType: 'staff', actorId: staffId, action: 'staff.conflict.declared', objectType: 'user', objectId: userId,
        reason: reason.trim(), sourceIp: ctx.ip, correlationId: ctx.correlationId,
      });
    });
  }

  /** FR-OPS-06: true if the staff member may not act on cases involving this user. */
  async hasConflict(staffId: string, userId: string): Promise<boolean> {
    const [r] = await this.db.query(
      `SELECT EXISTS (SELECT 1 FROM identity.staff_conflicts WHERE staff_id = $1 AND user_id = $2)
           OR EXISTS (SELECT 1 FROM identity.staff_accounts s JOIN identity.users u ON u.id = $2
                      WHERE s.id = $1 AND (u.email = s.email OR (s.phone_e164 IS NOT NULL AND u.phone_e164 = s.phone_e164))) AS conflict`,
      [staffId, userId],
    );
    return r.conflict === true;
  }

  private async resetMfaIn(m: EntityManager, a: ApprovalView, ctx: RequestContext): Promise<void> {
    const now = this.clock.now();
    const [s] = await m.query(`SELECT status FROM identity.staff_accounts WHERE id = $1 FOR UPDATE`, [a.targetId]);
    if (!s || s.status === 'disabled') throw new Problem('approval-closed');
    await m.query(`UPDATE identity.totp_factors SET removed_at = $2 WHERE staff_id = $1 AND removed_at IS NULL`, [a.targetId, now]);
    await m.query(`UPDATE identity.webauthn_credentials SET removed_at = $2 WHERE staff_id = $1 AND removed_at IS NULL`, [a.targetId, now]);
    await m.query(`UPDATE identity.staff_accounts SET status = 'pending_mfa' WHERE id = $1`, [a.targetId]);
    await this.sessions.endAllStaffIn(m, a.targetId, 'mfa_reset', a.decidedBy!, ctx);
    await this.audit.record(m, {
      actorType: 'staff', actorId: a.decidedBy, action: 'staff.mfa.reset', objectType: 'staff', objectId: a.targetId,
      before: { status: s.status }, after: { status: 'pending_mfa' }, reason: a.reason, approvalId: a.id,
      sourceIp: ctx.ip, correlationId: ctx.correlationId,
    });
  }
}
