import { Inject, Injectable } from '@nestjs/common';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { CLOCK, Clock } from '../../../kernel/clock';
import { TbConfig } from '../../../kernel/config/config';
import { TB_CONFIG } from '../../../kernel/config/config.provider';
import { CONFIG_PORT, ConfigPort } from '../../../kernel/config-port';
import { Problem } from '../../../kernel/http/problems';
import { NOTIFICATIONS, NotificationPort } from '../adapters/notifications';
import { generateLinkToken, generateOtp, hashLinkToken, hashOtp, otpMatches } from '../crypto/otp';
import { PasswordHasher } from '../crypto/password';
import { checkPassword } from '../crypto/password-policy';
import type { IssuedCookies } from '../http/session-cookies';
import { RateLimiter } from '../security/rate-limiter.service';
import { AuditService } from './audit.service';
import { publish } from './outbox';
import { RequestContext, SessionService } from './session.service';

// Registration (Unit 1 section 6.1; FR-ACC-01 to FR-ACC-04, SEC-AUTH-01, 02, 06, 09; FR-PRV-01).
// 1. register: the details are checked and kept in pending_registrations; nothing exists in users yet.
//    A new number gets an OTP by SMS. A number that already has an open account gets no code; its owner is
//    told instead. The answer, and the work done (one Argon2id hash, one challenge row), are the same.
// 2. verify: the right code creates the account, its consents and an e-mail verification link in one
//    transaction, and signs the person in. Five wrong codes end the challenge (also enforced by the database).
//    An e-mail already used by an open account is refused with a generic answer; its owner is told.
// 3. The e-mail link sets email_verified_at, which @Verified actions require (FR-ACC-02).
export const RESEND_GAP_SECONDS = 60; // Decisions log (U1-03): the "resend time" of the 202 answer.
const VERIFY_PER_NUMBER_HOUR = 20; // CP-05: 20 entries per account (here: per number) per hour

interface CP05 {
  otpValidityMinutes: number;
  attemptsPerOtp: number;
  sendsPerNumberHour: number;
  sendsPerNumberDay: number;
}
interface CP06 {
  emailLinkHours: number;
}

export interface RegistrationInput {
  phone: string;
  email: string;
  displayName: string;
  password: string;
  termsVersion: string;
  privacyVersion: string;
  adultConfirmed: boolean;
}

export interface RegistrationStarted {
  registrationId: string;
  resendAt: string;
}

interface PendingRow {
  id: string;
  phone_e164: string;
  email: string;
  display_name: string;
  password_hash: string;
  terms_version: string;
  privacy_version: string;
  completed_at: Date | null;
  source_ip: string | null;
}

// TypeORM's PostgreSQL driver answers UPDATE ... RETURNING with [rows, count], INSERT/SELECT with rows.
const rowsOf = <T>(result: unknown): T[] =>
  (Array.isArray(result) && Array.isArray(result[0]) && typeof result[1] === 'number' ? result[0] : result) as T[];

/** E.164 for a Bangladeshi mobile number (+8801[3-9]XXXXXXXX), or null. */
export function bangladeshiMobile(input: string): string | null {
  const p = parsePhoneNumberFromString(input.trim(), 'BD');
  return p?.isValid() && /^\+8801[3-9]\d{8}$/.test(p.number) ? p.number : null;
}

const isUniqueViolation = (e: unknown) => e instanceof QueryFailedError && (e as unknown as { code?: string }).code === '23505';

@Injectable()
export class RegistrationService {
  constructor(
    private readonly db: DataSource,
    private readonly sessions: SessionService,
    private readonly passwords: PasswordHasher,
    private readonly audit: AuditService,
    private readonly limiter: RateLimiter,
    @Inject(NOTIFICATIONS) private readonly notify: NotificationPort,
    @Inject(TB_CONFIG) private readonly config: TbConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(CONFIG_PORT) private readonly params: ConfigPort,
  ) {}

  private get pepper(): string {
    return this.config.secrets.otpPepper.reveal();
  }

