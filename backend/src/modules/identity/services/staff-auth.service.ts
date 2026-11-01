import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'crypto';
import type Redis from 'ioredis';
import { authenticator } from 'otplib';
import { DataSource } from 'typeorm';
import { CLOCK, Clock } from '../../../kernel/clock';
import { TbConfig } from '../../../kernel/config/config';
import { TB_CONFIG } from '../../../kernel/config/config.provider';
import { Problem } from '../../../kernel/http/problems';
import { REDIS } from '../../../kernel/redis.provider';
import { encryptField } from '../crypto/field-crypto';
import { PasswordHasher } from '../crypto/password';
import { checkPassword } from '../crypto/password-policy';
import type { IssuedCookies } from '../http/session-cookies';
import { AuditService } from './audit.service';
import { SecondFactorService } from './second-factor.service';
import { RequestContext, SessionService } from './session.service';
import { SignInThrottle } from './signin-throttle.service';

// Staff sign-in (Unit 1 sections 6.2 and 6.8; SEC-AUTH-07, SEC-SES-06, FR-OPS-04). A staff session exists only
// after a TOTP code: SMS is never a staff factor and staff have no recovery codes. The password step answers
// with a ticket cookie: an MFA ticket for an active account, or an enrolment ticket for an account in
// pending_mfa, which may only set a new password and enrol TOTP, after which it becomes active.
// Failures are throttled per e-mail exactly as user sign-ins (SEC-AUTH-04), and audited.
export const STAFF_MFA_TICKET_SECONDS = 300; // DV-1
export const STAFF_ENROL_TICKET_SECONDS = 15 * 60; // Decisions log (U1-07): time to install an authenticator
const MFA_ATTEMPTS = 5; // CP-05 per challenge
const sha256hex = (s: string) => createHash('sha256').update(s).digest('hex');
const mfaKey = (t: string) => `staff:mfa:${sha256hex(t)}`;
const enrolKey = (t: string) => `staff:enrol:${sha256hex(t)}`;

export type StaffSignInResult = { kind: 'mfa'; ticket: string } | { kind: 'enrol'; ticket: string };

export interface StaffMe {
  id: string;
  email: string;
  displayName: string;
  role: string;
}

