import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { DataSource, EntityManager } from 'typeorm';
import { CLOCK, Clock } from '../../../kernel/clock';
import { TbConfig } from '../../../kernel/config/config';
import { TB_CONFIG } from '../../../kernel/config/config.provider';
import { CONFIG_PORT, ConfigPort } from '../../../kernel/config-port';
import { Problem } from '../../../kernel/http/problems';
import { REDIS } from '../../../kernel/redis.provider';
import { NOTIFICATIONS, NotificationPort } from '../adapters/notifications';
import { generateLinkToken, generateOtp, hashLinkToken } from '../crypto/otp';
import { PasswordHasher } from '../crypto/password';
import { checkPassword, MIN_LENGTH_SINGLE_FACTOR } from '../crypto/password-policy';
import { RateLimiter } from '../security/rate-limiter.service';
import { AuditService } from './audit.service';
import { OtpService } from './otp.service';
import { publish } from './outbox';
import { SecondFactorService } from './second-factor.service';
import { RequestContext, SessionService } from './session.service';
import { normaliseLogin, signInThrottleKey } from './signin.service';

// Password reset and change (Unit 1 section 6.4; FR-ACC-07, SEC-AUTH-10, SEC-AUTH-11).
// forgot always answers 202: a verified e-mail gets a 256-bit link (CP-06), a verified number an SMS code;
// an unknown identifier gets nothing. reset takes the link token, or the number and code, and the new
// password; with MFA on, a TOTP or recovery code too, so the inbox alone cannot remove the second factor.
// Success ends every session, clears the sign-in delay (SEC-AUTH-04) and announces identity.password.changed.
// change (signed in, after step-up) needs the current password and ends every other session.
const RESETS_PER_ACCOUNT_HOUR = 3; // Unit 1 section 5.4: reset, 3 per account per hour

interface CP06 {
  resetLinkMinutes: number;
}

interface UserRow {
  id: string;
  display_name: string;
  phone_e164: string;
  email: string;
  password_hash: string;
  mfa_enabled: boolean;
}

export type ResetProof = { token: string } | { phone: string; code: string };

@Injectable()
export class PasswordService {
  constructor(
    private readonly db: DataSource,
    private readonly sessions: SessionService,
    private readonly passwords: PasswordHasher,
    private readonly secondFactor: SecondFactorService,
    private readonly otp: OtpService,
    private readonly audit: AuditService,
    private readonly limiter: RateLimiter,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(NOTIFICATIONS) private readonly notify: NotificationPort,
    @Inject(TB_CONFIG) private readonly config: TbConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(CONFIG_PORT) private readonly params: ConfigPort,
  ) {}

  /** FR-ACC-07: always the same answer; what is sent depends on the account, which is never revealed. */
  async forgot(login: string): Promise<void> {
    const account = normaliseLogin(login);
    if (!account) return;
    const [user] = (await this.db.query(
      'phone' in account
        ? `SELECT id, phone_e164 FROM identity.users WHERE phone_e164 = $1 AND account_status <> 'closed'`
        : `SELECT id, email FROM identity.users WHERE email = $1 AND email_verified_at IS NOT NULL AND account_status <> 'closed'`,
      ['phone' in account ? account.phone : account.email],
    )) as { id: string; phone_e164?: string; email?: string }[];
    if (!user) return;
    if (!(await this.limiter.hit(`rl:reset:user:${user.id}`, RESETS_PER_ACCOUNT_HOUR, 3600)).allowed) return;

    if ('email' in account) {
      const minutes = (await this.params.current()).get<CP06>('CP-06').resetLinkMinutes;
      const token = generateLinkToken();
      await this.db.query(
        `INSERT INTO identity.one_time_tokens (purpose, user_id, token_hash, expires_at) VALUES ('password_reset', $1, $2, $3)`,
        [user.id, hashLinkToken(token), new Date(this.clock.now().getTime() + minutes * 60_000)],
      );
      await this.notify.sendEmail(user.email!, 'password_reset', { link: `${this.config.publicOrigin}/reset-password#token=${token}`, minutes: String(minutes) });
    } else {
      if (!(await this.otp.trySend(user.phone_e164!)).allowed) return;
      const code = generateOtp();
      const cp05 = await this.otp.cp05();
      await this.db.transaction((m) => this.otp.issue(m, { purpose: 'password_reset', phone: user.phone_e164!, userId: user.id }, code));
      await this.notify.sendSms(user.phone_e164!, 'otp_password_reset', { code, minutes: String(cp05.otpValidityMinutes) });
    }
  }

