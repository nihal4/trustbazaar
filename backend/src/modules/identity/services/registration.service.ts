import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type Redis from 'ioredis';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { CLOCK, Clock } from '../../../kernel/clock';
import { TbConfig } from '../../../kernel/config/config';
import { TB_CONFIG } from '../../../kernel/config/config.provider';
import { Problem } from '../../../kernel/http/problems';
import { REDIS } from '../../../kernel/redis.provider';
import { NOTIFICATIONS, NotificationPort } from '../adapters/notifications';
import { generateOtp, hashOtp, otpMatches } from '../crypto/otp';
import { PasswordHasher } from '../crypto/password';
import { checkPassword } from '../crypto/password-policy';
import { AuditService } from './audit.service';
import { OtpService, RESEND_GAP_SECONDS } from './otp.service';
import { publish } from './outbox';
import { bangladeshiMobile } from './phone';
import type { RequestContext } from './session.service';

// Registration (Unit 1 section 6.1; FR-ACC-01 to FR-ACC-04, SEC-AUTH-01, 02, 06, 09; FR-PRV-01). Decisions log, U10-25.
// 1. register: the name, the e-mail address and the password are checked and kept, with the hash of a 6-digit code, in Redis for
//    the length of the sign-up (nothing exists in users yet). A new address gets the code by e-mail. An address that already has an
//    open account gets no code; its owner is told instead. The answer and the work done (one Argon2id hash, one send count) are the same.
// 2. verify: the right code marks the address as confirmed. It creates nothing and signs nobody in. Five wrong codes end the sign-up.
// 3. complete: the confirmed sign-up, the mobile number, the age confirmation and the current terms and privacy notice create the
//    account and its consents in one transaction (the e-mail address counts as verified: the code proved it), and the person is
//    told by e-mail that the account exists. The person is not signed in: the sign-in page follows.
// The mobile number is not confirmed by SMS at sign-up (phone_verified_at stays empty until a later phone change is confirmed).
const PENDING_PREFIX = 'reg:pending:';
const FINISH_MINUTES = 30; // after the code is right, the number and the terms may take this long

export interface RegistrationInput {
  email: string;
  displayName: string;
  password: string;
}

export interface CompleteInput {
  registrationId: string;
  phone: string;
  /** Sent again only to check the password rules that involve the number; compared with the stored hash. */
  password: string;
  termsVersion: string;
  privacyVersion: string;
  adultConfirmed: boolean;
}

export interface RegistrationStarted {
  registrationId: string;
  resendAt: string;
}

interface Pending {
  email: string;
  displayName: string;
  passwordHash: string;
  /** hex HMAC of the current code; absent for an address that already has an account (no code was sent) */
  codeHash: string | null;
  attempts: number;
  sends: number;
  verified: boolean;
  /** end of the code's life, then of the whole sign-up (epoch milliseconds) */
  until: number;
  ip: string | null;
}

// TypeORM's PostgreSQL driver answers UPDATE ... RETURNING with [rows, count], INSERT/SELECT with rows.
const isUniqueViolation = (e: unknown) => e instanceof QueryFailedError && (e as unknown as { code?: string }).code === '23505';

