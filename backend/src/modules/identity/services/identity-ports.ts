import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { CLOCK, Clock } from '../../../kernel/clock';
import { TbConfig } from '../../../kernel/config/config';
import { TB_CONFIG } from '../../../kernel/config/config.provider';
import { CONFIG_PORT, ConfigPort } from '../../../kernel/config-port';
import type { Principal } from '../../../kernel/http/principal';
import { Problem } from '../../../kernel/http/problems';
import { FilePurpose, FileVault } from '../crypto/file-vault';
import { IdentityCrypto } from '../crypto/identity-crypto';
import { reencodeImage } from '../crypto/images';
import type {
  Approval, ApprovalServicePort, AuditEntry, AuditServicePort, BlacklistSource, CallContext, FileVaultPort, IdentityCommands,
  IdentityQuery, PrincipalInfo, PublicProfile, RateLimiterPort, SessionEndReason, StaffQuery, StaffRole, StoredFile, TransactAction,
} from '../ports';
import { signFileLink } from '../security/file-links';
import { RATE_RULES } from '../security/rate-rules';
import { RateLimiter } from '../security/rate-limiter.service';
import { RESTRICTIONS, Restrictions } from '../security/restrictions';
import { ApprovalService } from './approval.service';
import { AuditService } from './audit.service';
import { KycReviewService } from './kyc-review.service';
import { publish } from './outbox';
import { RequestContext, SessionService } from './session.service';
import { StaffService } from './staff.service';
import { mimeOf, parseVaultKey } from './vault-key';

// The implementations behind Unit 1's ports (ports/index.ts; U1-08). Each adapts the unit's services to the
// interfaces of the design, so other units never depend on the services themselves (DC-1).
const ctxOf = (c?: CallContext): RequestContext => ({ ip: c?.ip ?? null, userAgent: null, correlationId: c?.correlationId ?? null });
const rowsOf = <T>(result: unknown): T[] =>
  (Array.isArray(result) && Array.isArray(result[0]) && typeof result[1] === 'number' ? result[0] : result) as T[];

@Injectable()
export class IdentityQueryService implements IdentityQuery {
  constructor(
    private readonly db: DataSource,
    private readonly crypto: IdentityCrypto,
    private readonly audit: AuditService,
    private readonly staff: StaffService,
    @Inject(RESTRICTIONS) private readonly restrictions: Restrictions,
  ) {}

  async getPrincipal(userId: string, tx?: EntityManager): Promise<PrincipalInfo> {
    const [u] = await (tx ?? this.db).query(
      `SELECT u.id, u.display_name, u.kyc_status, u.account_status, u.email_verified_at IS NOT NULL AS email_verified,
              CASE WHEN u.kyc_status = 'verified' THEN (SELECT max(h.at) FROM identity.kyc_status_history h
                                                        WHERE h.user_id = u.id AND h.to_status = 'verified') END AS verified_at
       FROM identity.users u WHERE u.id = $1`,
      [userId],
    );
    if (!u) throw new Problem('not-found');
    return {
      id: u.id, displayName: u.display_name, kycStatus: u.kyc_status, accountStatus: u.account_status,
      emailVerified: u.email_verified, verifiedAt: u.verified_at ?? null,
    };
  }

  /** FR-KYC-07, FR-TNS-05, I-43: the same rule as @Verified(action), for calls that are not HTTP routes. */
  async assertCanTransact(userId: string, action: TransactAction): Promise<void> {
    const [u] = await this.db.query(
      `SELECT account_status, kyc_status, email_verified_at IS NOT NULL AS email_verified FROM identity.users WHERE id = $1`,
      [userId],
    );
    const reason = !u ? 'not-found'
      : u.account_status !== 'active' ? u.account_status // suspended or closed
      : u.kyc_status !== 'verified' ? 'kyc-not-verified'
      : !u.email_verified ? 'email-not-verified'
      : (await this.restrictions.isRestricted(userId, action)) ? 'restricted'
      : null;
    if (reason) throw new Problem('transaction-not-allowed', { errors: [{ action, reason }] });
  }

