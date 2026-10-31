import { Inject, Injectable } from '@nestjs/common';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { CLOCK, Clock } from '../../../kernel/clock';
import { TbConfig } from '../../../kernel/config/config';
import { TB_CONFIG } from '../../../kernel/config/config.provider';
import { CONFIG_PORT, ConfigPort } from '../../../kernel/config-port';
import { Problem } from '../../../kernel/http/problems';
import { NOTIFICATIONS, NotificationPort } from '../adapters/notifications';
import { generateLinkToken, generateOtp, hashLinkToken } from '../crypto/otp';
import { AuditService } from './audit.service';
import { OtpService, RESEND_GAP_SECONDS } from './otp.service';
import { publish } from './outbox';
import { bangladeshiMobile } from './phone';
import { RequestContext } from './session.service';

// Contact changes (Unit 1 section 6.5; FR-ACC-09). Both start after step-up.
// New number: an SMS code to the new number, bound to this session; the code replaces the number, unless
// another open account holds it (unique index). The old number is told.
// New e-mail: a link of purpose email_change to the new address; using it replaces the address (verified)
// and the old address is told. Earlier e-mail links of the account stop working.
// If the new number already belongs to an open account, the same is done as at registration: a code is
// made but not sent, its owner is told, and the answer is the same (SEC-AUTH-06).
interface CP06 {
  emailLinkHours: number;
}

const rowsOf = <T>(result: unknown): T[] =>
  (Array.isArray(result) && Array.isArray(result[0]) && typeof result[1] === 'number' ? result[0] : result) as T[];

export const isUniqueViolation = (e: unknown) => e instanceof QueryFailedError && (e as unknown as { code?: string }).code === '23505';

@Injectable()
export class ContactService {
  constructor(
    private readonly db: DataSource,
    private readonly otp: OtpService,
    private readonly audit: AuditService,
    @Inject(NOTIFICATIONS) private readonly notify: NotificationPort,
    @Inject(TB_CONFIG) private readonly config: TbConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(CONFIG_PORT) private readonly params: ConfigPort,
  ) {}

  async startPhoneChange(userId: string, sessionId: string, input: string): Promise<{ resendAt: string }> {
    const phone = bangladeshiMobile(input);
    if (!phone) throw new Problem('validation-failed', { errors: [{ field: 'phone', reason: 'not-bangladeshi-mobile' }] });
    const [me] = await this.db.query(`SELECT phone_e164 FROM identity.users WHERE id = $1`, [userId]);
    if (me?.phone_e164 === phone) throw new Problem('validation-failed', { errors: [{ field: 'phone', reason: 'unchanged' }] });
    await this.otp.countSend(phone);
    const [taken] = await this.db.query(`SELECT 1 FROM identity.users WHERE phone_e164 = $1 AND account_status <> 'closed'`, [phone]);
    const code = generateOtp();
    const cp05 = await this.otp.cp05();
    await this.db.transaction((m) => this.otp.issue(m, { purpose: 'contact_change_phone', phone, userId, boundTo: sessionId }, code));
    if (taken) await this.notify.sendSms(phone, 'contact_change_attempt_existing_number', {});
    else await this.notify.sendSms(phone, 'otp_phone_change', { code, minutes: String(cp05.otpValidityMinutes) });
    return { resendAt: new Date(this.clock.now().getTime() + RESEND_GAP_SECONDS * 1000).toISOString() };
  }

  async verifyPhoneChange(userId: string, sessionId: string, code: string, ctx: RequestContext): Promise<void> {
    await this.otp.countEntry(`user:${userId}`);
    const where = `purpose = 'contact_change_phone' AND user_id = $1 AND bound_to = $2`;
    let old: string | undefined;
    try {
      const r = await this.db.transaction(async (m) => {
        const check = await this.otp.consume(m, where, [userId, sessionId], code);
        if (check.kind !== 'ok') return check.kind;
        const [ch] = await m.query(`SELECT phone_e164 FROM identity.otp_challenges WHERE id = $1`, [check.challengeId]);
        const [me] = await m.query(`SELECT phone_e164 FROM identity.users WHERE id = $1 FOR UPDATE`, [userId]);
        old = me.phone_e164;
        await m.query(`UPDATE identity.users SET phone_e164 = $2, phone_verified_at = $3, updated_at = $3 WHERE id = $1`, [userId, ch.phone_e164, this.clock.now()]);
        await this.changed(m, userId, 'phone', ctx);
        return 'ok' as const;
      });
      if (r === 'failed') throw new Problem('otp-failed');
      if (r === 'expired') throw new Problem('otp-expired');
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      // Another open account holds the number: the code is used up all the same.
      await this.db.transaction(async (m) => {
        const [ch] = await m.query(`SELECT id FROM identity.otp_challenges WHERE ${where} ORDER BY created_at DESC, id LIMIT 1 FOR UPDATE`, [userId, sessionId]);
        if (ch) await this.otp.markUsed(m, ch.id);
      });
      throw new Problem('contact-unavailable');
    }
    if (old) await this.notify.sendSms(old, 'contact_changed', { kind: 'phone' });
  }