  async register(input: RegistrationInput, ctx: RequestContext): Promise<RegistrationStarted> {
    const phone = bangladeshiMobile(input.phone);
    if (!phone) throw new Problem('validation-failed', { errors: [{ field: 'phone', reason: 'not-bangladeshi-mobile' }] });
    const email = input.email.trim().toLowerCase();
    const displayName = input.displayName.trim().replace(/\s+/g, ' ');
    const legal = this.config.legal;
    const outdated = [
      ...(input.termsVersion !== legal.termsVersion ? [{ field: 'termsVersion', reason: 'not-current' }] : []),
      ...(input.privacyVersion !== legal.privacyVersion ? [{ field: 'privacyVersion', reason: 'not-current' }] : []),
      ...(input.adultConfirmed !== true ? [{ field: 'adultConfirmed', reason: 'required' }] : []),
    ];
    if (outdated.length > 0) throw new Problem('validation-failed', { errors: outdated });
    const refusal = checkPassword(input.password, { mfa: false, context: { displayName, phoneE164: phone, email } });
    if (refusal) throw new Problem('password-rejected', { errors: [{ field: 'password', reason: refusal }] });

    await this.countSend(phone);
    const cp05 = await this.cp05();
    const passwordHash = await this.passwords.hash(input.password);
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + cp05.otpValidityMinutes * 60_000);
    const existing = await this.liveAccountWithPhone(phone);
    const code = generateOtp(); // for an existing number it is never sent, so it can never be entered

    const registrationId = await this.db.transaction(async (m) => {
      const [{ id }] = await m.query(
        `INSERT INTO identity.pending_registrations (phone_e164, email, display_name, password_hash, password_single_factor_ok,
                                                     terms_version, privacy_version, adult_confirmed, expires_at, source_ip)
         VALUES ($1, $2, $3, $4, true, $5, $6, true, $7, $8) RETURNING id`,
        [phone, email, displayName, passwordHash, input.termsVersion, input.privacyVersion, expiresAt, ctx.ip],
      );
      await this.newChallenge(m, id, phone, code, now, expiresAt, cp05.attemptsPerOtp);
      return id as string;
    });