  async getPublicProfile(userId: string): Promise<PublicProfile> {
    const [u] = await this.db.query(
      `SELECT id, display_name, kyc_status, to_char(created_at AT TIME ZONE 'Asia/Dhaka', 'YYYY-MM') AS join_month, area_district
       FROM identity.users WHERE id = $1`,
      [userId],
    );
    if (!u) throw new Problem('not-found');
    return { id: u.id, displayName: u.display_name, verified: u.kyc_status === 'verified', joinMonth: u.join_month, district: u.area_district };
  }

  async getVerifiedPhone(userId: string): Promise<string> {
    const [u] = await this.db.query(`SELECT phone_e164 FROM identity.users WHERE id = $1 AND account_status <> 'closed'`, [userId]);
    if (!u?.phone_e164) throw new Problem('not-found');
    return u.phone_e164;
  }

  async getKycLegalName(userId: string, purpose: 'bank_payout_check', ctx?: CallContext): Promise<string> {
    const [s] = await this.db.query(
      `SELECT k.id, k.full_name_enc FROM identity.identity_claims c JOIN identity.kyc_submissions k ON k.id = c.submission_id
       WHERE c.user_id = $1 AND k.erased_at IS NULL`,
      [userId],
    );
    if (!s) throw new Problem('not-found');
    const name = this.crypto.openField(s.full_name_enc, { table: 'kyc_submissions', column: 'full_name_enc', rowId: s.id });
    await this.db.transaction((m) =>
      this.audit.record(m, {
        actorType: 'system', action: 'identity.kyc.legal_name_read', objectType: 'user', objectId: userId, reason: purpose,
        sourceIp: ctx?.ip ?? null, correlationId: ctx?.correlationId ?? null,
      }),
    );
    return name;
  }

  hasConflict(staffId: string, userId: string): Promise<boolean> {
    return this.staff.hasConflict(staffId, userId);
  }

  async getApproxArea(userId: string): Promise<{ district: string | null; lat: number; lng: number } | null> {
    const [u] = await this.db.query(`SELECT area_district, approx_lat, approx_lng FROM identity.users WHERE id = $1`, [userId]);
    if (!u || u.approx_lat === null) return null;
    return { district: u.area_district, lat: Number(u.approx_lat), lng: Number(u.approx_lng) };
  }

  async getContact(userId: string): Promise<{ email: string | null; phone: string | null; emailVerified: boolean }> {
    const [u] = await this.db.query(
      `SELECT email, phone_e164, email_verified_at IS NOT NULL AS email_verified FROM identity.users WHERE id = $1`,
      [userId],
    );
    if (!u) throw new Problem('not-found');
    return { email: u.email, phone: u.phone_e164, emailVerified: u.email_verified };
  }
}

@Injectable()
export class IdentityCommandsService implements IdentityCommands, OnModuleInit {
  constructor(
    private readonly db: DataSource,
    private readonly sessions: SessionService,
    private readonly approvals: ApprovalService,
    private readonly audit: AuditService,
    private readonly staff: StaffService,
    private readonly kyc: KycReviewService,
  ) {}

  onModuleInit(): void {
    // CP-30: lifting a suspension needs a second operator.
    this.approvals.registerHandler('account.reinstate', (a, m) => this.reinstateAccount(a.targetId, a.id, m));
  }

  async suspendAccount(userId: string, reason: string, byStaffId: string, o: { fraud?: boolean; ctx?: CallContext; tx?: EntityManager } = {}): Promise<void> {
    const work = async (m: EntityManager) => {
      const [u] = await m.query(`SELECT account_status FROM identity.users WHERE id = $1 FOR UPDATE`, [userId]);
      if (!u) throw new Problem('not-found');
      if (u.account_status === 'closed') throw new Problem('forbidden');
      await m.query(`UPDATE identity.users SET account_status = 'suspended', updated_at = now() WHERE id = $1`, [userId]);
      await this.sessions.endAllIn(m, userId, null, 'suspended', ctxOf(o.ctx), { type: 'staff', id: byStaffId });
      await this.audit.record(m, {
        actorType: 'staff', actorId: byStaffId, action: 'identity.account.suspended', objectType: 'user', objectId: userId,
        before: { accountStatus: u.account_status }, after: { accountStatus: 'suspended', fraud: o.fraud === true }, reason,
        sourceIp: o.ctx?.ip ?? null, correlationId: o.ctx?.correlationId ?? null,
      });
      // I-8: the fraud flag lets Unit 2 hold payouts.
      await publish(m, 'identity.account.suspended', userId, { userId, fraud: o.fraud === true });
    };
    await (o.tx ? work(o.tx) : this.db.transaction(work));
  }

