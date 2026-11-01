import { randomUUID } from 'crypto';
import { authenticator } from 'otplib';
import { DataSource } from 'typeorm';
import { loadConfig } from '../../src/kernel/config/config';
import { StaffService } from '../../src/modules/identity/services/staff.service';
import { bootstrapAdministrator } from '../../src/staff-bootstrap';
import { startApp, TestApp } from '../support/app';
import { Browser } from '../support/browser';
import { requireEnv } from '../support/env';
import { IdentityFixtures } from '../support/identity';

// U1-07: staff accounts and sign-in, four-eyes approvals, conflicts and the audit log (Unit 1 sections 4.2,
// 5.3, 6.7 and 6.8; I-51), over HTTP against PostgreSQL and Redis, through the real security pipeline.
const problem = async (r: Response) => {
  const b = await r.json();
  return { status: r.status, type: b.type };
};

describe('staff, approvals and the audit log', () => {
  let t: TestApp;
  let fx: IdentityFixtures;
  let origin: string;
  const staffBrowser = () => new Browser(t, origin, '__Host-tb_scsrf');
  const userBrowser = () => new Browser(t, origin);

  beforeAll(async () => {
    t = await startApp();
    fx = await IdentityFixtures.open();
    origin = loadConfig(process.env).publicOrigin;
  });
  afterAll(async () => {
    await fx?.close();
    await t?.close();
  });

  /** A staff member signed in to the console through password and TOTP. */
  async function signedInStaff(role: 'operator' | 'administrator', o: { email?: string; phone?: string } = {}) {
    const s = await fx.staffAccount(role, o);
    const b = staffBrowser();
    const r = await b.post('/staff/auth/signin', { email: s.email, password: s.password });
    expect(await r.json()).toEqual({ mfaRequired: true });
    expect((await b.post('/staff/auth/mfa', { code: authenticator.generate(s.totpSecret!) })).status).toBe(204);
    return { ...s, b };
  }

  describe('sign-in (SEC-AUTH-07, I-51)', () => {
    it('SEC-AUTH-07 a staff session needs the password and a TOTP code, and uses the staff cookies', async () => {
      const s = await fx.staffAccount('operator');
      const b = staffBrowser();
      expect(await (await b.post('/staff/auth/signin', { email: s.email.toUpperCase(), password: s.password })).json()).toEqual({ mfaRequired: true });
      expect(b.cookies.has('__Host-tb_sat')).toBe(false);
      expect((await problem(await b.post('/staff/auth/mfa', { code: '000000' }))).type).toBe('/problems/mfa-failed');
      expect((await b.post('/staff/auth/mfa', { code: authenticator.generate(s.totpSecret!) })).status).toBe(204);
      for (const c of ['__Host-tb_sat', '__Host-tb_scsrf', '__Secure-tb_srt']) expect(b.cookies.has(c)).toBe(true);
      expect(b.cookies.has('__Host-tb_at')).toBe(false);
      expect(b.attributes('__Secure-tb_srt')).toMatchObject({ httponly: true, secure: true, path: '/api/v1/staff/auth/refresh' });
      expect(await (await b.get('/staff/me')).json()).toEqual({ id: s.staffId, email: s.email, displayName: 'Staff member', role: 'operator' });
    });

    it('SEC-AUTH-05 a wrong password, an unknown e-mail and a disabled account get the same answer', async () => {
      const s = await fx.staffAccount('operator');
      const disabledId = await fx.staff('operator', 'disabled');
      const wrong = await problem(await staffBrowser().post('/staff/auth/signin', { email: s.email, password: 'not it at all' }));
      const unknown = await problem(await staffBrowser().post('/staff/auth/signin', { email: `x-${randomUUID()}@tb.test`, password: 'whatever pw' }));
      const [d] = await fx.query<{ email: string }>(`SELECT email FROM identity.staff_accounts WHERE id = $1`, [disabledId]);
      const disabled = await problem(await staffBrowser().post('/staff/auth/signin', { email: d.email, password: 'whatever pw' }));
      expect(wrong).toEqual({ status: 401, type: '/problems/signin-failed' });
      expect(unknown).toEqual(wrong);
      expect(disabled).toEqual(wrong);
    });

    it('SEC-AUTH-07 a pending account sets its own password and enrols TOTP before its first session', async () => {
      const s = await fx.staffAccount('operator', { status: 'pending_mfa' });
      const b = staffBrowser();
      expect(await (await b.post('/staff/auth/signin', { email: s.email, password: s.password })).json()).toEqual({ enrolmentRequired: true });
      expect((await b.get('/staff/me')).status).toBe(401);
      const same = await b.post('/staff/auth/mfa/enrol', { newPassword: s.password });
      expect(same.status).toBe(422);
      const r = await b.post('/staff/auth/mfa/enrol', { newPassword: 'my own console passphrase' });
      const { otpauthUri, secret } = await r.json();
      expect(otpauthUri).toMatch(/^otpauth:\/\/totp\//);
      expect(secret).toMatch(/^[A-Z2-7]{32}$/); // 160 bits, base32
      expect((await b.post('/staff/auth/mfa/enrol/confirm', { code: authenticator.generate(secret) })).status).toBe(204);
      expect((await b.get('/staff/me')).status).toBe(200);
      const [row] = await fx.query(`SELECT status FROM identity.staff_accounts WHERE id = $1`, [s.staffId]);
      expect(row.status).toBe('active');
      expect((await staffBrowser().post('/staff/auth/signin', { email: s.email, password: s.password })).status).toBe(401);
    });

    it('I-51 staff and user sessions are separate: each refuses the other, and staff refresh on their own path', async () => {
      const s = await signedInStaff('operator');
      expect((await s.b.get('/auth/sessions')).status).toBe(401); // a staff session is never a user session (FR-OPS-04)
      const a = await fx.account();
      const u = userBrowser();
      await u.post('/auth/signin', { login: a.phone, password: a.password });
      expect((await u.get('/staff/me')).status).toBe(401);

      const before = s.b.cookies.get('__Secure-tb_srt');
      expect((await s.b.post('/staff/auth/refresh')).status).toBe(204);
      expect(s.b.cookies.get('__Secure-tb_srt')).not.toBe(before);
      // The staff refresh token is refused on the user path, and the user one on the staff path.
      const cross = staffBrowser();
      cross.cookies.set('__Secure-tb_rt', s.b.cookies.get('__Secure-tb_srt')!);
      expect((await cross.post('/auth/refresh')).status).toBe(401);
    });

    it('SEC-SES-06 staff sessions have the CP-03 limits: 15 minutes idle, 8 hours in all', async () => {
      const s = await signedInStaff('operator');
      const [row] = await fx.query<{ idle: number; absolute: number }>(
        `SELECT extract(epoch FROM idle_expires_at - created_at)::int AS idle, extract(epoch FROM absolute_expires_at - created_at)::int AS absolute
         FROM identity.sessions WHERE staff_id = $1 AND ended_at IS NULL`,
        [s.staffId],
      );
      expect(row).toEqual({ idle: 15 * 60, absolute: 8 * 3600 });
    });

    it('SEC-SES-05 staff sign-out ends the session', async () => {
      const s = await signedInStaff('operator');
      const cookie = s.b.cookies.get('__Host-tb_sat')!;
      expect((await s.b.post('/staff/auth/signout')).status).toBe(204);
      const stale = staffBrowser();
      stale.cookies.set('__Host-tb_sat', cookie);
      expect((await stale.get('/staff/me')).status).toBe(401);
    });
  });

  describe('staff accounts (FR-OPS-03, FR-OPS-04)', () => {
    it('FR-OPS-04 only an administrator creates staff; the first password is shown once and the account is pending', async () => {
      const admin = await signedInStaff('administrator');
      const op = await signedInStaff('operator');
      const body = { email: `new-${randomUUID()}@tb.test`, displayName: 'New Operator', role: 'operator' };
      expect((await op.b.post('/admin/staff', body)).status).toBe(403);
      const r = await admin.b.post('/admin/staff', body);
      expect(r.status).toBe(201);
      const created = await r.json();
      expect(created.staff).toMatchObject({ email: body.email, role: 'operator', status: 'pending_mfa', createdBy: admin.staffId });
      expect(created.initialPassword.length).toBeGreaterThanOrEqual(20);
      const list = await (await admin.b.get('/admin/staff')).json();
      expect(list.find((x: { id: string }) => x.id === created.staff.id)).not.toHaveProperty('initialPassword');
      expect(await (await staffBrowser().post('/staff/auth/signin', { email: body.email, password: created.initialPassword })).json()).toEqual({
        enrolmentRequired: true,
      });
    });

    it('FR-OPS-03 disabling a staff account ends its sessions at once; an administrator cannot disable themself', async () => {
      const admin = await signedInStaff('administrator');
      const op = await signedInStaff('operator');
      const reason = { reason: 'Left the team this week' };
      expect((await admin.b.post(`/admin/staff/${admin.staffId}/disable`, reason)).status).toBe(403);
      const r = await admin.b.post(`/admin/staff/${op.staffId}/disable`, reason);
      expect(await r.json()).toMatchObject({ id: op.staffId, status: 'disabled' });
      expect((await op.b.get('/staff/me')).status).toBe(401);
      const [ended] = await fx.query(`SELECT end_reason FROM identity.sessions WHERE staff_id = $1`, [op.staffId]);
      expect(ended.end_reason).toBe('staff_disabled');
    });

    it('FR-OPS-04 the first administrator comes only from the deployment command, which refuses once one exists', async () => {
      await fx.staffAccount('administrator');
      const ds = await new DataSource({ type: 'postgres', url: requireEnv('DATABASE_URL') }).initialize();
      try {
        await expect(bootstrapAdministrator(ds, `boot-${randomUUID()}@tb.test`, 'Boot Admin')).rejects.toThrow('an administrator already exists');
      } finally {
        await ds.destroy();
      }
    });
  });

  describe('four-eyes approvals (FR-OPS-05)', () => {
    it('FR-OPS-05 a staff MFA reset takes effect only when a second administrator approves it', async () => {
      const a = await signedInStaff('administrator');
      const b = await signedInStaff('administrator');
      const op = await signedInStaff('operator');
      const target = await signedInStaff('operator');
      const reason = { reason: 'Lost the phone with the authenticator' };

      const proposed = await (await a.b.post(`/admin/staff/${target.staffId}/mfa-reset`, reason)).json();
      expect(proposed).toMatchObject({ action: 'staff.mfa_reset', targetId: target.staffId, decision: null, requiredRole: 'administrator' });
      expect((await problem(await a.b.post(`/admin/staff/${target.staffId}/mfa-reset`, reason))).type).toBe('/problems/already-proposed');
      expect((await (await target.b.get('/staff/me')).json()).id).toBe(target.staffId); // nothing happened yet

      // Not the proposer, and not another role.
      expect((await a.b.get('/staff/approvals').then((r) => r.json())).map((x: { id: string }) => x.id)).not.toContain(proposed.id);
      expect((await problem(await a.b.post(`/staff/approvals/${proposed.id}/decision`, { decision: 'approved' }))).type).toBe('/problems/own-proposal');
      expect((await op.b.post(`/staff/approvals/${proposed.id}/decision`, { decision: 'approved' })).status).toBe(403);

      expect((await b.b.get('/staff/approvals').then((r) => r.json())).map((x: { id: string }) => x.id)).toContain(proposed.id);
      const decided = await (await b.b.post(`/staff/approvals/${proposed.id}/decision`, { decision: 'approved', note: 'Checked in person' })).json();
      expect(decided).toMatchObject({ decision: 'approved', decidedBy: b.staffId });
      expect(decided.executedAt).not.toBeNull();

      expect((await target.b.get('/staff/me')).status).toBe(401);
      const [row] = await fx.query(`SELECT status FROM identity.staff_accounts WHERE id = $1`, [target.staffId]);
      expect(row.status).toBe('pending_mfa');
      const factors = await fx.query(`SELECT 1 FROM identity.totp_factors WHERE staff_id = $1 AND removed_at IS NULL`, [target.staffId]);
      expect(factors).toHaveLength(0);
      const audit = await fx.query(`SELECT actor_id, approval_id FROM audit.events WHERE action = 'staff.mfa.reset' AND object_id = $1`, [target.staffId]);
      expect(audit).toEqual([{ actor_id: b.staffId, approval_id: proposed.id }]);
      expect((await b.b.post(`/staff/approvals/${proposed.id}/decision`, { decision: 'rejected' })).status).toBe(409);
    });

    it('FR-OPS-05 a rejected proposal changes nothing', async () => {
      const a = await signedInStaff('administrator');
      const b = await signedInStaff('administrator');
      const target = await signedInStaff('operator');
      const proposed = await (await a.b.post(`/admin/staff/${target.staffId}/mfa-reset`, { reason: 'Possibly compromised device' })).json();
      const decided = await (await b.b.post(`/staff/approvals/${proposed.id}/decision`, { decision: 'rejected' })).json();
      expect(decided).toMatchObject({ decision: 'rejected', executedAt: null });
      expect((await target.b.get('/staff/me')).status).toBe(200);
    });

    it('FR-OPS-05 an expired proposal cannot be decided, and is marked expired (DV-5)', async () => {
      const a = await signedInStaff('administrator');
      const b = await signedInStaff('administrator');
      const target = await fx.staffAccount('operator');
      const proposed = await (await a.b.post(`/admin/staff/${target.staffId}/mfa-reset`, { reason: 'Authenticator app was reinstalled' })).json();
      await fx.query(`UPDATE identity.approvals SET proposed_at = now() - interval '73 hours', expires_at = now() - interval '1 hour' WHERE id = $1`, [proposed.id]);
      expect((await problem(await b.b.post(`/staff/approvals/${proposed.id}/decision`, { decision: 'approved' }))).type).toBe('/problems/approval-closed');
      const [row] = await fx.query(`SELECT decision, executed_at FROM identity.approvals WHERE id = $1`, [proposed.id]);
      expect(row).toEqual({ decision: 'expired', executed_at: null });
    });
  });

  describe('conflicts of interest (FR-OPS-06)', () => {
    it('FR-OPS-06 a declared conflict, and a user with the staff member’s own e-mail or number, are conflicts', async () => {
      const staff = t.app.get(StaffService);
      const a = await fx.account();
      const declared = await signedInStaff('operator');
      expect(await staff.hasConflict(declared.staffId, a.userId)).toBe(false);
      expect((await declared.b.post('/staff/conflicts', { userId: a.userId, reason: 'My cousin, we share a flat' })).status).toBe(204);
      expect(await staff.hasConflict(declared.staffId, a.userId)).toBe(true);

      const sameEmail = await fx.staffAccount('operator', { email: a.email.toLowerCase() });
      const sameNumber = await fx.staffAccount('operator', { phone: a.phone });
      const other = await fx.staffAccount('operator');
      expect(await staff.hasConflict(sameEmail.staffId, a.userId)).toBe(true);
      expect(await staff.hasConflict(sameNumber.staffId, a.userId)).toBe(true);
      expect(await staff.hasConflict(other.staffId, a.userId)).toBe(false);
    });
  });

  describe('audit log (SEC-LOG-01 to SEC-LOG-04)', () => {
    it('SEC-LOG-04 only administrators read the audit log; staff actions carry the actor, before and after', async () => {
      const admin = await signedInStaff('administrator');
      const op = await signedInStaff('operator');
      expect((await op.b.get('/admin/audit')).status).toBe(403);
      await admin.b.post(`/admin/staff/${op.staffId}/disable`, { reason: 'Contract has ended now' });
      const rows = await (await admin.b.get(`/admin/audit?action=staff.account.disabled&objectId=${op.staffId}`)).json();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        actorType: 'staff', actorId: admin.staffId, objectType: 'staff', before: { status: 'active' }, after: { status: 'disabled' },
        reason: 'Contract has ended now',
      });
      expect(rows[0].correlationId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('SEC-LOG-02 the chain verification recomputes every entry and reports it intact', async () => {
      const admin = await signedInStaff('administrator');
      const r = await (await admin.b.get('/admin/audit/verify')).json();
      expect(r.intact).toBe(true);
      expect(r.entries).toBeGreaterThan(0);
      // SEC-LOG-04: the application's database account cannot change an entry.
      await expect(fx.query(`UPDATE audit.events SET reason = 'x' WHERE id = (SELECT min(id) FROM audit.events)`)).rejects.toThrow();
    });
  });
});
