import { randomInt, randomUUID } from 'crypto';
import { authenticator } from 'otplib';
import { loadConfig } from '../../src/kernel/config/config';
import { NOTIFICATIONS, ForwardedNotifications } from '../../src/modules/identity/adapters/notifications';
import { startApp, TestApp } from '../support/app';
import { Browser } from '../support/browser';
import { IdentityFixtures } from '../support/identity';

// U1-05: step-up, password reset and change, contact changes (Unit 1 sections 6.3 to 6.5), over HTTP against
// PostgreSQL and Redis, through the real security pipeline.
const problem = async (r: Response) => {
  const b = await r.json();
  return { status: r.status, type: b.type, errors: b.errors };
};
const newLocal = () => `01${randomInt(3, 10)}${String(randomInt(0, 1e8)).padStart(8, '0')}`;
const NEW_PASSWORD = 'a slow boat along the river bank';

describe('step-up, passwords and contact changes', () => {
  let t: TestApp;
  let fx: IdentityFixtures;
  let origin: string;
  let notes: ForwardedNotifications;
  const browser = () => new Browser(t, origin);

  beforeAll(async () => {
    t = await startApp();
    fx = await IdentityFixtures.open();
    origin = loadConfig(process.env).publicOrigin;
    notes = t.app.get<ForwardedNotifications>(NOTIFICATIONS);
  });
  afterAll(async () => {
    await fx?.close();
    await t?.close();
  });

  const sms = (to: string, template: string) => notes.sent.filter((m) => m.channel === 'sms' && m.to === to && m.template === template);
  const mail = (to: string, template: string) =>
    notes.sent.filter((m) => m.channel === 'email' && m.to.toLowerCase() === to.toLowerCase() && m.template === template);
  const tokenOf = (link: string) => link.split('#token=')[1];

  async function signedIn(o: { mfa?: boolean } = {}) {
    const a = await fx.account({ password: `pw ${randomUUID()}`, mfa: o.mfa });
    const b = browser();
    const r = await b.post('/auth/signin', { login: a.phone, password: a.password });
    if (o.mfa) {
      expect(r.status).toBe(200);
      expect((await b.post('/auth/signin/mfa', { code: authenticator.generate(a.totpSecret!) })).status).toBe(204);
    } else {
      expect(r.status).toBe(204);
    }
    return { a, b };
  }

  /** Step-up by SMS for one action; returns the grant. */
  async function stepUp(b: Browser, phone: string, action: string): Promise<string> {
    await fx.clearSendGap(phone); // the 60-second gap between SMS sends to one number
    const s = await b.post('/auth/step-up/start', { action });
    expect(await s.json()).toMatchObject({ method: 'sms' });
    const code = sms(phone, 'otp_step_up').at(-1)!.vars.code;
    const v = await b.post('/auth/step-up/verify', { action, code });
    expect(v.status).toBe(200);
    return (await v.json()).grant;
  }

  describe('step-up (SEC-AUTH-08)', () => {
    it('SEC-AUTH-08 an SMS code gives a grant that works once, for one action', async () => {
      const { a, b } = await signedIn();
      const change = (grant?: string) =>
        b.post('/auth/password/change', { currentPassword: a.password, newPassword: NEW_PASSWORD }, grant ? { 'x-step-up': grant } : {});
      expect((await problem(await change())).type).toBe('/problems/step-up-required');

      const phoneGrant = await stepUp(b, a.phone, 'phone.change');
      expect((await change(phoneGrant)).status).toBe(403); // a grant for another action

      const grant = await stepUp(b, a.phone, 'password.change');
      expect((await change(grant)).status).toBe(204);
      expect((await change(grant)).status).toBe(403); // used up
    });

    it('SEC-AUTH-08 a grant from another session does not work', async () => {
      const { a, b } = await signedIn();
      const other = browser();
      expect((await other.post('/auth/signin', { login: a.phone, password: a.password })).status).toBe(204);
      const grant = await stepUp(b, a.phone, 'password.change');
      const r = await other.post('/auth/password/change', { currentPassword: a.password, newPassword: NEW_PASSWORD }, { 'x-step-up': grant });
      expect((await problem(r)).type).toBe('/problems/step-up-required');
    });

    it('SEC-AUTH-08 with TOTP, the authenticator code is the challenge and no SMS is sent', async () => {
      const { a, b } = await signedIn({ mfa: true });
      const s = await b.post('/auth/step-up/start', { action: 'email.change' });
      expect(await s.json()).toEqual({ method: 'totp' });
      expect(sms(a.phone, 'otp_step_up')).toHaveLength(0);
      // The code of the next 30-second step: sign-in used this step's code, and a step is accepted only once.
      const next = authenticator.clone({ epoch: Date.now() + 30_000 }).generate(a.totpSecret!);
      const v = await b.post('/auth/step-up/verify', { action: 'email.change', code: next });
      expect(v.status).toBe(200);
      expect((await v.json()).grant).toMatch(/^[A-Za-z0-9_-]{43}$/);
    });

    it('SEC-AUTH-08 a wrong code gives no grant, and five end the SMS challenge', async () => {
      const { a, b } = await signedIn();
      await b.post('/auth/step-up/start', { action: 'account.close' });
      const code = sms(a.phone, 'otp_step_up').at(-1)!.vars.code;
      const wrong = String((Number(code) + 1) % 1e6).padStart(6, '0');
      for (let i = 0; i < 5; i++) expect((await problem(await b.post('/auth/step-up/verify', { action: 'account.close', code: wrong }))).type).toBe('/problems/otp-failed');
      expect((await problem(await b.post('/auth/step-up/verify', { action: 'account.close', code }))).type).toBe('/problems/otp-expired');
    });
  });

  describe('password change (SEC-AUTH-11)', () => {
    it('SEC-AUTH-11 needs the current password, keeps this session and ends the others', async () => {
      const { a, b } = await signedIn();
      const other = browser();
      await other.post('/auth/signin', { login: a.phone, password: a.password });
      let grant = await stepUp(b, a.phone, 'password.change');
      const wrong = await b.post('/auth/password/change', { currentPassword: 'not it', newPassword: NEW_PASSWORD }, { 'x-step-up': grant });
      expect((await problem(wrong)).type).toBe('/problems/password-incorrect');

      grant = await stepUp(b, a.phone, 'password.change');
      expect((await b.post('/auth/password/change', { currentPassword: a.password, newPassword: NEW_PASSWORD }, { 'x-step-up': grant })).status).toBe(204);
      expect((await b.get('/auth/sessions')).status).toBe(200);
      expect((await other.get('/auth/sessions')).status).toBe(401);
      expect((await browser().post('/auth/signin', { login: a.phone, password: NEW_PASSWORD })).status).toBe(204);
      expect((await browser().post('/auth/signin', { login: a.phone, password: a.password })).status).toBe(401);
      const [ev] = await fx.query(`SELECT payload FROM identity.outbox WHERE aggregate_id = $1 AND event_type = 'identity.password.changed'`, [a.userId]);
      expect(ev.payload).toEqual({ userId: a.userId, via: 'change' });
    });

    it('SEC-AUTH-02 a changed password is checked against the blocklist', async () => {
      const { a, b } = await signedIn();
      const grant = await stepUp(b, a.phone, 'password.change');
      const r = await b.post('/auth/password/change', { currentPassword: a.password, newPassword: '123456789012345' }, { 'x-step-up': grant });
      expect(await problem(r)).toMatchObject({ status: 422, errors: [{ field: 'newPassword', reason: 'common' }] });
    });
  });

  describe('password reset (FR-ACC-07, SEC-AUTH-10)', () => {
    it('FR-ACC-07 forgot answers 202 for known and unknown numbers and e-mails alike', async () => {
      const a = await fx.account();
      for (const login of [a.phone, a.email, newLocal(), `nobody-${randomUUID()}@tb.test`, 'not an identifier']) {
        const r = await browser().post('/auth/password/forgot', { login });
        expect(r.status).toBe(202);
      }
      expect(sms(a.phone, 'otp_password_reset')).toHaveLength(1);
      expect(mail(a.email, 'password_reset')).toHaveLength(1);
    });

    it('SEC-AUTH-10 a reset link sets the password once, ends every session and lifts the sign-in delay', async () => {
      const { a, b } = await signedIn();
      for (let i = 0; i < 5; i++) await browser().post('/auth/signin', { login: a.phone, password: 'wrong' });
      expect((await browser().post('/auth/signin', { login: a.phone, password: a.password })).status).toBe(429);

      await browser().post('/auth/password/forgot', { login: a.email });
      const link = mail(a.email, 'password_reset').at(-1)!.vars.link;
      expect(link.startsWith(`${origin}/reset-password#token=`)).toBe(true);
      const token = tokenOf(link);
      expect((await browser().post('/auth/password/reset', { token, newPassword: NEW_PASSWORD })).status).toBe(204);
      expect((await b.get('/auth/sessions')).status).toBe(401);
      expect((await browser().post('/auth/signin', { login: a.phone, password: NEW_PASSWORD })).status).toBe(204);
      expect((await problem(await browser().post('/auth/password/reset', { token, newPassword: `${NEW_PASSWORD} again` }))).type).toBe('/problems/link-invalid');
      const [ev] = await fx.query(`SELECT payload FROM identity.outbox WHERE aggregate_id = $1 AND event_type = 'identity.password.changed'`, [a.userId]);
      expect(ev.payload).toEqual({ userId: a.userId, via: 'reset' });
    });

    it('SEC-AUTH-10 a reset by SMS code; a wrong code and an unknown number get the same answer', async () => {
      const a = await fx.account();
      await browser().post('/auth/password/forgot', { login: a.local });
      const code = sms(a.phone, 'otp_password_reset').at(-1)!.vars.code;
      const wrong = String((Number(code) + 1) % 1e6).padStart(6, '0');
      const bad = await problem(await browser().post('/auth/password/reset', { phone: a.phone, code: wrong, newPassword: NEW_PASSWORD }));
      const unknown = await problem(await browser().post('/auth/password/reset', { phone: newLocal(), code, newPassword: NEW_PASSWORD }));
      expect(bad).toMatchObject({ status: 400, type: '/problems/otp-failed' });
      expect(unknown).toEqual(bad);
      expect((await browser().post('/auth/password/reset', { phone: a.local, code, newPassword: NEW_PASSWORD })).status).toBe(204);
      expect((await browser().post('/auth/signin', { login: a.phone, password: NEW_PASSWORD })).status).toBe(204);
    });

    it('SEC-AUTH-10 with MFA on, a reset also needs the second factor; without it the link still works', async () => {
      const a = await fx.account({ mfa: true });
      await browser().post('/auth/password/forgot', { login: a.email });
      const token = tokenOf(mail(a.email, 'password_reset').at(-1)!.vars.link);
      expect((await problem(await browser().post('/auth/password/reset', { token, newPassword: NEW_PASSWORD }))).type).toBe('/problems/mfa-required');
      expect((await problem(await browser().post('/auth/password/reset', { token, newPassword: NEW_PASSWORD, mfaCode: '000000' }))).type).toBe('/problems/mfa-failed');
      const r = await browser().post('/auth/password/reset', { token, newPassword: NEW_PASSWORD, mfaCode: a.recoveryCodes[0] });
      expect(r.status).toBe(204);
    });

    it('FR-ACC-07 an e-mail that was never verified gets no reset link', async () => {
      const userId = await fx.user({ emailVerified: false });
      const [u] = await fx.query<{ email: string }>(`SELECT email FROM identity.users WHERE id = $1`, [userId]);
      expect((await browser().post('/auth/password/forgot', { login: u.email })).status).toBe(202);
      expect(mail(u.email, 'password_reset')).toHaveLength(0);
    });
  });

  describe('contact changes (FR-ACC-09)', () => {
    it('FR-ACC-09 a new number is confirmed by a code sent to it; the old number is told', async () => {
      const { a, b } = await signedIn();
      const local = newLocal();
      const grant = await stepUp(b, a.phone, 'phone.change');
      expect((await b.post('/me/phone/change', { phone: local }, { 'x-step-up': grant })).status).toBe(202);
      const code = sms(`+88${local}`, 'otp_phone_change').at(-1)!.vars.code;
      expect((await b.post('/me/phone/change/verify', { code })).status).toBe(204);
      const [u] = await fx.query(`SELECT phone_e164 FROM identity.users WHERE id = $1`, [a.userId]);
      expect(u.phone_e164).toBe(`+88${local}`);
      expect(sms(a.phone, 'contact_changed')).toHaveLength(1);
      const events = await fx.query(`SELECT payload FROM identity.outbox WHERE aggregate_id = $1 AND event_type = 'identity.contact.changed'`, [a.userId]);
      expect(events.map((e) => e.payload)).toEqual([{ userId: a.userId, kind: 'phone' }]);
    });

    it('SEC-AUTH-06 a number of another open account gets the same answer; its owner is told and no code is sent', async () => {
      const { a, b } = await signedIn();
      const owner = await fx.account();
      const grant = await stepUp(b, a.phone, 'phone.change');
      expect((await b.post('/me/phone/change', { phone: owner.local }, { 'x-step-up': grant })).status).toBe(202);
      expect(sms(owner.phone, 'otp_phone_change')).toHaveLength(0);
      expect(sms(owner.phone, 'contact_change_attempt_existing_number')).toHaveLength(1);
      const [u] = await fx.query(`SELECT phone_e164 FROM identity.users WHERE id = $1`, [a.userId]);
      expect(u.phone_e164).toBe(a.phone);
    });

    it('FR-ACC-09 a new e-mail is confirmed by a link sent to it; the old address is told and older links stop working', async () => {
      const { a, b } = await signedIn();
      const fresh = `n-${randomUUID()}@tb.test`;
      let grant = await stepUp(b, a.phone, 'email.change');
      expect((await b.post('/me/email/change', { email: fresh }, { 'x-step-up': grant })).status).toBe(202);
      const first = tokenOf(mail(fresh, 'email_change').at(-1)!.vars.link);
      grant = await stepUp(b, a.phone, 'email.change');
      const second = `m-${randomUUID()}@tb.test`;
      expect((await b.post('/me/email/change', { email: second }, { 'x-step-up': grant })).status).toBe(202);

      expect((await browser().post('/auth/email/verify', { token: first })).status).toBe(204);
      const [u] = await fx.query(`SELECT email, email_verified_at FROM identity.users WHERE id = $1`, [a.userId]);
      expect(u.email).toBe(fresh);
      expect(u.email_verified_at).toBeInstanceOf(Date);
      expect(mail(a.email, 'contact_changed')).toHaveLength(1);
      const later = tokenOf(mail(second, 'email_change').at(-1)!.vars.link);
      expect((await problem(await browser().post('/auth/email/verify', { token: later }))).type).toBe('/problems/link-invalid');
    });
  });
});