  async reinstateAccount(userId: string, approvalId: string, tx?: EntityManager): Promise<void> {
    const work = async (m: EntityManager) => {
      const [a] = await m.query(
        `SELECT decided_by FROM identity.approvals WHERE id = $1 AND action = 'account.reinstate' AND target_id = $2 AND decision = 'approved'`,
        [approvalId, userId],
      );
      if (!a) throw new Problem('forbidden');
      const [row] = rowsOf<{ id: string }>(
        await m.query(`UPDATE identity.users SET account_status = 'active', updated_at = now() WHERE id = $1 AND account_status = 'suspended' RETURNING id`, [userId]),
      );
      if (!row) throw new Problem('approval-closed');
      await this.audit.record(m, {
        actorType: 'staff', actorId: a.decided_by, action: 'identity.account.reinstated', objectType: 'user', objectId: userId,
        before: { accountStatus: 'suspended' }, after: { accountStatus: 'active' }, approvalId,
      });
      await publish(m, 'identity.account.reinstated', userId, { userId, approvalId });
    };
    await (tx ? work(tx) : this.db.transaction(work));
  }

  async endAllSessions(userId: string, reason: SessionEndReason, tx?: EntityManager): Promise<void> {
    const work = (m: EntityManager) => this.sessions.endAllIn(m, userId, null, reason, ctxOf(), { type: 'user', id: userId });
    await (tx ? work(tx) : this.db.transaction(work));
  }

  proposeBlacklist(userId: string, source: BlacklistSource, relatedOrderId: string | null, reason: string, byStaffId: string, ctx?: CallContext): Promise<Approval> {
    return this.kyc.proposeBlacklist(byStaffId, userId, source, relatedOrderId, reason, ctxOf(ctx));
  }

  async proposeReinstatement(userId: string, reason: string, byStaffId: string, ctx?: CallContext): Promise<Approval> {
    const [u] = await this.db.query(`SELECT account_status FROM identity.users WHERE id = $1`, [userId]);
    if (!u) throw new Problem('not-found');
    if (u.account_status !== 'suspended') throw new Problem('approval-closed');
    if (await this.staff.hasConflict(byStaffId, userId)) throw new Problem('conflict-of-interest');
    return this.approvals.propose({ action: 'account.reinstate', targetType: 'user', targetId: userId, reason, requiredRole: 'operator', byStaffId }, ctxOf(ctx));
  }
}

@Injectable()
export class StaffQueryService implements StaffQuery {
  constructor(private readonly staff: StaffService) {}

  async assertNoConflict(staffId: string, userIds: string[]): Promise<void> {
    for (const userId of new Set(userIds)) if (await this.staff.hasConflict(staffId, userId)) throw new Problem('conflict-of-interest');
  }
}

@Injectable()
export class ApprovalPortAdapter implements ApprovalServicePort {
  constructor(
    private readonly db: DataSource,
    private readonly approvals: ApprovalService,
  ) {}

  propose(p: Parameters<ApprovalServicePort['propose']>[0], ctx?: CallContext, tx?: EntityManager): Promise<Approval> {
    return this.approvals.propose({ ...p, payload: p.payload as Record<string, unknown> | undefined }, ctxOf(ctx), tx);
  }

  async decide(id: string, byStaffId: string, decision: 'approved' | 'rejected', note?: string, ctx?: CallContext): Promise<Approval> {
    const [s] = await this.db.query(`SELECT role FROM identity.staff_accounts WHERE id = $1 AND status = 'active'`, [byStaffId]);
    if (!s) throw new Problem('forbidden');
    return this.approvals.decide(id, { staffId: byStaffId, role: s.role as StaffRole }, decision, note, ctxOf(ctx));
  }

