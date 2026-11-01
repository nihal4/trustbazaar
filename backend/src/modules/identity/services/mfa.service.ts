import { Inject, Injectable } from '@nestjs/common';
import { randomInt, randomUUID } from 'crypto';
import { authenticator } from 'otplib';
import { DataSource, EntityManager } from 'typeorm';
import { CLOCK, Clock } from '../../../kernel/clock';
import { TbConfig } from '../../../kernel/config/config';
import { TB_CONFIG } from '../../../kernel/config/config.provider';
import { Problem } from '../../../kernel/http/problems';
import { decryptField, encryptField } from '../crypto/field-crypto';
import { PasswordHasher } from '../crypto/password';
import { checkPassword } from '../crypto/password-policy';
import { checkTotp, hashRecoveryCode } from '../crypto/totp';
import { RateLimiter } from '../security/rate-limiter.service';
import { AuditService } from './audit.service';
import { publish } from './outbox';
import { SecondFactorService } from './second-factor.service';
import { RequestContext, SessionService } from './session.service';

// MFA settings (Unit 1 sections 4.2 and 6.5; FR-ACC-06, SEC-AUTH-01; U1-12).
//  - Enable: a 160-bit secret, stored encrypted but unconfirmed, returned as an otpauth:// URI for a QR code.
//    Starting again replaces an unconfirmed secret; with MFA already on it is refused.
//  - Confirm: a valid code from the new authenticator confirms the factor, turns MFA on and issues DV-7's ten
//    single-use recovery codes, shown once and stored hashed.
//  - Disable: after step-up (the route), with a current TOTP code. If the password was set under the
//    8-character MFA rule, the same request must set a new one of at least 15 characters; the database
//    refuses any other outcome (users: password_single_factor_ok OR mfa_enabled).
//  - Regenerate: after step-up, ten new codes; the old ones stop working.
export const RECOVERY_CODES = 10; // DV-7
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I: easy to copy by hand

