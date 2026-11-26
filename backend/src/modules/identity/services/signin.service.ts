import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import type Redis from 'ioredis';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { DataSource } from 'typeorm';
import { CLOCK, Clock } from '../../../kernel/clock';
import { TbConfig } from '../../../kernel/config/config';
import { TB_CONFIG } from '../../../kernel/config/config.provider';
import { Problem } from '../../../kernel/http/problems';
import { REDIS } from '../../../kernel/redis.provider';
import { NOTIFICATIONS, NotificationPort } from '../adapters/notifications';
import { generateOtp, hashOtp, otpMatches } from '../crypto/otp';
import { PasswordHasher } from '../crypto/password';
import type { IssuedCookies } from '../http/session-cookies';
import { RateLimiter } from '../security/rate-limiter.service';
import { AuditService } from './audit.service';
import { SecondFactorService } from './second-factor.service';
import { HumanCheck } from '../security/human-check';
import { SignInThrottle } from './signin-throttle.service';

/** SEC-ABU-02: failures of one login before a sign-in needs a solved challenge (CP-04 delays from the fifth). */
export const HUMAN_CHECK_AFTER_FAILURES = 3;
import { RequestContext, SessionService } from './session.service';
import { securityEvents } from '../../../kernel/metrics/metrics';

// Sign-in (Unit 1 section 6.2; FR-ACC-05, FR-ACC-06, SEC-AUTH-03 to SEC-AUTH-05, SEC-LOG-01).
// 1. The number or e-mail and the password. Unknown, closed and wrong all get the same 401 after the same
//    Argon2id work. After CP-04 failures for one login, the next attempt must wait 1 s, doubling to 15 min
//    (DV-10); the first wait notifies the owner. A success clears the count (as will a password reset, U1-05).
// 2. With MFA on: a 5-minute ticket (DV-1), only its hash kept in Redis, then the TOTP or a recovery code.
//    Each code works once; five wrong codes end the ticket.
export const MFA_TICKET_SECONDS = 300; // DV-1
const MFA_ATTEMPTS = 5; // CP-05: attempts per challenge
const sha256hex = (s: string) => createHash('sha256').update(s).digest('hex');
export { signInThrottleKey } from './signin-throttle.service';
const USER_COLUMNS = `SELECT id, password_hash, mfa_enabled, phone_e164, email, email_verified_at IS NOT NULL AS email_verified, email_two_step FROM identity.users`;
const BY_PHONE = `${USER_COLUMNS} WHERE phone_e164 = $1 AND account_status <> 'closed' LIMIT 1`;
const BY_EMAIL = `${USER_COLUMNS} WHERE email = $1 AND account_status <> 'closed' LIMIT 1`;

interface UserRow {
  id: string;
  password_hash: string | null;
  mfa_enabled: boolean;
  phone_e164: string | null;
  email: string | null;
  email_verified: boolean;
  email_two_step: boolean;
}

/** U10-25: the e-mail code is valid 10 minutes, five tries, at most 3 sends a sign-in with 60 seconds between; a remembered device skips the step for 30 days. */
export const EMAIL_CODE_SECONDS = 600;
export const EMAIL_CODE_SENDS = 3;
export const EMAIL_CODE_GAP_SECONDS = 60;
export const TRUSTED_DEVICE_DAYS = 30;
const DEVICE_KEY = /^[A-Za-z0-9_-]{43}$/;

export type SignInResult =
  | { kind: 'session'; cookies: IssuedCookies }
  | { kind: 'mfa'; ticket: string; method: 'totp' }
  | { kind: 'mfa'; ticket: string; method: 'email'; emailHint: string; resendAfter: number };

