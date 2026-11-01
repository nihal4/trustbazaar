import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { CLOCK, Clock } from '../../../kernel/clock';
import { TbConfig } from '../../../kernel/config/config';
import { TB_CONFIG } from '../../../kernel/config/config.provider';
import { CONFIG_PORT, ConfigPort } from '../../../kernel/config-port';
import { Problem } from '../../../kernel/http/problems';
import { FileVault } from '../crypto/file-vault';
import { IdentityCrypto } from '../crypto/identity-crypto';
import { signFileLink, verifyFileLink } from '../security/file-links';
import { verifyAccessToken } from '../security/access-token';
import { ApprovalService, ApprovalView } from './approval.service';
import { AuditService } from './audit.service';
import { KycFileKind, KycService } from './kyc.service';
import { publish } from './outbox';
import { RequestContext } from './session.service';
import { StaffService } from './staff.service';

// KYC review, protected files, revocation and the NID blacklist (Unit 1 sections 6.7 and "Protected files";
// FR-KYC-04 to FR-KYC-06, FR-KYC-10, FR-KYC-12, FR-TNS-06, SEC-ACC-06, SEC-DAT-04).
// Queue: pending submissions oldest first with their flags and age against CP-44. Claim: one conditional
// update, so two operators never review the same submission; refused on a conflict of interest (FR-OPS-06).
// Only the claimant sees the details (each decryption audited) and opens images, through signed links
// that need a reason. Approve inserts the identity claim, whose primary key makes "one identity, one
// account" a database guarantee. Revocation and blacklisting are four-eyes actions with handlers here.
export const CLAIM_MINUTES = 30; // DV-6
export const REJECTION_REASONS = [
  'image_unreadable', 'selfie_mismatch', 'liveness_failed', 'document_expired', 'details_mismatch', 'underage',
  'duplicate_identity', 'blacklisted', 'other',
] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];
export const BLACKLIST_SOURCES = ['game_account_recovery', 'fraud_decision'] as const;

interface CP31 {
  signedLinkMinutes: number;
}
interface CP44 {
  reviewHours: number;
}

export interface QueueItem {
  id: string;
  userId: string;
  docType: string;
  flags: string[];
  submittedAt: Date;
  ageHours: number;
  overdue: boolean;
  claimedBy: string | null;
  claimedUntil: Date | null;
}

const rowsOf = <T>(result: unknown): T[] =>
  (Array.isArray(result) && Array.isArray(result[0]) && typeof result[1] === 'number' ? result[0] : result) as T[];
const isUniqueViolation = (e: unknown) => e instanceof QueryFailedError && (e as unknown as { code?: string }).code === '23505';

@Injectable()
export class KycReviewService implements OnModuleInit {
  constructor(
    private readonly db: DataSource,
    private readonly crypto: IdentityCrypto,
    private readonly vault: FileVault,
    private readonly kyc: KycService,
    private readonly staff: StaffService,
    private readonly approvals: ApprovalService,
    private readonly audit: AuditService,
    @Inject(TB_CONFIG) private readonly config: TbConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(CONFIG_PORT) private readonly params: ConfigPort,
  ) {}

  onModuleInit(): void {
    this.approvals.registerHandler('kyc.revoke', (a, m, ctx) => this.revokeIn(m, a, ctx));
    this.approvals.registerHandler('blacklist.add', (a, m, ctx) => this.blacklistIn(m, a, ctx));
    this.approvals.registerHandler('blacklist.remove', (a, m, ctx) => this.unblacklistIn(m, a, ctx));
  }