@Injectable()
export class StaffAuthService {
  constructor(
    private readonly db: DataSource,
    private readonly sessions: SessionService,
    private readonly passwords: PasswordHasher,
    private readonly secondFactor: SecondFactorService,
    private readonly throttle: SignInThrottle,
    private readonly audit: AuditService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(TB_CONFIG) private readonly config: TbConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async signIn(emailInput: string, password: string, ctx: RequestContext): Promise<StaffSignInResult> {
    const email = emailInput.trim().toLowerCase();
    const login = `staff:${email}`;
    await this.throttle.check(login);
    const [staff] = await this.db.query(
      `SELECT id, status, password_hash FROM identity.staff_accounts WHERE email = $1 AND status <> 'disabled'`,
      [email],
    );
    const ok = await this.passwords.verifyOrDummy(staff?.password_hash, password);
    if (!ok || !staff) {
      await this.throttle.failed(login);
      await this.db.transaction((m) =>
        this.audit.record(m, {
          actorType: staff ? 'staff' : 'system', actorId: staff?.id ?? null, action: 'staff.signin.failed',
          objectType: staff ? 'staff' : null, objectId: staff?.id ?? null, sourceIp: ctx.ip, correlationId: ctx.correlationId,
        }),
      );
      throw new Problem('signin-failed');
    }
    await this.throttle.clear(login);
    const ticket = randomBytes(32).toString('base64url');
    if (staff.status === 'pending_mfa') {
      await this.redis.set(enrolKey(ticket), JSON.stringify({ staffId: staff.id }), 'EX', STAFF_ENROL_TICKET_SECONDS);
      return { kind: 'enrol', ticket };
    }
    const until = this.clock.now().getTime() + STAFF_MFA_TICKET_SECONDS * 1000;
    await this.redis.set(mfaKey(ticket), JSON.stringify({ staffId: staff.id, attempts: 0, until }), 'EX', STAFF_MFA_TICKET_SECONDS);
    return { kind: 'mfa', ticket };
  }

  /** SEC-AUTH-07: the TOTP code turns the MFA ticket into a staff session. */
  async verifyMfa(ticket: string | undefined, code: string, ctx: RequestContext): Promise<IssuedCookies> {
    if (!ticket) throw new Problem('session-ended');
    const raw = await this.redis.getdel(mfaKey(ticket));
    if (!raw) throw new Problem('session-ended');
    const t = JSON.parse(raw) as { staffId: string; attempts: number; until: number };
    const now = this.clock.now();
    if (!(await this.secondFactor.checkStaff(t.staffId, code, now))) {
      await this.db.transaction((m) =>
        this.audit.record(m, { actorType: 'staff', actorId: t.staffId, action: 'staff.mfa.failed', objectType: 'staff', objectId: t.staffId, sourceIp: ctx.ip, correlationId: ctx.correlationId }),
      );
      const remainingMs = t.until - now.getTime();
      if (t.attempts + 1 < MFA_ATTEMPTS && remainingMs > 0) {
        await this.redis.set(mfaKey(ticket), JSON.stringify({ ...t, attempts: t.attempts + 1 }), 'PX', remainingMs);
      }
      throw new Problem('mfa-failed');
    }
    return this.startSession(t.staffId, 'totp', ctx);
  }

  /** First enrolment, or after an MFA reset: a new password, and a new unconfirmed TOTP secret to scan. */
  async startEnrolment(ticket: string | undefined, newPassword: string, ctx: RequestContext): Promise<{ otpauthUri: string; secret: string }> {
    const staffId = await this.enrolling(ticket);
    const [s] = await this.db.query(`SELECT email, display_name, password_hash FROM identity.staff_accounts WHERE id = $1`, [staffId]);
    const refusal = checkPassword(newPassword, { mfa: true, context: { displayName: s.display_name, email: s.email } });
    if (refusal) throw new Problem('password-rejected', { errors: [{ field: 'newPassword', reason: refusal }] });
    if (await this.passwords.verifyOrDummy(s.password_hash, newPassword)) {
      // The first password was generated and seen by the administrator who created the account.
      throw new Problem('password-rejected', { errors: [{ field: 'newPassword', reason: 'unchanged' }] });
    }
    const secret = authenticator.generateSecret(20); // 160 bits (Unit 1 section 6.5)
    const factorId = randomUUID();
    const now = this.clock.now();
    await this.db.transaction(async (m) => {
      await m.query(`UPDATE identity.staff_accounts SET password_hash = $2 WHERE id = $1`, [staffId, await this.passwords.hash(newPassword)]);
      await m.query(`UPDATE identity.totp_factors SET removed_at = $2 WHERE staff_id = $1 AND removed_at IS NULL`, [staffId, now]);
      await m.query(
        `INSERT INTO identity.totp_factors (id, principal_type, staff_id, secret_enc, key_version, created_at) VALUES ($1, 'staff', $2, $3, $4, $5)`,
        [factorId, staffId, encryptField(this.config.keys.field, Buffer.from(secret), { table: 'totp_factors', column: 'secret_enc', rowId: factorId }),
         this.config.keys.field.current, now],
      );
      await this.audit.record(m, {
        actorType: 'staff', actorId: staffId, action: 'staff.password.changed', objectType: 'staff', objectId: staffId,
        reason: 'enrolment', sourceIp: ctx.ip, correlationId: ctx.correlationId,
      });
    });
    return { otpauthUri: authenticator.keyuri(s.email, 'TrustBazaar Staff', secret), secret };
  }

  /** The first code from the new authenticator confirms it; the account becomes active and is signed in. */
  async confirmEnrolment(ticket: string | undefined, code: string, ctx: RequestContext): Promise<IssuedCookies> {
    const staffId = await this.enrolling(ticket);
    const now = this.clock.now();
    if (!(await this.secondFactor.confirmStaffEnrolment(staffId, code, now))) throw new Problem('mfa-failed');
    await this.redis.del(enrolKey(ticket!));
    return this.startSession(staffId, 'enrolment', ctx, true);
  }

  async me(staffId: string): Promise<StaffMe> {
    const [s] = await this.db.query(`SELECT id, email, display_name, role FROM identity.staff_accounts WHERE id = $1`, [staffId]);
    return { id: s.id, email: s.email, displayName: s.display_name, role: s.role };
  }

  private async enrolling(ticket: string | undefined): Promise<string> {
    const raw = ticket ? await this.redis.get(enrolKey(ticket)) : null;
    if (!raw) throw new Problem('session-ended');
    const { staffId } = JSON.parse(raw) as { staffId: string };
    const [s] = await this.db.query(`SELECT status FROM identity.staff_accounts WHERE id = $1`, [staffId]);
    if (s?.status !== 'pending_mfa') throw new Problem('session-ended');
    return staffId;
  }

  private startSession(staffId: string, method: string, ctx: RequestContext, activate = false): Promise<IssuedCookies> {
    return this.db.transaction(async (m) => {
      if (activate) {
        await m.query(`UPDATE identity.staff_accounts SET status = 'active' WHERE id = $1 AND status = 'pending_mfa'`, [staffId]);
        await this.audit.record(m, {
          actorType: 'staff', actorId: staffId, action: 'staff.mfa.enrolled', objectType: 'staff', objectId: staffId,
          before: { status: 'pending_mfa' }, after: { status: 'active' }, sourceIp: ctx.ip, correlationId: ctx.correlationId,
        });
      }
      const [live] = await m.query(`SELECT 1 FROM identity.staff_accounts WHERE id = $1 AND status = 'active'`, [staffId]);
      if (!live) throw new Problem('session-ended');
      const { sessionId, cookies } = await this.sessions.createStaff(m, staffId, ctx);
      await this.audit.record(m, {
        actorType: 'staff', actorId: staffId, action: 'staff.signin.succeeded', objectType: 'session', objectId: sessionId,
        reason: method, sourceIp: ctx.ip, correlationId: ctx.correlationId,
      });
      return cookies;
    });
  }
}