/** "r***m@example.com": enough to recognise the address, not to learn it. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  const shown = local.length <= 2 ? local[0] : `${local[0]}***${local[local.length - 1]}`;
  return `${shown}@${domain}`;
}

interface Ticket { userId: string; attempts: number; until: number; method?: 'email'; codeHash?: string; sends?: number; sentAt?: number }

/** E.164 for a Bangladeshi mobile number, the lower-cased address for an e-mail, or null. */
export function normaliseLogin(login: string): { phone: string } | { email: string } | null {
  const s = login.trim();
  if (s.includes('@')) return /^[^\s@]+@[^\s@]+$/.test(s) && s.length <= 254 ? { email: s.toLowerCase() } : null;
  const p = parsePhoneNumberFromString(s, 'BD');
  return p?.isValid() && /^\+8801[3-9]\d{8}$/.test(p.number) ? { phone: p.number } : null;
}

@Injectable()
export class SignInService {
  constructor(
    private readonly db: DataSource,
    private readonly sessions: SessionService,
    private readonly passwords: PasswordHasher,
    private readonly audit: AuditService,
    private readonly limiter: RateLimiter,
    private readonly secondFactor: SecondFactorService,
    private readonly throttle: SignInThrottle,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(NOTIFICATIONS) private readonly notify: NotificationPort,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly human: HumanCheck,
    @Inject(TB_CONFIG) private readonly config: TbConfig,
  ) {}

  async signIn(login: string, password: string, deviceKey: string | undefined, ctx: RequestContext): Promise<SignInResult> {
    const account = normaliseLogin(login);
    // Keyed by the login as typed (normalised), so unknown accounts are throttled exactly like real ones.
    const failKey = account ? Object.values(account)[0] : login.trim().toLowerCase();
    const now = this.clock.now();
    await this.throttle.check(failKey);
    // SEC-ABU-02: after repeated failures for this login the next attempt needs a solved challenge (428 otherwise)
    if (!ctx.humanChecked && (await this.throttle.failures(failKey)) >= HUMAN_CHECK_AFTER_FAILURES) await this.human.require('signin', ctx.ip ?? '', ctx.humanProof);

    let user: UserRow | undefined;
    if (account) {
      [user] = await this.db.query('phone' in account ? BY_PHONE : BY_EMAIL, ['phone' in account ? account.phone : account.email]);
    }
    const ok = await this.passwords.verifyOrDummy(user?.password_hash, password);

    if (!ok || !user) {
      await this.failed(failKey, user, ctx);
      throw new Problem('signin-failed');
    }
    await this.throttle.clear(failKey);
    if (this.passwords.needsRehash(user.password_hash!)) {
      await this.db.query(`UPDATE identity.users SET password_hash = $2 WHERE id = $1`, [user.id, await this.passwords.hash(password)]);
    }

    // a remembered device (a passed second factor with the box ticked, 30 days) goes straight in
    const trusted = await this.deviceTrusted(user.id, deviceKey, now);
    if (!trusted && user.mfa_enabled) {
      const ticket = randomBytes(32).toString('base64url');
      await this.redis.set(`mfa:ticket:${sha256hex(ticket)}`, JSON.stringify({ userId: user.id, attempts: 0, until: now.getTime() + MFA_TICKET_SECONDS * 1000 } satisfies Ticket), 'EX', MFA_TICKET_SECONDS);
      return { kind: 'mfa', ticket, method: 'totp' };
    }
    // U10-25: with no authenticator app, the member's default is a code by e-mail, sent only now that the password is right (so nobody can fill an inbox
    // without it). A member without a verified e-mail address, or who turned the step off after step-up, signs in with the password alone.
    if (!trusted && user.email_two_step && user.email_verified && user.email) {
      const ticket = randomBytes(32).toString('base64url');
      const code = generateOtp();
      const t: Ticket = { userId: user.id, attempts: 0, until: now.getTime() + EMAIL_CODE_SECONDS * 1000, method: 'email', codeHash: hashOtp(this.pepper, code).toString('hex'), sends: 1, sentAt: now.getTime() };
      await this.redis.set(`mfa:ticket:${sha256hex(ticket)}`, JSON.stringify(t), 'EX', EMAIL_CODE_SECONDS);
      await this.notify.sendEmail(user.email, 'otp_signin_email', { code, minutes: String(EMAIL_CODE_SECONDS / 60) });
      await this.db.transaction((m) => this.audit.record(m, { actorType: 'user', actorId: user.id, action: 'identity.signin.code_sent', objectType: 'user', objectId: user.id, sourceIp: ctx.ip, correlationId: ctx.correlationId }));
      securityEvents.otpSent.inc({ purpose: 'signin_email' });
      return { kind: 'mfa', ticket, method: 'email', emailHint: maskEmail(user.email), resendAfter: EMAIL_CODE_GAP_SECONDS };
    }
    return { kind: 'session', cookies: await this.startSession(user.id, deviceKey, ctx, 'password', false) };
  }

