import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import type Redis from 'ioredis';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { DataSource } from 'typeorm';
import { CLOCK, Clock } from '../../../kernel/clock';
import { TbConfig } from '../../../kernel/config/config';
import { TB_CONFIG } from '../../../kernel/config/config.provider';
import { CONFIG_PORT, ConfigPort } from '../../../kernel/config-port';
import { Problem } from '../../../kernel/http/problems';
import { REDIS } from '../../../kernel/redis.provider';
import { NOTIFICATIONS, NotificationPort } from '../adapters/notifications';
import { decryptField } from '../crypto/field-crypto';
import { PasswordHasher } from '../crypto/password';
import { checkTotp, hashRecoveryCode } from '../crypto/totp';
import type { IssuedCookies } from '../http/session-cookies';
import { RateLimiter } from '../security/rate-limiter.service';
import { AuditService } from './audit.service';
import { RequestContext, SessionService } from './session.service';

// Sign-in (Unit 1 section 6.2; FR-ACC-05, FR-ACC-06, SEC-AUTH-03 to SEC-AUTH-05, SEC-LOG-01).
// 1. The number or e-mail and the password. Unknown, closed and wrong all get the same 401 after the same
//    Argon2id work. After CP-04 failures for one login, the next attempt must wait 1 s, doubling to 15 min
//    (DV-10); the first wait notifies the owner. A success clears the count (as will a password reset, U1-05).
// 2. With MFA on: a 5-minute ticket (DV-1), only its hash kept in Redis, then the TOTP or a recovery code.
//    Each code works once; five wrong codes end the ticket.
export const MFA_TICKET_SECONDS = 300; // DV-1
const MFA_ATTEMPTS = 5; // CP-05: attempts per challenge
const MAX_DELAY_SECONDS = 15 * 60; // DV-10
const sha256hex = (s: string) => createHash('sha256').update(s).digest('hex');
const USER_COLUMNS = `SELECT id, password_hash, mfa_enabled, phone_e164, email FROM identity.users`;
const BY_PHONE = `${USER_COLUMNS} WHERE phone_e164 = $1 AND account_status <> 'closed' LIMIT 1`;
const BY_EMAIL = `${USER_COLUMNS} WHERE email = $1 AND account_status <> 'closed' LIMIT 1`;

interface CP04 {
  failuresPerAccount: number;
  windowMinutes: number;
}

interface UserRow {
  id: string;
  password_hash: string | null;
  mfa_enabled: boolean;
  phone_e164: string | null;
  email: string | null;
}