  registerHandler(action: string, h: (a: Approval, tx: EntityManager) => Promise<void>): void {
    this.approvals.registerHandler(action, (a, m) => h(a, m));
  }
}

@Injectable()
export class AuditPortAdapter implements AuditServicePort {
  constructor(private readonly audit: AuditService) {}

  record(e: AuditEntry, tx: EntityManager): Promise<void> {
    return this.audit.record(tx, e);
  }

  verifyChain() {
    return this.audit.verifyChain();
  }
}

@Injectable()
export class RateLimiterPortAdapter implements RateLimiterPort {
  private readonly rules = new Map<string, { limit: number; windowSeconds: number }[]>();

  constructor(private readonly limiter: RateLimiter) {}

  define(rule: string, limit: number, windowSeconds: number): void {
    if (this.rules.has(rule) || rule in RATE_RULES) throw new Error(`rate-limit rule "${rule}" is already defined`);
    this.rules.set(rule, [{ limit, windowSeconds }]);
  }

  async consume(rule: string, subject: string): Promise<void> {
    const limits = this.rules.get(rule) ?? RATE_RULES[rule];
    if (!limits) throw new Error(`unknown rate-limit rule "${rule}"`);
    for (const l of limits) {
      const r = await this.limiter.hit(`rl:${rule}:${subject}`, l.limit, l.windowSeconds);
      if (!r.allowed) throw new Problem('rate-limited', { retryAfter: r.retryAfterSeconds });
    }
  }
}


@Injectable()
export class FileVaultPortAdapter implements FileVaultPort {
  constructor(
    private readonly db: DataSource,
    private readonly vault: FileVault,
    private readonly audit: AuditService,
    @Inject(TB_CONFIG) private readonly config: TbConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(CONFIG_PORT) private readonly params: ConfigPort,
  ) {}

  async store(f: { purpose: FilePurpose; ownerId: string; bytes: Uint8Array }): Promise<StoredFile> {
    let bytes: Buffer = Buffer.from(f.bytes);
    if (f.purpose !== 'data_export') {
      try {
        bytes = (await reencodeImage(bytes)).jpeg;
      } catch (e) {
        throw new Problem('validation-failed', { errors: [{ field: 'file', reason: (e as { reason?: string }).reason ?? 'unreadable' }] });
      }
    }
    const fileId = randomUUID();
    const s = await this.vault.seal(f.purpose, fileId, bytes);
    return {
      key: `v1.${f.purpose}.${fileId}.${s.storageKey}.${s.wrappedDek.toString('base64url')}`,
      sha256: s.sha256.toString('hex'),
      mime: mimeOf(f.purpose),
      size: s.size,
    };
  }

  async signedLink(key: string, viewer: Principal, reason?: string, ctx?: CallContext): Promise<{ url: string; expiresAt: string }> {
    const k = parseVaultKey(key);
    if (!k) throw new Problem('not-found');
    if (viewer.type === 'staff') {
      if (!reason || reason.trim().length < 10) throw new Problem('validation-failed', { errors: [{ field: 'reason', reason: 'required' }] });
      await this.db.transaction((m) =>
        this.audit.record(m, {
          actorType: 'staff', actorId: viewer.staffId, action: 'files.file.viewed', objectType: k.purpose, objectId: k.fileId,
          reason: reason.trim(), sourceIp: ctx?.ip ?? null, correlationId: ctx?.correlationId ?? null,
        }),
      );
    }
    const minutes = (await this.params.current()).ms('CP-31') / 60_000;
    const e = this.clock.now().getTime() + minutes * 60_000;
    const token = signFileLink(this.config.secrets.linkKey.reveal(), { f: key, s: viewer.sessionId, p: viewer.type, e });
    return { url: `/api/v1/files/v/${token}`, expiresAt: new Date(e).toISOString() };
  }

  async erase(key: string): Promise<void> {
    const k = parseVaultKey(key);
    if (!k) throw new Problem('not-found');
    await this.vault.erase(k.purpose, k.storageKey);
  }
}