  private get pepper(): string {
    return this.config.secrets.otpPepper.reveal();
  }

  /** U10-25: has this browser passed a second factor here with 'remember this device' ticked, and is that still within its 30 days? */
  private async deviceTrusted(userId: string, deviceKey: string | undefined, now: Date): Promise<boolean> {
    if (!deviceKey || !DEVICE_KEY.test(deviceKey)) return false;
    const [d] = await this.db.query(`SELECT 1 FROM identity.known_devices WHERE user_id = $1 AND device_key_hash = $2 AND trusted_until > $3`, [userId, createHash('sha256').update(deviceKey).digest(), now]);
    return Boolean(d);
  }

  /** POST /auth/signin/mfa/resend (U10-25): a new code for the same ticket; 60 seconds apart, three sends in all. The old code stops working. */
  async resendEmailCode(ticket: string | undefined, ctx: RequestContext): Promise<{ resendAfter: number }> {
    if (!ticket) throw new Problem('session-ended');
    const key = `mfa:ticket:${sha256hex(ticket)}`;
    const raw = await this.redis.get(key);
    if (!raw) throw new Problem('session-ended');
    const t = JSON.parse(raw) as Ticket;
    const now = this.clock.now().getTime();
    if (t.method !== 'email') throw new Problem('validation-failed', { errors: [{ field: 'ticket', reason: 'not-an-e-mail-code' }] });
    const waited = Math.ceil(((t.sentAt ?? 0) + EMAIL_CODE_GAP_SECONDS * 1000 - now) / 1000);
    if (waited > 0) throw new Problem('rate-limited', { retryAfter: waited });
    if ((t.sends ?? 1) >= EMAIL_CODE_SENDS) throw new Problem('rate-limited', { retryAfter: Math.max(1, Math.ceil((t.until - now) / 1000)) });
    const [u] = await this.db.query(`SELECT email FROM identity.users WHERE id = $1 AND account_status <> 'closed' AND email_verified_at IS NOT NULL`, [t.userId]);
    if (!u?.email) throw new Problem('session-ended');
    const r = await this.limiter.hit(`rl:signin-code-send:user:${t.userId}`, 10, 3600);
    if (!r.allowed) throw new Problem('rate-limited', { retryAfter: r.retryAfterSeconds });
    const code = generateOtp();
    const remaining = t.until - now;
    if (remaining <= 0) throw new Problem('session-ended');
    await this.redis.set(key, JSON.stringify({ ...t, codeHash: hashOtp(this.pepper, code).toString('hex'), attempts: 0, sends: (t.sends ?? 1) + 1, sentAt: now } satisfies Ticket), 'PX', remaining);
    await this.notify.sendEmail(u.email, 'otp_signin_email', { code, minutes: String(Math.max(1, Math.ceil(remaining / 60000))) });
    securityEvents.otpSent.inc({ purpose: 'signin_email' });
    await this.db.transaction((m) => this.audit.record(m, { actorType: 'user', actorId: t.userId, action: 'identity.signin.code_sent', objectType: 'user', objectId: t.userId, sourceIp: ctx.ip, correlationId: ctx.correlationId }));
    return { resendAfter: EMAIL_CODE_GAP_SECONDS };
  }