  async startEmailChange(userId: string, input: string): Promise<void> {
    const email = input.trim().toLowerCase();
    const [me] = await this.db.query(`SELECT email FROM identity.users WHERE id = $1`, [userId]);
    if (String(me?.email).toLowerCase() === email) throw new Problem('validation-failed', { errors: [{ field: 'email', reason: 'unchanged' }] });
    const hours = (await this.params.current()).get<CP06>('CP-06').emailLinkHours;
    const token = generateLinkToken();
    await this.db.query(
      `INSERT INTO identity.one_time_tokens (purpose, user_id, token_hash, new_email, expires_at) VALUES ('email_change', $1, $2, $3, $4)`,
      [userId, hashLinkToken(token), email, new Date(this.clock.now().getTime() + hours * 3_600_000)],
    );
    await this.notify.sendEmail(email, 'email_change', { link: `${this.config.publicOrigin}/verify-email#token=${token}`, hours: String(hours) });
  }

  /**
   * FR-ACC-02, FR-ACC-09: an e-mail link. email_verify marks the address verified; email_change replaces the
   * address with the new, now verified, one and tells the old address. A link works once.
   */
  async verifyEmail(token: string, ctx: RequestContext): Promise<void> {
    const now = this.clock.now();
    let oldEmail: string | undefined;
    try {
      const done = await this.db.transaction(async (m) => {
        const [t] = rowsOf<{ user_id: string; purpose: string; new_email: string | null }>(
          await m.query(
            `UPDATE identity.one_time_tokens SET used_at = $2
             WHERE token_hash = $1 AND purpose IN ('email_verify', 'email_change') AND used_at IS NULL AND expires_at > $2
             RETURNING user_id, purpose, new_email`,
            [hashLinkToken(token), now],
          ),
        );
        if (!t) return false;
        const [live] = await m.query(`SELECT 1 FROM identity.users WHERE id = $1 AND account_status <> 'closed'`, [t.user_id]);
        if (!live) return false;
        if (t.purpose === 'email_change') {
          oldEmail = await this.applyEmailChange(m, t.user_id, t.new_email!, ctx);
          return true;
        }
        await m.query(`UPDATE identity.users SET email_verified_at = COALESCE(email_verified_at, $2), updated_at = $2 WHERE id = $1`, [t.user_id, now]);
        await this.audit.record(m, {
          actorType: 'user', actorId: t.user_id, action: 'identity.email.verified', objectType: 'user', objectId: t.user_id,
          sourceIp: ctx.ip, correlationId: ctx.correlationId,
        });
        return true;
      });
      if (!done) throw new Problem('link-invalid');
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      // Another open account took the address meanwhile: this link is used up all the same.
      await this.db.query(`UPDATE identity.one_time_tokens SET used_at = $2 WHERE token_hash = $1 AND used_at IS NULL`, [hashLinkToken(token), now]);
      throw new Problem('contact-unavailable');
    }
    if (oldEmail) await this.notify.sendEmail(oldEmail, 'contact_changed', { kind: 'email' });
  }

  private async applyEmailChange(m: EntityManager, userId: string, newEmail: string, ctx: RequestContext): Promise<string> {
    const now = this.clock.now();
    const [me] = await m.query(`SELECT email FROM identity.users WHERE id = $1 FOR UPDATE`, [userId]);
    await m.query(`UPDATE identity.users SET email = $2, email_verified_at = $3, updated_at = $3 WHERE id = $1`, [userId, newEmail, now]);
    await m.query(
      `UPDATE identity.one_time_tokens SET used_at = $2 WHERE user_id = $1 AND purpose IN ('email_verify', 'email_change') AND used_at IS NULL`,
      [userId, now],
    );
    await this.changed(m, userId, 'email', ctx);
    return me.email;
  }

  private async changed(m: EntityManager, userId: string, kind: 'phone' | 'email', ctx: RequestContext): Promise<void> {
    await publish(m, 'identity.contact.changed', userId, { userId, kind });
    await this.audit.record(m, {
      actorType: 'user', actorId: userId, action: `identity.contact.${kind}_changed`, objectType: 'user', objectId: userId,
      sourceIp: ctx.ip, correlationId: ctx.correlationId,
    });
  }
}