  /** FR-KYC-12: oldest first, with flags and the age against CP-44. */
  async queue(): Promise<QueueItem[]> {
    const now = this.clock.now();
    const target = (await this.params.current()).get<CP44>('CP-44').reviewHours;
    const rows = await this.db.query(
      `SELECT id, user_id, doc_type, routed_flags, submitted_at, claimed_by, claimed_until FROM identity.kyc_submissions
       WHERE status = 'pending_review' ORDER BY submitted_at LIMIT 200`,
    );
    return rows.map((r: Record<string, unknown>) => {
      const ageHours = (now.getTime() - (r.submitted_at as Date).getTime()) / 3_600_000;
      const live = r.claimed_until !== null && (r.claimed_until as Date) > now;
      return {
        id: r.id as string,
        userId: r.user_id as string,
        docType: r.doc_type as string,
        flags: r.routed_flags as string[],
        submittedAt: r.submitted_at as Date,
        ageHours: Math.round(ageHours * 10) / 10,
        overdue: ageHours > target,
        claimedBy: live ? (r.claimed_by as string) : null,
        claimedUntil: live ? (r.claimed_until as Date) : null,
      };
    });
  }

  /** SEC-ACC-06: assigned only if still pending and unclaimed or its claim has run out (DV-6). */
  async claim(staffId: string, submissionId: string, ctx: RequestContext): Promise<{ claimedUntil: Date }> {
    const [s] = await this.db.query(`SELECT user_id FROM identity.kyc_submissions WHERE id = $1`, [submissionId]);
    if (!s) throw new Problem('not-found');
    if (await this.staff.hasConflict(staffId, s.user_id)) throw new Problem('conflict-of-interest');
    const now = this.clock.now();
    const until = new Date(now.getTime() + CLAIM_MINUTES * 60_000);
    return this.db.transaction(async (m) => {
      const [row] = rowsOf<{ id: string }>(
        await m.query(
          `UPDATE identity.kyc_submissions SET claimed_by = $2, claimed_until = $3
           WHERE id = $1 AND status = 'pending_review' AND (claimed_by IS NULL OR claimed_until <= $4 OR claimed_by = $2) RETURNING id`,
          [submissionId, staffId, until, now],
        ),
      );
      if (!row) throw new Problem('already-claimed');
      await this.audit.record(m, {
        actorType: 'staff', actorId: staffId, action: 'kyc.submission.claimed', objectType: 'kyc_submission', objectId: submissionId,
        sourceIp: ctx.ip, correlationId: ctx.correlationId,
      });
      return { claimedUntil: until };
    });
  }

  /** The details, for the claimant only; the decryption is audited (SEC-ACC-06). */
  async details(staffId: string, submissionId: string, ctx: RequestContext) {
    const s = await this.claimed(staffId, submissionId);
    const open = (column: string, blob: Buffer) => this.crypto.openField(blob, { table: 'kyc_submissions', column, rowId: s.id });
    const files = await this.db.query(`SELECT kind FROM identity.kyc_files WHERE submission_id = $1 AND erased_at IS NULL ORDER BY kind`, [s.id]);
    await this.db.transaction((m) =>
      this.audit.record(m, {
        actorType: 'staff', actorId: staffId, action: 'kyc.details.viewed', objectType: 'kyc_submission', objectId: s.id,
        sourceIp: ctx.ip, correlationId: ctx.correlationId,
      }),
    );
    return {
      id: s.id,
      userId: s.user_id,
      docType: s.doc_type,
      docNumber: open('doc_number_enc', s.doc_number_enc),
      fullName: open('full_name_enc', s.full_name_enc),
      dateOfBirth: open('dob_enc', s.dob_enc),
      isAdult: s.is_adult,
      livenessAction: s.liveness_action,
      flags: s.routed_flags,
      submittedAt: s.submitted_at,
      files: files.map((f: { kind: string }) => f.kind),
    };
  }