  /** SEC-AUTH-10: a new password from a reset link or code (and the second factor when MFA is on). */
  async reset(proof: ResetProof, newPassword: string, mfaCode: string | undefined, ctx: RequestContext): Promise<void> {
    if ('phone' in proof) {
      const account = normaliseLogin(proof.phone);
      await this.otp.countEntry(`phone:${account && 'phone' in account ? account.phone : proof.phone.trim()}`);
    }
    const now = this.clock.now();
    const outcome = await this.db.transaction(async (m): Promise<{ problem: 'otp-failed' | 'link-invalid' | 'otp-expired' } | { user: UserRow }> => {
      // 1. The proof: find the account without using anything up yet.
      let user: UserRow | undefined;
      let tokenId: string | undefined;
      if ('token' in proof) {
        const [t] = await m.query(
          `SELECT id, user_id FROM identity.one_time_tokens
           WHERE token_hash = $1 AND purpose = 'password_reset' AND used_at IS NULL AND expires_at > $2 FOR UPDATE`,
          [hashLinkToken(proof.token), now],
        );
        if (!t) return { problem: 'link-invalid' };
        tokenId = t.id;
        user = await this.userIn(m, `id = $1`, [t.user_id]);
        if (!user) return { problem: 'link-invalid' };
      } else {
        const account = normaliseLogin(proof.phone);
        user = account && 'phone' in account ? await this.userIn(m, `phone_e164 = $1`, [account.phone]) : undefined;
        if (!user) return { problem: 'otp-failed' }; // the same answer as a wrong code
      }
      // 2. The new password; it names no secret, so it is checked first.
      const refusal = checkPassword(newPassword, { mfa: user.mfa_enabled, context: { displayName: user.display_name, phoneE164: user.phone_e164, email: user.email } });
      if (refusal) throw new Problem('password-rejected', { errors: [{ field: 'newPassword', reason: refusal }] });
      // 3. Spend the proof (a wrong code counts an attempt and is committed).
      if (tokenId) {
        await m.query(`UPDATE identity.one_time_tokens SET used_at = $2 WHERE user_id = $1 AND purpose = 'password_reset' AND used_at IS NULL`, [user.id, now]);
      } else {
        const r = await this.otp.consume(m, `purpose = 'password_reset' AND user_id = $1`, [user.id], (proof as { code: string }).code);
        if (r.kind !== 'ok') return { problem: r.kind === 'failed' ? 'otp-failed' : 'otp-expired' };
      }
      // 4. With MFA on, the second factor too; without it the transaction is undone, so the proof still works.
      if (user.mfa_enabled) {
        if (!mfaCode) throw new Problem('mfa-required');
        if (!(await this.secondFactor.check(user.id, mfaCode, now))) throw new Problem('mfa-failed');
      }
      await this.setPassword(m, user, newPassword, null, 'identity.password.reset', ctx);
      return { user };
    });
    if ('problem' in outcome) throw new Problem(outcome.problem);
    // SEC-AUTH-04: a reset always lifts the sign-in delay.
    await this.redis.del(signInThrottleKey(outcome.user.phone_e164), signInThrottleKey(outcome.user.email.toLowerCase())).catch(() => undefined);
  }

  /** SEC-AUTH-11: signed in, after step-up, with the current password; ends every other session. */
  async change(userId: string, sessionId: string, currentPassword: string, newPassword: string, ctx: RequestContext): Promise<void> {
    const [user] = (await this.db.query(
      `SELECT id, display_name, phone_e164, email, password_hash, mfa_enabled FROM identity.users WHERE id = $1`,
      [userId],
    )) as UserRow[];
    if (!user || !(await this.passwords.verifyOrDummy(user.password_hash, currentPassword))) throw new Problem('password-incorrect');
    const refusal = checkPassword(newPassword, { mfa: user.mfa_enabled, context: { displayName: user.display_name, phoneE164: user.phone_e164, email: user.email } });
    if (refusal) throw new Problem('password-rejected', { errors: [{ field: 'newPassword', reason: refusal }] });
    if (await this.passwords.verifyOrDummy(user.password_hash, newPassword)) {
      throw new Problem('password-rejected', { errors: [{ field: 'newPassword', reason: 'unchanged' }] });
    }
    await this.db.transaction((m) => this.setPassword(m, user, newPassword, sessionId, 'identity.password.changed', ctx));
  }

  private async setPassword(m: EntityManager, user: UserRow, password: string, keepSession: string | null, auditAction: string, ctx: RequestContext) {
    const now = this.clock.now();
    const singleFactorOk = [...password.normalize('NFC')].length >= MIN_LENGTH_SINGLE_FACTOR;
    await m.query(
      `UPDATE identity.users SET password_hash = $2, password_single_factor_ok = $3, password_changed_at = $4, updated_at = $4 WHERE id = $1`,
      [user.id, await this.passwords.hash(password), singleFactorOk, now],
    );
    await this.sessions.endAllIn(m, user.id, keepSession, 'password_changed', ctx);
    await publish(m, 'identity.password.changed', user.id, { userId: user.id, via: keepSession ? 'change' : 'reset' });
    await this.audit.record(m, {
      actorType: 'user', actorId: user.id, action: auditAction, objectType: 'user', objectId: user.id,
      sourceIp: ctx.ip, correlationId: ctx.correlationId,
    });
  }

  private async userIn(m: EntityManager, where: string, params: unknown[]): Promise<UserRow | undefined> {
    const [u] = await m.query(
      `SELECT id, display_name, phone_e164, email, password_hash, mfa_enabled FROM identity.users
       WHERE ${where} AND account_status <> 'closed' FOR UPDATE`,
      params,
    );
    return u;
  }
}