    if (existing) await this.notify.sendSms(phone, 'register_attempt_existing_number', {});
    else await this.notify.sendSms(phone, 'otp_register', { code, minutes: String(cp05.otpValidityMinutes) });
    return { registrationId, resendAt: new Date(now.getTime() + RESEND_GAP_SECONDS * 1000).toISOString() };
  }

  /** SEC-AUTH-09: a new code for the same registration; the earlier one stops working. */
  async resend(registrationId: string): Promise<RegistrationStarted> {
    const [p] = await this.db.query(`SELECT phone_e164 FROM identity.pending_registrations WHERE id = $1 AND completed_at IS NULL`, [registrationId]);
    if (!p) throw new Problem('not-found');
    const phone: string = p.phone_e164;
    await this.countSend(phone);
    const cp05 = await this.cp05();
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + cp05.otpValidityMinutes * 60_000);
    const existing = await this.liveAccountWithPhone(phone);
    const code = generateOtp();
    await this.db.transaction(async (m) => {
      await m.query(`UPDATE identity.pending_registrations SET expires_at = $2 WHERE id = $1`, [registrationId, expiresAt]);
      await this.newChallenge(m, registrationId, phone, code, now, expiresAt, cp05.attemptsPerOtp);
    });
    // The owner of an existing number was told once, at registration; a resend sends nothing to them.
    if (!existing) await this.notify.sendSms(phone, 'otp_register', { code, minutes: String(cp05.otpValidityMinutes) });
    return { registrationId, resendAt: new Date(now.getTime() + RESEND_GAP_SECONDS * 1000).toISOString() };
  }

  /** FR-ACC-02: the right code creates the account and signs the person in. */
  async verify(registrationId: string, code: string, deviceKey: string | undefined, ctx: RequestContext): Promise<IssuedCookies> {
    const now = this.clock.now();
    const [p] = await this.db.query(`SELECT phone_e164 FROM identity.pending_registrations WHERE id = $1`, [registrationId]);
    if (!p) throw new Problem('otp-expired');
    const r = await this.limiter.hit(`rl:otp-verify:phone:${p.phone_e164}`, VERIFY_PER_NUMBER_HOUR, 3600);
    if (!r.allowed) throw new Problem('rate-limited', { retryAfter: r.retryAfterSeconds });

    let outcome: { kind: 'created'; cookies: IssuedCookies; email: string; token: string } | { kind: 'failed' | 'expired' } | { kind: 'refused'; pending: PendingRow };
    try {
      outcome = await this.db.transaction(async (m) => {
        const [pending] = (await m.query(`SELECT * FROM identity.pending_registrations WHERE id = $1 FOR UPDATE`, [registrationId])) as PendingRow[];
        if (!pending || pending.completed_at) return { kind: 'expired' as const };
        const [ch] = await m.query(
          `SELECT id, code_hash, attempts, max_attempts, expires_at, consumed_at FROM identity.otp_challenges
           WHERE pending_registration_id = $1 ORDER BY created_at DESC, id LIMIT 1 FOR UPDATE`,
          [registrationId],
        );
        if (!ch || ch.consumed_at || new Date(ch.expires_at) <= now || ch.attempts >= ch.max_attempts) return { kind: 'expired' as const };
        if (!otpMatches(this.pepper, code, ch.code_hash)) {
          await m.query(`UPDATE identity.otp_challenges SET attempts = attempts + 1 WHERE id = $1`, [ch.id]);
          return { kind: 'failed' as const };
        }
        await this.close(m, registrationId, ch.id, now);
        const [taken] = await m.query(
          `SELECT 1 FROM identity.users WHERE (phone_e164 = $1 OR email = $2) AND account_status <> 'closed' LIMIT 1`,
          [pending.phone_e164, pending.email],
        );
        if (taken) return { kind: 'refused' as const, pending };
        return { kind: 'created' as const, ...(await this.createAccount(m, pending, deviceKey, ctx, now)) };
      });
    } catch (e) {
      // Another registration took the number or e-mail between the check and the insert (unique indexes).
      if (!isUniqueViolation(e)) throw e;
      const [pending] = (await this.db.query(`SELECT * FROM identity.pending_registrations WHERE id = $1`, [registrationId])) as PendingRow[];
      await this.db.transaction(async (m) => {
        const [ch] = await m.query(
          `SELECT id FROM identity.otp_challenges WHERE pending_registration_id = $1 ORDER BY created_at DESC, id LIMIT 1 FOR UPDATE`,
          [registrationId],
        );
        await this.close(m, registrationId, ch.id, now);
      });
      outcome = { kind: 'refused', pending };
    }

    switch (outcome.kind) {
      case 'failed':
        throw new Problem('otp-failed');
      case 'expired':
        throw new Problem('otp-expired');
      case 'refused':
        await this.tellOwners(outcome.pending);
        throw new Problem('registration-refused');
      case 'created': {
        const link = `${this.config.publicOrigin}/verify-email#token=${outcome.token}`;
        await this.notify.sendEmail(outcome.email, 'email_verify', { link, hours: String((await this.cp06()).emailLinkHours) });
        return outcome.cookies;
      }
    }
  }

  /** FR-ACC-02: the single-use e-mail link. */
  async verifyEmail(token: string, ctx: RequestContext): Promise<void> {
    const now = this.clock.now();
    const done = await this.db.transaction(async (m) => {
      const [t] = rowsOf<{ user_id: string }>(
        await m.query(
          `UPDATE identity.one_time_tokens SET used_at = $2
           WHERE token_hash = $1 AND purpose = 'email_verify' AND used_at IS NULL AND expires_at > $2 RETURNING user_id`,
          [hashLinkToken(token), now],
        ),
      );
      if (!t) return false;
      const [u] = rowsOf<{ id: string }>(
        await m.query(
          `UPDATE identity.users SET email_verified_at = COALESCE(email_verified_at, $2), updated_at = $2
           WHERE id = $1 AND account_status <> 'closed' RETURNING id`,
          [t.user_id, now],
        ),
      );
      if (!u) return false;
      await this.audit.record(m, {
        actorType: 'user', actorId: t.user_id, action: 'identity.email.verified', objectType: 'user', objectId: t.user_id,
        sourceIp: ctx.ip, correlationId: ctx.correlationId,
      });
      return true;
    });
    if (!done) throw new Problem('link-invalid');
  }

  private async createAccount(m: EntityManager, p: PendingRow, deviceKey: string | undefined, ctx: RequestContext, now: Date) {
    const [{ id: userId }] = await m.query(
      `INSERT INTO identity.users (display_name, phone_e164, phone_verified_at, email, password_hash, password_single_factor_ok,
                                   password_changed_at, adult_confirmed_at)
       VALUES ($1, $2, $3, $4, $5, true, $3, $3) RETURNING id`,
      [p.display_name, p.phone_e164, now, p.email, p.password_hash],
    );
    await m.query(
      `INSERT INTO identity.consents (user_id, document, version, granted, recorded_at, source_ip)
       VALUES ($1, 'terms', $2, true, $4, $5), ($1, 'privacy', $3, true, $4, $5)`,
      [userId, p.terms_version, p.privacy_version, now, p.source_ip],
    );
    const token = generateLinkToken();
    const hours = (await this.cp06()).emailLinkHours;
    await m.query(
      `INSERT INTO identity.one_time_tokens (purpose, user_id, token_hash, expires_at) VALUES ('email_verify', $1, $2, $3)`,
      [userId, hashLinkToken(token), new Date(now.getTime() + hours * 3_600_000)],
    );
    await publish(m, 'identity.user.registered', userId, { userId });
    await this.audit.record(m, {
      actorType: 'user', actorId: userId, action: 'identity.account.registered', objectType: 'user', objectId: userId,
      sourceIp: ctx.ip, correlationId: ctx.correlationId,
    });
    const { cookies } = await this.sessions.create(m, userId, deviceKey, ctx);
    return { cookies, email: p.email as string, token };
  }

  /** The challenge is used up and the registration finished, whether or not an account results. */
  private async close(m: EntityManager, registrationId: string, challengeId: string, now: Date): Promise<void> {
    await m.query(`UPDATE identity.otp_challenges SET consumed_at = $2 WHERE id = $1`, [challengeId, now]);
    await m.query(`UPDATE identity.pending_registrations SET completed_at = $2 WHERE id = $1`, [registrationId, now]);
  }

  /** SEC-AUTH-06: the owner of the number or e-mail is told that someone tried to register with it. */
  private async tellOwners(p: PendingRow): Promise<void> {
    const owners = await this.db.query(
      `SELECT phone_e164, email FROM identity.users WHERE (phone_e164 = $1 OR email = $2) AND account_status <> 'closed'`,
      [p.phone_e164, p.email],
    );
    for (const o of owners) {
      if (String(o.email).toLowerCase() === p.email.toLowerCase()) await this.notify.sendEmail(o.email, 'register_attempt_existing_email', {});
      else await this.notify.sendSms(o.phone_e164, 'register_attempt_existing_number', {});
    }
  }

  private async newChallenge(m: EntityManager, registrationId: string, phone: string, code: string, now: Date, expiresAt: Date, maxAttempts: number) {
    await m.query(
      `INSERT INTO identity.otp_challenges (purpose, pending_registration_id, phone_e164, code_hash, max_attempts, created_at, expires_at)
       VALUES ('register_phone', $1, $2, $3, $4, $5, $6)`,
      [registrationId, phone, hashOtp(this.pepper, code), maxAttempts, now, expiresAt],
    );
  }

  /** CP-05 send limits per number (Redis otp:send:{phone}:h and :d) and the gap before a resend. */
  private async countSend(phone: string): Promise<void> {
    const cp05 = await this.cp05();
    const gap = await this.limiter.hit(`otp:gap:${phone}`, 1, RESEND_GAP_SECONDS);
    if (!gap.allowed) throw new Problem('rate-limited', { retryAfter: gap.retryAfterSeconds });
    for (const [key, limit, window] of [[`otp:send:${phone}:h`, cp05.sendsPerNumberHour, 3600], [`otp:send:${phone}:d`, cp05.sendsPerNumberDay, 86400]] as const) {
      const r = await this.limiter.hit(key, limit, window);
      if (!r.allowed) throw new Problem('rate-limited', { retryAfter: r.retryAfterSeconds });
    }
  }

  private async liveAccountWithPhone(phone: string): Promise<boolean> {
    const [u] = await this.db.query(`SELECT 1 FROM identity.users WHERE phone_e164 = $1 AND account_status <> 'closed' LIMIT 1`, [phone]);
    return Boolean(u);
  }

  private async cp05(): Promise<CP05> {
    return (await this.params.current()).get<CP05>('CP-05');
  }

  private async cp06(): Promise<CP06> {
    return (await this.params.current()).get<CP06>('CP-06');
  }
}