/** XXXXX-XXXXX from a 32-letter alphabet: 50 random bits each. */
export function newRecoveryCode(): string {
  const c = Array.from({ length: 10 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  return `${c.slice(0, 5)}-${c.slice(5)}`;
}

interface UserRow {
  id: string;
  display_name: string;
  phone_e164: string;
  email: string | null;
  password_hash: string;
  password_single_factor_ok: boolean;
  mfa_enabled: boolean;
}

@Injectable()
export class MfaService {
  constructor(
    private readonly db: DataSource,
    private readonly secondFactor: SecondFactorService,
    private readonly passwords: PasswordHasher,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly limiter: RateLimiter,
    @Inject(TB_CONFIG) private readonly config: TbConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** FR-ACC-06: a new unconfirmed TOTP secret to scan. */
  async start(userId: string, ctx: RequestContext): Promise<{ otpauthUri: string; secret: string }> {
    const secret = authenticator.generateSecret(20); // 160 bits
    const factorId = randomUUID();
    const now = this.clock.now();
    const label = await this.db.transaction(async (m) => {
      const u = await this.user(m, userId);
      if (u.mfa_enabled) throw new Problem('mfa-state', { errors: [{ field: 'mfa', reason: 'already-on' }] });
      await m.query(`UPDATE identity.totp_factors SET removed_at = $2 WHERE user_id = $1 AND removed_at IS NULL`, [userId, now]);
      await m.query(
        `INSERT INTO identity.totp_factors (id, principal_type, user_id, secret_enc, key_version, created_at) VALUES ($1, 'user', $2, $3, $4, $5)`,
        [factorId, userId, encryptField(this.config.keys.field, Buffer.from(secret), { table: 'totp_factors', column: 'secret_enc', rowId: factorId }), this.config.keys.field.current, now],
      );
      await this.audit.record(m, { actorType: 'user', actorId: userId, action: 'identity.mfa.enrolment_started', objectType: 'user', objectId: userId, sourceIp: ctx.ip, correlationId: ctx.correlationId });
      return u.email ?? u.phone_e164;
    });
    return { otpauthUri: authenticator.keyuri(label, 'TrustBazaar', secret), secret };
  }

  /** The first code from the new authenticator turns MFA on; the recovery codes are returned once. */
  async confirm(userId: string, code: string, ctx: RequestContext): Promise<{ recoveryCodes: string[] }> {
    await this.limit(userId);
    const now = this.clock.now();
    return this.db.transaction(async (m) => {
      const u = await this.user(m, userId);
      if (u.mfa_enabled) throw new Problem('mfa-state', { errors: [{ field: 'mfa', reason: 'already-on' }] });
      const [f] = (await m.query(
        `SELECT id, secret_enc FROM identity.totp_factors WHERE user_id = $1 AND removed_at IS NULL AND confirmed_at IS NULL FOR UPDATE`,
        [userId],
      )) as { id: string; secret_enc: Buffer }[];
      if (!f) throw new Problem('mfa-state', { errors: [{ field: 'mfa', reason: 'not-started' }] });
      const secret = decryptField(this.config.keys.field, f.secret_enc, { table: 'totp_factors', column: 'secret_enc', rowId: f.id }).toString('utf8');
      const step = checkTotp(secret, code, now);
      if (step === null) throw new Problem('mfa-failed');
      await m.query(`UPDATE identity.totp_factors SET confirmed_at = $2, last_used_step = $3 WHERE id = $1`, [f.id, now, step]);
      await m.query(`UPDATE identity.users SET mfa_enabled = true, updated_at = $2 WHERE id = $1`, [userId, now]);
      const codes = await this.issueCodes(m, f.id);
      await publish(m, 'identity.mfa.enabled', userId, { userId });
      await this.audit.record(m, { actorType: 'user', actorId: userId, action: 'identity.mfa.enabled', objectType: 'user', objectId: userId, sourceIp: ctx.ip, correlationId: ctx.correlationId });
      return { recoveryCodes: codes };
    });
  }

  /** SEC-AUTH-01: off only with a current TOTP code, and with a 15-character password if the current one is shorter. */
  async disable(userId: string, sessionId: string, code: string, newPassword: string | undefined, ctx: RequestContext): Promise<void> {
    await this.limit(userId);
    const now = this.clock.now();
    const u = await this.db.transaction((m) => this.user(m, userId));
    if (!u.mfa_enabled) throw new Problem('mfa-state', { errors: [{ field: 'mfa', reason: 'already-off' }] });
    let hash: string | null = null;
    if (!u.password_single_factor_ok || newPassword !== undefined) {
      if (newPassword === undefined) throw new Problem('password-rejected', { errors: [{ field: 'newPassword', reason: 'required-without-mfa' }] });
      const refusal = checkPassword(newPassword, { mfa: false, context: { displayName: u.display_name, phoneE164: u.phone_e164, email: u.email ?? undefined } });
      if (refusal) throw new Problem('password-rejected', { errors: [{ field: 'newPassword', reason: refusal }] });
      hash = await this.passwords.hash(newPassword);
    }
    // A TOTP code only (not a recovery code): the design asks for "a current TOTP code".
    if (!/^\d{6}$/.test(code) || (await this.secondFactor.check(userId, code, now)) !== 'totp') throw new Problem('mfa-failed');
    await this.db.transaction(async (m) => {
      if (hash) {
        await m.query(`UPDATE identity.users SET password_hash = $2, password_single_factor_ok = true, password_changed_at = $3 WHERE id = $1`, [userId, hash, now]);
        await this.sessions.endAllIn(m, userId, sessionId, 'password_changed', ctx);
        await publish(m, 'identity.password.changed', userId, { userId, via: 'mfa_disable' });
      }
      await m.query(`UPDATE identity.totp_factors SET removed_at = $2 WHERE user_id = $1 AND removed_at IS NULL`, [userId, now]);
      await m.query(`UPDATE identity.users SET mfa_enabled = false, updated_at = $2 WHERE id = $1`, [userId, now]);
      await publish(m, 'identity.mfa.disabled', userId, { userId });
      await this.audit.record(m, { actorType: 'user', actorId: userId, action: 'identity.mfa.disabled', objectType: 'user', objectId: userId, sourceIp: ctx.ip, correlationId: ctx.correlationId });
    });
  }

  /** After step-up: ten new recovery codes; the unused old ones stop working. */
  async regenerate(userId: string, ctx: RequestContext): Promise<{ recoveryCodes: string[] }> {
    const now = this.clock.now();
    return this.db.transaction(async (m) => {
      const [f] = (await m.query(
        `SELECT id FROM identity.totp_factors WHERE user_id = $1 AND removed_at IS NULL AND confirmed_at IS NOT NULL FOR UPDATE`,
        [userId],
      )) as { id: string }[];
      if (!f) throw new Problem('mfa-state', { errors: [{ field: 'mfa', reason: 'already-off' }] });
      await m.query(`UPDATE identity.recovery_codes SET used_at = $2 WHERE totp_factor_id = $1 AND used_at IS NULL`, [f.id, now]);
      const codes = await this.issueCodes(m, f.id);
      await this.audit.record(m, { actorType: 'user', actorId: userId, action: 'identity.mfa.recovery_regenerated', objectType: 'user', objectId: userId, sourceIp: ctx.ip, correlationId: ctx.correlationId });
      return { recoveryCodes: codes };
    });
  }

  private async issueCodes(m: EntityManager, factorId: string): Promise<string[]> {
    const codes = Array.from({ length: RECOVERY_CODES }, newRecoveryCode);
    for (const c of codes) await m.query(`INSERT INTO identity.recovery_codes (totp_factor_id, code_hash) VALUES ($1, $2)`, [factorId, hashRecoveryCode(c)]);
    return codes;
  }

  /** CP-05: 20 code entries per account per hour, as at sign-in. */
  private async limit(userId: string): Promise<void> {
    const r = await this.limiter.hit(`rl:otp-verify:user:${userId}`, 20, 3600);
    if (!r.allowed) throw new Problem('rate-limited', { retryAfter: r.retryAfterSeconds });
  }

  private async user(m: EntityManager, userId: string): Promise<UserRow> {
    const [u] = (await m.query(
      `SELECT id, display_name, phone_e164, email, password_hash, password_single_factor_ok, mfa_enabled FROM identity.users WHERE id = $1 FOR UPDATE`,
      [userId],
    )) as UserRow[];
    if (!u) throw new Problem('session-ended');
    return u;
  }
}