  /** FR-KYC-06: approve (claim inserted), or reject with a reason code from the fixed list. */
  async decide(
    staffId: string,
    submissionId: string,
    d: { decision: 'approve' | 'reject'; reason?: RejectionReason; note?: string },
    ctx: RequestContext,
  ): Promise<{ status: 'approved' | 'rejected' }> {
    if (d.decision === 'reject' && !d.reason) throw new Problem('validation-failed', { errors: [{ field: 'reason', reason: 'required' }] });
    try {
      return await this.db.transaction(async (m) => {
        const now = this.clock.now();
        const [s] = await m.query(`SELECT * FROM identity.kyc_submissions WHERE id = $1 FOR UPDATE`, [submissionId]);
        if (!s || s.status !== 'pending_review' || s.claimed_by !== staffId || new Date(s.claimed_until) <= now) throw new Problem('not-claimed');
        if (d.decision === 'approve') {
          if (!s.is_adult) throw new Problem('kyc-cannot-approve', { errors: [{ field: 'decision', reason: 'underage' }] });
          const [black] = await m.query(`SELECT 1 FROM identity.nid_blacklist WHERE doc_number_bidx = $1 AND removed_at IS NULL`, [s.doc_number_bidx]);
          if (black) throw new Problem('kyc-cannot-approve', { errors: [{ field: 'decision', reason: 'blacklisted' }] });
          await m.query(
            `INSERT INTO identity.identity_claims (doc_number_bidx, user_id, submission_id, claimed_at) VALUES ($1, $2, $3, $4)`,
            [s.doc_number_bidx, s.user_id, s.id, now],
          );
        }
        const status = d.decision === 'approve' ? 'approved' : 'rejected';
        await m.query(
          `UPDATE identity.kyc_submissions SET status = $2, decided_by = $3, decided_at = $4, rejection_reason = $5, rejection_note = $6,
                  claimed_by = NULL, claimed_until = NULL WHERE id = $1`,
          [s.id, status, staffId, now, d.decision === 'reject' ? d.reason : null, d.decision === 'reject' ? (d.note?.trim() || null) : null],
        );
        await this.kyc.moveStatus(m, s.user_id, d.decision === 'approve' ? 'verified' : 'rejected', {
          actorType: 'staff', actorId: staffId, submissionId: s.id, reason: d.decision === 'reject' ? d.reason : undefined,
        });
        await this.audit.record(m, {
          actorType: 'staff', actorId: staffId, action: `kyc.submission.${status}`, objectType: 'kyc_submission', objectId: s.id,
          before: { status: 'pending_review', flags: s.routed_flags }, after: { status, reason: d.reason ?? null },
          reason: d.note?.trim() || null, sourceIp: ctx.ip, correlationId: ctx.correlationId,
        });
        await publish(m, d.decision === 'approve' ? 'identity.kyc.verified' : 'identity.kyc.rejected', s.user_id, {
          userId: s.user_id, submissionId: s.id, ...(d.decision === 'reject' ? { reason: d.reason } : {}),
        });
        return { status } as const;
      });
    } catch (e) {
      // FR-KYC-04: another account already holds this identity; the operator rejects with duplicate_identity.
      if (isUniqueViolation(e)) throw new Problem('kyc-cannot-approve', { errors: [{ field: 'decision', reason: 'duplicate_identity' }] });
      throw e;
    }
  }

  /** SEC-DAT-04: a signed link to the claimant's view of one image; the reason is audited as kyc.file.viewed. */
  async staffFileLink(staffId: string, sessionId: string, submissionId: string, kind: KycFileKind, reason: string, ctx: RequestContext) {
    const s = await this.claimed(staffId, submissionId);
    const file = await this.file(s.id, kind);
    const link = await this.link(file.id, sessionId, 'staff');
    await this.db.transaction((m) =>
      this.audit.record(m, {
        actorType: 'staff', actorId: staffId, action: 'kyc.file.viewed', objectType: 'kyc_file', objectId: file.id,
        reason: reason.trim(), sourceIp: ctx.ip, correlationId: ctx.correlationId,
      }),
    );
    return link;
  }