export type SignInResult = { kind: 'session'; cookies: IssuedCookies } | { kind: 'mfa'; ticket: string };

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
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(NOTIFICATIONS) private readonly notify: NotificationPort,
    @Inject(TB_CONFIG) private readonly config: TbConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(CONFIG_PORT) private readonly params: ConfigPort,
  ) {}

  async signIn(login: string, password: string, deviceKey: string | undefined, ctx: RequestContext): Promise<SignInResult> {
    const account = normaliseLogin(login);
    // Keyed by the login as typed (normalised), so unknown accounts are throttled exactly like real ones.
    const failKey = `signin:fail:${sha256hex(account ? Object.values(account)[0] : login.trim().toLowerCase())}`;
    const now = this.clock.now();
    const until = Number(await this.redis.hget(failKey, 'until').catch(() => null));
    if (until > now.getTime()) throw new Problem('rate-limited', { retryAfter: Math.ceil((until - now.getTime()) / 1000) });

    let user: UserRow | undefined;
    if (account) {
      [user] = await this.db.query('phone' in account ? BY_PHONE : BY_EMAIL, ['phone' in account ? account.phone : account.email]);
    }
    const ok = await this.passwords.verifyOrDummy(user?.password_hash, password);

    if (!ok || !user) {
      await this.failed(failKey, user, ctx);
      throw new Problem('signin-failed');
    }
    await this.redis.del(failKey).catch(() => undefined);
    if (this.passwords.needsRehash(user.password_hash!)) {
      await this.db.query(`UPDATE identity.users SET password_hash = $2 WHERE id = $1`, [user.id, await this.passwords.hash(password)]);
    }

    if (user.mfa_enabled) {
      const ticket = randomBytes(32).toString('base64url');
      await this.redis.set(`mfa:ticket:${sha256hex(ticket)}`, JSON.stringify({ userId: user.id, attempts: 0, until: now.getTime() + MFA_TICKET_SECONDS * 1000 }), 'EX', MFA_TICKET_SECONDS);
      return { kind: 'mfa', ticket };
    }
    return { kind: 'session', cookies: await this.startSession(user.id, deviceKey, ctx, 'password') };
  }

  async verifyMfa(ticket: string | undefined, code: string, deviceKey: string | undefined, ctx: RequestContext): Promise<IssuedCookies> {
    if (!ticket) throw new Problem('session-ended');
    const key = `mfa:ticket:${sha256hex(ticket)}`;
    const raw = await this.redis.getdel(key);
    if (!raw) throw new Problem('session-ended'); // expired or used: sign in again
    const t = JSON.parse(raw) as { userId: string; attempts: number; until: number };
    const now = this.clock.now();

    const r = await this.limiter.hit(`rl:otp-verify:user:${t.userId}`, 20, 3600); // CP-05: 20 per account per hour
    if (!r.allowed) throw new Problem('rate-limited', { retryAfter: r.retryAfterSeconds });

    const accepted = await this.checkSecondFactor(t.userId, code, now);
    if (!accepted) {
      await this.db.transaction((m) =>
        this.audit.record(m, { actorType: 'user', actorId: t.userId, action: 'identity.mfa.failed', objectType: 'user', objectId: t.userId, sourceIp: ctx.ip, correlationId: ctx.correlationId }),
      );
      const remainingMs = t.until - now.getTime();
      if (t.attempts + 1 < MFA_ATTEMPTS && remainingMs > 0) {
        await this.redis.set(key, JSON.stringify({ ...t, attempts: t.attempts + 1 }), 'PX', remainingMs);
      }
      throw new Problem('mfa-failed');
    }
    const [live] = await this.db.query(`SELECT 1 FROM identity.users WHERE id = $1 AND account_status <> 'closed'`, [t.userId]);
    if (!live) throw new Problem('session-ended');
    return this.startSession(t.userId, deviceKey, ctx, accepted);
  }

  /** 'totp' or 'recovery' if the code is accepted (and now used up), else null. */
  private async checkSecondFactor(userId: string, code: string, now: Date): Promise<'totp' | 'recovery' | null> {
    const [f] = await this.db.query(
      `SELECT id, secret_enc FROM identity.totp_factors
       WHERE user_id = $1 AND removed_at IS NULL AND confirmed_at IS NOT NULL`,
      [userId],
    );
    if (!f) return null;
    if (/^\d{6}$/.test(code)) {
      const secret = decryptField(this.config.keys.field, f.secret_enc, { table: 'totp_factors', column: 'secret_enc', rowId: f.id }).toString('utf8');
      const step = checkTotp(secret, code, now);
      if (step === null) return null;
      // Only a step later than the last one used is accepted, so a code cannot be replayed.
      const used = await this.db.query(
        `UPDATE identity.totp_factors SET last_used_step = $2 WHERE id = $1 AND (last_used_step IS NULL OR last_used_step < $2) RETURNING id`,
        [f.id, step],
      );
      return (Array.isArray(used[0]) ? used[0] : used).length > 0 ? 'totp' : null;
    }
    const used = await this.db.query(
      `UPDATE identity.recovery_codes SET used_at = $3 WHERE totp_factor_id = $1 AND code_hash = $2 AND used_at IS NULL RETURNING id`,
      [f.id, hashRecoveryCode(code), now],
    );
    return (Array.isArray(used[0]) ? used[0] : used).length > 0 ? 'recovery' : null;
  }

  private startSession(userId: string, deviceKey: string | undefined, ctx: RequestContext, method: string): Promise<IssuedCookies> {
    return this.db.transaction(async (m) => {
      const { sessionId, cookies } = await this.sessions.create(m, userId, deviceKey, ctx);
      await this.audit.record(m, {
        actorType: 'user', actorId: userId, action: 'identity.signin.succeeded', objectType: 'session', objectId: sessionId,
        reason: method, sourceIp: ctx.ip, correlationId: ctx.correlationId,
      });
      return cookies;
    });
  }

  private async failed(failKey: string, user: UserRow | undefined, ctx: RequestContext): Promise<void> {
    const cp04 = (await this.params.current()).get<CP04>('CP-04');
    const now = this.clock.now().getTime();
    try {
      const count = await this.redis.hincrby(failKey, 'count', 1);
      if (count === 1) await this.redis.expire(failKey, cp04.windowMinutes * 60);
      if (count >= cp04.failuresPerAccount) {
        const delay = Math.min(2 ** (count - cp04.failuresPerAccount), MAX_DELAY_SECONDS);
        await this.redis.hset(failKey, 'until', String(now + delay * 1000));
        await this.redis.expire(failKey, Math.max(cp04.windowMinutes * 60, delay));
        if (count === cp04.failuresPerAccount && user?.phone_e164) {
          await this.notify.sendSms(user.phone_e164, 'signin_throttled', {});
          if (user.email) await this.notify.sendEmail(user.email, 'signin_throttled', {});
        }
      }
    } catch {
      // Redis unavailable: the per-address limit and the audit log still apply (NFR-REL-01).
    }
    await this.db.transaction((m) =>
      this.audit.record(m, {
        actorType: user ? 'user' : 'system', actorId: user?.id ?? null, action: 'identity.signin.failed',
        objectType: user ? 'user' : null, objectId: user?.id ?? null, sourceIp: ctx.ip, correlationId: ctx.correlationId,
      }),
    );
  }
}