@Injectable()
export class RegistrationService {
  constructor(
    private readonly db: DataSource,
    private readonly passwords: PasswordHasher,
    private readonly audit: AuditService,
    private readonly otp: OtpService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(NOTIFICATIONS) private readonly notify: NotificationPort,
    @Inject(TB_CONFIG) private readonly config: TbConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private get pepper(): string {
    return this.config.secrets.otpPepper.reveal();
  }

  /** Starts registration: checks the name, the e-mail address and the password and sends the code; the account exists only after the last step (FR-ACC-01). */
  async register(input: RegistrationInput, ctx: RequestContext): Promise<RegistrationStarted> {
    const email = input.email.trim().toLowerCase();
    const displayName = input.displayName.trim().replace(/\s+/g, ' ');
    const refusal = checkPassword(input.password, { mfa: false, context: { displayName, email } });
    if (refusal) throw new Problem('password-rejected', { errors: [{ field: 'password', reason: refusal }] });

    await this.otp.countSend(`email:${email}`);
    const cp05 = await this.otp.cp05();
    const passwordHash = await this.passwords.hash(input.password);
    const now = this.clock.now();
    const existing = await this.liveAccountWithEmail(email);
    const code = generateOtp(); // for an existing address it is never sent, so it can never be entered
    const registrationId = randomUUID();
    const until = now.getTime() + cp05.otpValidityMinutes * 60_000;
    const pending: Pending = {
      email,
      displayName,
      passwordHash,
      codeHash: existing ? null : hashOtp(this.pepper, code).toString('hex'),
      attempts: 0,
      sends: 1,
      verified: false,
      until,
      ip: ctx.ip ?? null,
    };
    await this.redis.set(PENDING_PREFIX + registrationId, JSON.stringify(pending), 'PX', until - now.getTime());

    if (existing) await this.notify.sendEmail(email, 'register_attempt_existing_email', {});
    else await this.notify.sendEmail(email, 'otp_register_email', { code, minutes: String(cp05.otpValidityMinutes) });
    return { registrationId, resendAt: new Date(now.getTime() + RESEND_GAP_SECONDS * 1000).toISOString() };
  }

  /** SEC-AUTH-09: a new code for the same sign-up; the previous one stops working. */
  async resend(registrationId: string): Promise<RegistrationStarted> {
    const p = await this.load(registrationId);
    if (!p || p.verified) throw new Problem('not-found');
    await this.otp.countSend(`email:${p.email}`);
    const cp05 = await this.otp.cp05();
    const now = this.clock.now();
    const code = generateOtp();
    const until = now.getTime() + cp05.otpValidityMinutes * 60_000;
    // the owner of an existing address was told once, at registration; a resend sends nothing to them
    const next: Pending = { ...p, codeHash: p.codeHash ? hashOtp(this.pepper, code).toString('hex') : null, attempts: 0, sends: p.sends + 1, until };
    await this.redis.set(PENDING_PREFIX + registrationId, JSON.stringify(next), 'PX', until - now.getTime());
    if (p.codeHash) await this.notify.sendEmail(p.email, 'otp_register_email', { code, minutes: String(cp05.otpValidityMinutes) });
    return { registrationId, resendAt: new Date(now.getTime() + RESEND_GAP_SECONDS * 1000).toISOString() };
  }

  /** FR-ACC-02: the right code confirms the e-mail address; no account is made and nobody is signed in. */
  async verify(registrationId: string, code: string): Promise<void> {
    const key = PENDING_PREFIX + registrationId;
    const raw = await this.redis.getdel(key); // only one of several simultaneous entries sees the sign-up
    if (!raw) throw new Problem('otp-expired');
    const p = JSON.parse(raw) as Pending;
    const now = this.clock.now().getTime();
    await this.otp.countEntry(`email:${p.email}`).catch(async (e) => {
      await this.redis.set(key, raw, 'PX', Math.max(1, p.until - now));
      throw e;
    });
    const cp05 = await this.otp.cp05();
    const remaining = p.until - now;
    if (p.verified || remaining <= 0 || p.attempts >= cp05.attemptsPerOtp) throw new Problem('otp-expired');
    const right = p.codeHash !== null && otpMatches(this.pepper, code, Buffer.from(p.codeHash, 'hex'));
    if (!right) {
      const next = { ...p, attempts: p.attempts + 1 };
      if (next.attempts < cp05.attemptsPerOtp) await this.redis.set(key, JSON.stringify(next), 'PX', remaining);
      throw new Problem(next.attempts < cp05.attemptsPerOtp ? 'otp-failed' : 'otp-expired');
    }
    const until = now + FINISH_MINUTES * 60_000;
    await this.redis.set(key, JSON.stringify({ ...p, codeHash: null, verified: true, until } satisfies Pending), 'PX', until - now);
  }

  /** FR-ACC-01, FR-ACC-04: the number, the age confirmation and the current terms create the account. Not signed in. */
  async complete(input: CompleteInput, ctx: RequestContext): Promise<void> {
    const key = PENDING_PREFIX + input.registrationId;
    const p = await this.load(input.registrationId);
    if (!p || !p.verified) throw new Problem('otp-expired');
    const phone = bangladeshiMobile(input.phone);
    if (!phone) throw new Problem('validation-failed', { errors: [{ field: 'phone', reason: 'not-bangladeshi-mobile' }] });
    const legal = this.config.legal;
    const outdated = [
      ...(input.termsVersion !== legal.termsVersion ? [{ field: 'termsVersion', reason: 'not-current' }] : []),
      ...(input.privacyVersion !== legal.privacyVersion ? [{ field: 'privacyVersion', reason: 'not-current' }] : []),
      ...(input.adultConfirmed !== true ? [{ field: 'adultConfirmed', reason: 'required' }] : []),
    ];
    if (outdated.length > 0) throw new Problem('validation-failed', { errors: outdated });
    if (!(await this.passwords.verifyOrDummy(p.passwordHash, input.password))) {
      throw new Problem('validation-failed', { errors: [{ field: 'password', reason: 'mismatch' }] });
    }
    const refusal = checkPassword(input.password, { mfa: false, context: { displayName: p.displayName, phoneE164: phone, email: p.email } });
    if (refusal) throw new Problem('password-rejected', { errors: [{ field: 'password', reason: refusal }] });

    // from here the sign-up is used up, whatever happens: one account at most per confirmed address
    if (!(await this.redis.getdel(key))) throw new Problem('otp-expired');
    const now = this.clock.now();
    let userId: string | null = null;
    try {
      userId = await this.db.transaction(async (m) => {
        const [taken] = await m.query(`SELECT 1 FROM identity.users WHERE (phone_e164 = $1 OR email = $2) AND account_status <> 'closed' LIMIT 1`, [
          phone,
          p.email,
        ]);
        if (taken) return null;
        return this.createAccount(m, p, phone, input, ctx, now);
      });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e; // another sign-up took the number or e-mail between the check and the insert
    }
    if (!userId) {
      await this.tellOwners(phone, p.email);
      throw new Problem('registration-refused');
    }
    await this.notify.sendEmail(p.email, 'account_created', { link: `${this.config.publicOrigin}/signin`, name: p.displayName });
  }

  private async createAccount(m: EntityManager, p: Pending, phone: string, input: CompleteInput, ctx: RequestContext, now: Date): Promise<string> {
    const [{ id: userId }] = await m.query(
      `INSERT INTO identity.users (display_name, phone_e164, email, email_verified_at, password_hash, password_single_factor_ok,
                                   password_changed_at, adult_confirmed_at)
       VALUES ($1, $2, $3, $4, $5, true, $4, $4) RETURNING id`,
      [p.displayName, phone, p.email, now, p.passwordHash],
    );
    await m.query(
      `INSERT INTO identity.consents (user_id, document, version, granted, recorded_at, source_ip)
       VALUES ($1, 'terms', $2, true, $4, $5), ($1, 'privacy', $3, true, $4, $5)`,
      [userId, input.termsVersion, input.privacyVersion, now, ctx.ip ?? p.ip],
    );
    await publish(m, 'identity.user.registered', userId, { userId });
    await this.audit.record(m, {
      actorType: 'user',
      actorId: userId,
      action: 'identity.account.registered',
      objectType: 'user',
      objectId: userId,
      sourceIp: ctx.ip,
      correlationId: ctx.correlationId,
    });
    return userId as string;
  }

  /** SEC-AUTH-06: the owner of the number or e-mail is told that someone tried to register with it. */
  private async tellOwners(phone: string, email: string): Promise<void> {
    const owners = await this.db.query(`SELECT phone_e164, email FROM identity.users WHERE (phone_e164 = $1 OR email = $2) AND account_status <> 'closed'`, [
      phone,
      email,
    ]);
    for (const o of owners) {
      if (String(o.email).toLowerCase() === email.toLowerCase()) await this.notify.sendEmail(o.email, 'register_attempt_existing_email', {});
      else await this.notify.sendSms(o.phone_e164, 'register_attempt_existing_number', {});
    }
  }

  private async load(registrationId: string): Promise<Pending | null> {
    const raw = await this.redis.get(PENDING_PREFIX + registrationId);
    if (!raw) return null;
    const p = JSON.parse(raw) as Pending;
    return p.until > this.clock.now().getTime() ? p : null;
  }

  private async liveAccountWithEmail(email: string): Promise<boolean> {
    const [u] = await this.db.query(`SELECT 1 FROM identity.users WHERE email = $1 AND account_status <> 'closed' LIMIT 1`, [email]);
    return Boolean(u);
  }
}