  /** The owner's own images, of their latest submission. */
  async ownFileLink(userId: string, sessionId: string, kind: KycFileKind) {
    const [s] = await this.db.query(`SELECT id FROM identity.kyc_submissions WHERE user_id = $1 ORDER BY submitted_at DESC LIMIT 1`, [userId]);
    if (!s) throw new Problem('not-found');
    return this.link((await this.file(s.id, kind)).id, sessionId, 'user');
  }

  /** Serves a signed link: authentic, not expired, and used by the session it was issued to. */
  async serve(token: string, cookies: Record<string, string | undefined>): Promise<Buffer> {
    const now = this.clock.now();
    const c = verifyFileLink(this.config.secrets.linkKey.reveal(), token, now);
    if (!c) throw new Problem('link-invalid');
    const access = cookies[c.p === 'staff' ? '__Host-tb_sat' : '__Host-tb_at'];
    const claims = access ? verifyAccessToken(this.config.keys.jwt, access, now) : null;
    if (!claims || claims.sid !== c.s || claims.pt !== c.p) throw new Problem('link-invalid');
    const [live] = await this.db.query(
      `SELECT 1 FROM identity.sessions WHERE id = $1 AND ended_at IS NULL AND idle_expires_at > $2 AND absolute_expires_at > $2`,
      [c.s, now],
    );
    if (!live) throw new Problem('link-invalid');
    const [f] = await this.db.query(`SELECT id, storage_key, wrapped_dek FROM identity.kyc_files WHERE id = $1 AND erased_at IS NULL`, [c.f]);
    if (!f) throw new Problem('link-invalid');
    return this.vault.open('kyc', f.id, f.storage_key, f.wrapped_dek);
  }

  /** FR-KYC-10: a revocation proposal; a second operator approves it. */
  async proposeRevoke(staffId: string, userId: string, reason: string, ctx: RequestContext): Promise<ApprovalView> {
    const [u] = await this.db.query(`SELECT kyc_status FROM identity.users WHERE id = $1`, [userId]);
    if (!u) throw new Problem('not-found');
    if (u.kyc_status !== 'verified') throw new Problem('kyc-not-allowed');
    if (await this.staff.hasConflict(staffId, userId)) throw new Problem('conflict-of-interest');
    return this.approvals.propose({ action: 'kyc.revoke', targetType: 'user', targetId: userId, reason, requiredRole: 'operator', byStaffId: staffId }, ctx);
  }

  /** FR-TNS-06: a blacklist proposal for a user's claimed identity. */
  async proposeBlacklist(staffId: string, userId: string, source: string, relatedOrderId: string | null, reason: string, ctx: RequestContext) {
    const [claim] = await this.db.query(`SELECT 1 FROM identity.identity_claims WHERE user_id = $1`, [userId]);
    if (!claim) throw new Problem('kyc-not-allowed'); // nothing to blacklist without a verified identity
    if (await this.staff.hasConflict(staffId, userId)) throw new Problem('conflict-of-interest');
    return this.approvals.propose(
      { action: 'blacklist.add', targetType: 'user', targetId: userId, payload: { source, relatedOrderId }, reason, requiredRole: 'operator', byStaffId: staffId },
      ctx,
    );
  }

  async proposeUnblacklist(staffId: string, entryId: string, reason: string, ctx: RequestContext) {
    const [e] = await this.db.query(`SELECT 1 FROM identity.nid_blacklist WHERE id = $1 AND removed_at IS NULL`, [entryId]);
    if (!e) throw new Problem('not-found');
    return this.approvals.propose({ action: 'blacklist.remove', targetType: 'blacklist_entry', targetId: entryId, reason, requiredRole: 'operator', byStaffId: staffId }, ctx);
  }

