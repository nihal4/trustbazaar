import { authenticator } from 'otplib';
import { Browser } from '../support/browser';
import { problem, suite } from './setup';

// SEC-AUTH-07: MFA is mandatory for operators and administrators, with TOTP (or a passkey); SMS is never a staff
// second factor.
const s = suite();
const staffBrowser = () => new Browser(s.t, s.origin, '__Host-tb_scsrf');

describe('SEC-AUTH-07 staff MFA', () => {
  it.each(['operator', 'administrator'] as const)('SEC-AUTH-07 %s: the password alone gives no session, only a TOTP step', async (role) => {
    const st = await s.fx.staffAccount(role);
    const b = staffBrowser();
    expect(await (await b.post('/staff/auth/signin', { email: st.email, password: st.password })).json()).toEqual({ mfaRequired: true });
    expect(b.cookies.has('__Host-tb_sat')).toBe(false);
    expect((await b.get('/staff/me')).status).toBe(401);
    expect((await b.post('/staff/auth/mfa', { code: authenticator.generate(st.totpSecret!) })).status).toBe(204);
    expect((await b.get('/staff/me')).status).toBe(200);
  });

  it('SEC-AUTH-07 no SMS is sent to a staff member at sign-in, and an SMS method is not accepted', async () => {
    const st = await s.fx.staffAccount('operator', { phone: '+8801711000999' });
    const b = staffBrowser();
    await b.post('/staff/auth/signin', { email: st.email, password: st.password });
    expect(s.sent('+8801711000999')).toHaveLength(0);
    expect((await problem(await b.post('/staff/auth/mfa', { method: 'sms', code: '123456' }))).status).toBe(400);
  });

  it('SEC-AUTH-07 a wrong TOTP code gives no session', async () => {
    const st = await s.fx.staffAccount('operator');
    const b = staffBrowser();
    await b.post('/staff/auth/signin', { email: st.email, password: st.password });
    const right = authenticator.generate(st.totpSecret!);
    const wrong = String((Number(right) + 1) % 1e6).padStart(6, '0');
    expect((await b.post('/staff/auth/mfa', { code: wrong })).status).toBe(401);
    expect(b.cookies.has('__Host-tb_sat')).toBe(false);
  });

  it('SEC-AUTH-07 a new staff account must enrol TOTP before its first session', async () => {
    const st = await s.fx.staffAccount('operator', { status: 'pending_mfa' });
    const b = staffBrowser();
    expect(await (await b.post('/staff/auth/signin', { email: st.email, password: st.password })).json()).toEqual({ enrolmentRequired: true });
    expect((await b.get('/staff/me')).status).toBe(401);
  });
});