  async verifyMfa(ticket: string | undefined, code: string, deviceKey: string | undefined, ctx: RequestContext, remember = false): Promise<IssuedCookies> {
    if (!ticket) throw new Problem('session-ended');
    const key = `mfa:ticket:${sha256hex(ticket)}`;
    const raw = await this.redis.getdel(key);
    if (!raw) throw new Problem('session-ended'); // expired or used: sign in again
    const t = JSON.parse(raw) as Ticket;
    const now = this.clock.now();

    const r = await this.limiter.hit(`rl:otp-verify:user:${t.userId}`, 20, 3600); // CP-05: 20 per account per hour
    if (!r.allowed) throw new Problem('rate-limited', { retryAfter: r.retryAfterSeconds });

    // an e-mail code is checked against the HMAC kept in the ticket; an authenticator or recovery code as before
    const accepted = t.method === 'email' ? (t.codeHash && otpMatches(this.pepper, code.trim(), Buffer.from(t.codeHash, 'hex')) ? 'email_code' : null) : await this.secondFactor.check(t.userId, code, now);
    if (!accepted) {
      await this.db.transaction((m) =>
        this.audit.record(m, { actorType: 'user', actorId: t.userId, action: 'identity.mfa.failed', objectType: 'user', objectId: t.userId, sourceIp: ctx.ip, correlationId: ctx.correlationId }),
      );
      const remainingMs = t.until - now.getTime();
      if (t.attempts + 1 < MFA_ATTEMPTS && remainingMs > 0) {
        await this.redis.set(key, JSON.stringify({ ...t, attempts: t.attempts + 1 }), 'PX', remainingMs);
      }
      securityEvents.signinFailed.inc({ kind: 'user_mfa' });
      throw new Problem('mfa-failed');
    }
    const [live] = await this.db.query(`SELECT 1 FROM identity.users WHERE id = $1 AND account_status <> 'closed'`, [t.userId]);
    if (!live) throw new Problem('session-ended');
    return this.startSession(t.userId, deviceKey, ctx, accepted, remember);
  }

  private startSession(userId: string, deviceKey: string | undefined, ctx: RequestContext, method: string, remember: boolean): Promise<IssuedCookies> {
    return this.db.transaction(async (m) => {
      const { sessionId, cookies } = await this.sessions.create(m, userId, deviceKey, ctx);
      await this.audit.record(m, {
        actorType: 'user', actorId: userId, action: 'identity.signin.succeeded', objectType: 'session', objectId: sessionId,
        reason: method, sourceIp: ctx.ip, correlationId: ctx.correlationId,
      });
      // 'remember this device': only after a passed second factor (never after the password alone), for 30 days, on the device of this session
      if (remember && method !== 'password') {
        const until = new Date(this.clock.now().getTime() + TRUSTED_DEVICE_DAYS * 86_400_000);
        await m.query(`UPDATE identity.known_devices SET trusted_until = $2 WHERE id = (SELECT device_id FROM identity.sessions WHERE id = $1)`, [sessionId, until]);
        await this.audit.record(m, { actorType: 'user', actorId: userId, action: 'identity.device.trusted', objectType: 'session', objectId: sessionId, sourceIp: ctx.ip, correlationId: ctx.correlationId });
      }
      return cookies;
    });
  }

  private async failed(failKey: string, user: UserRow | undefined, ctx: RequestContext): Promise<void> {
    securityEvents.signinFailed.inc({ kind: 'user' }); // SEC-LOG-05
    if ((await this.throttle.failed(failKey)) && user?.phone_e164) {
      await this.notify.sendSms(user.phone_e164, 'signin_throttled', {});
      if (user.email) await this.notify.sendEmail(user.email, 'signin_throttled', {});
    }
    await this.db.transaction((m) =>
      this.audit.record(m, {
        actorType: user ? 'user' : 'system', actorId: user?.id ?? null, action: 'identity.signin.failed',
        objectType: user ? 'user' : null, objectId: user?.id ?? null, sourceIp: ctx.ip, correlationId: ctx.correlationId,
      }),
    );
  }
}