  private async revokeIn(m: EntityManager, a: ApprovalView, ctx: RequestContext): Promise<void> {
    if (await this.staff.hasConflict(a.decidedBy!, a.targetId)) throw new Problem('conflict-of-interest');
    await this.kyc.moveStatus(m, a.targetId, 'revoked', { actorType: 'staff', actorId: a.decidedBy!, approvalId: a.id, reason: a.reason });
    await this.audit.record(m, {
      actorType: 'staff', actorId: a.decidedBy, action: 'kyc.verification.revoked', objectType: 'user', objectId: a.targetId,
      before: { kycStatus: 'verified' }, after: { kycStatus: 'revoked' }, reason: a.reason, approvalId: a.id,
      sourceIp: ctx.ip, correlationId: ctx.correlationId,
    });
    await publish(m, 'identity.kyc.revoked', a.targetId, { userId: a.targetId, approvalId: a.id });
  }

  private async blacklistIn(m: EntityManager, a: ApprovalView, ctx: RequestContext): Promise<void> {
    if (await this.staff.hasConflict(a.decidedBy!, a.targetId)) throw new Problem('conflict-of-interest');
    const [claim] = await m.query(`SELECT doc_number_bidx FROM identity.identity_claims WHERE user_id = $1`, [a.targetId]);
    if (!claim) throw new Problem('kyc-not-allowed');
    const p = a.payload as { source: string; relatedOrderId: string | null };
    try {
      const [entry] = await m.query(
        `INSERT INTO identity.nid_blacklist (doc_number_bidx, source, reason, related_order_id, added_by, add_approval_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [claim.doc_number_bidx, p.source, a.reason, p.relatedOrderId, a.proposedBy, a.id],
      );
      await this.audit.record(m, {
        actorType: 'staff', actorId: a.decidedBy, action: 'kyc.blacklist.added', objectType: 'blacklist_entry', objectId: entry.id,
        after: { userId: a.targetId, source: p.source }, reason: a.reason, approvalId: a.id, sourceIp: ctx.ip, correlationId: ctx.correlationId,
      });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      throw new Problem('already-proposed'); // the identity is already on the blacklist; the decision is undone
    }
  }

  private async unblacklistIn(m: EntityManager, a: ApprovalView, ctx: RequestContext): Promise<void> {
    const [row] = rowsOf<{ id: string }>(
      await m.query(
        `UPDATE identity.nid_blacklist SET removed_at = $2, removed_by = $3, remove_approval_id = $4 WHERE id = $1 AND removed_at IS NULL RETURNING id`,
        [a.targetId, this.clock.now(), a.proposedBy, a.id],
      ),
    );
    if (!row) throw new Problem('not-found');
    await this.audit.record(m, {
      actorType: 'staff', actorId: a.decidedBy, action: 'kyc.blacklist.removed', objectType: 'blacklist_entry', objectId: a.targetId,
      reason: a.reason, approvalId: a.id, sourceIp: ctx.ip, correlationId: ctx.correlationId,
    });
  }

  private async claimed(staffId: string, submissionId: string) {
    const [s] = await this.db.query(`SELECT * FROM identity.kyc_submissions WHERE id = $1`, [submissionId]);
    if (!s || s.status !== 'pending_review' || s.claimed_by !== staffId || new Date(s.claimed_until) <= this.clock.now()) throw new Problem('not-claimed');
    return s;
  }

  private async file(submissionId: string, kind: KycFileKind): Promise<{ id: string }> {
    const [f] = await this.db.query(`SELECT id FROM identity.kyc_files WHERE submission_id = $1 AND kind = $2 AND erased_at IS NULL`, [submissionId, kind]);
    if (!f) throw new Problem('not-found');
    return f;
  }

  private async link(fileId: string, sessionId: string, p: 'user' | 'staff'): Promise<{ url: string; expiresAt: string }> {
    const minutes = (await this.params.current()).get<CP31>('CP-31').signedLinkMinutes;
    const e = this.clock.now().getTime() + minutes * 60_000;
    const token = signFileLink(this.config.secrets.linkKey.reveal(), { f: fileId, s: sessionId, p, e });
    return { url: `/api/v1/files/v/${token}`, expiresAt: new Date(e).toISOString() };
  }
}
