import { randomBytes, randomInt, randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import Redis from 'ioredis';
import { loadConfig } from '../../src/kernel/config/config';
import { signAccessToken } from '../../src/modules/identity/security/access-token';
import { STAFF_COOKIES, USER_COOKIES } from '../../src/modules/identity/security/cookies';
import { csrfToken } from '../../src/modules/identity/security/csrf';
import { hashGrant, stepUpKey } from '../../src/modules/identity/security/step-up';
import { requireEnv, useTestSecrets } from './env';

// Accounts and sessions for API tests, created as tb_app (the rows stay: tb_app may not delete users,
// so every value that must be unique is random). Tokens and CSRF values are made with the same keys the
// backend under test uses.
export class IdentityFixtures {
  private constructor(
    private readonly db: DataSource,
    private readonly redis: Redis,
  ) {}

  static async open(): Promise<IdentityFixtures> {
    useTestSecrets();
    const db = await new DataSource({ type: 'postgres', url: requireEnv('DATABASE_URL') }).initialize();
    return new IdentityFixtures(db, new Redis(requireEnv('REDIS_URL')));
  }

  async close(): Promise<void> {
    await this.db.destroy();
    this.redis.disconnect();
  }

  private get config() {
    return loadConfig(process.env);
  }

  async user(o: { kyc?: string; emailVerified?: boolean; status?: 'active' | 'suspended' | 'closed' } = {}): Promise<string> {
    const phone = `+8801${randomInt(3, 10)}${String(randomInt(0, 1e8)).padStart(8, '0')}`;
    const closed = o.status === 'closed';
    const [{ id }] = await this.db.query(
      `INSERT INTO identity.users (display_name, phone_e164, phone_verified_at, email, email_verified_at, password_hash,
                                   password_single_factor_ok, adult_confirmed_at, kyc_status, account_status, closed_at)
       VALUES ('Test user', $1, now(), $2, $3, '$argon2id$v=19$test', true, now(), $4, $5, $6) RETURNING id`,
      [phone, `t-${randomUUID()}@tb.test`, o.emailVerified === false ? null : new Date(), o.kyc ?? 'verified',
       o.status ?? 'active', closed ? new Date() : null],
    );
    return id;
  }

  async staff(role: 'operator' | 'administrator', status: 'active' | 'pending_mfa' | 'disabled' = 'active'): Promise<string> {
    const id = randomUUID();
    await this.db.query(
      `INSERT INTO identity.staff_accounts (id, email, display_name, role, status, password_hash, created_by, disabled_at)
       VALUES ($1, $2, 'Test staff', $3, $4, '$argon2id$v=19$test', $1, $5)`,
      [id, `s-${id}@tb.test`, role, status, status === 'disabled' ? new Date() : null],
    );
    return id;
  }

  /** A session; idleSeconds/absoluteSeconds may be negative for an expired one. */
  async session(
    principal: { userId: string } | { staffId: string },
    o: { idleSeconds?: number; absoluteSeconds?: number; ended?: boolean } = {},
  ): Promise<string> {
    const isUser = 'userId' in principal;
    const idle = o.idleSeconds ?? 1800;
    const absolute = Math.max(idle, o.absoluteSeconds ?? 86400);
    const [{ id }] = await this.db.query(
      `INSERT INTO identity.sessions (principal_type, user_id, staff_id, idle_expires_at, absolute_expires_at,
                                      ended_at, end_reason, last_seen_at)
       VALUES ($1, $2, $3, now() + make_interval(secs => $4), now() + make_interval(secs => $5), $6, $7, now() - interval '1 hour')
       RETURNING id`,
      [isUser ? 'user' : 'staff', isUser ? principal.userId : null, isUser ? null : principal.staffId, idle, absolute,
       o.ended ? new Date() : null, o.ended ? 'logout' : null],
    );
    return id;
  }

  async lastSeen(sessionId: string): Promise<Date> {
    const [{ last_seen_at }] = await this.db.query('SELECT last_seen_at FROM identity.sessions WHERE id = $1', [sessionId]);
    return last_seen_at;
  }

  /** Request headers of a browser holding this session: cookies, Origin and the CSRF header. */
  headers(sessionId: string, sub: string, pt: 'user' | 'staff', o: { ttlSeconds?: number; csrf?: string } = {}): Record<string, string> {
    const cfg = this.config;
    const names = pt === 'staff' ? STAFF_COOKIES : USER_COOKIES;
    const at = signAccessToken(cfg.keys.jwt, { sub, sid: sessionId, pt }, o.ttlSeconds ?? 900, new Date());
    const csrf = csrfToken(cfg.secrets.csrfKey, sessionId);
    return {
      cookie: `${names.access}=${at}; ${names.csrf}=${csrf}`,
      origin: cfg.publicOrigin,
      'x-csrf-token': o.csrf ?? csrf,
    };
  }

  /** Stores a step-up grant as StepUpService will (U1-05) and returns the grant for X-Step-Up. */
  async stepUpGrant(sessionId: string, action: string): Promise<string> {
    const grant = randomBytes(32).toString('base64url');
    await this.redis.set(stepUpKey(sessionId, action), hashGrant(grant), 'EX', 300);
    return grant;
  }
}
