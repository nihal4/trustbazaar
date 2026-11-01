import { randomInt } from 'crypto';
import { authenticator } from 'otplib';
import { loadConfig } from '../../src/kernel/config/config';
import { NOTIFICATIONS, ForwardedNotifications } from '../../src/modules/identity/adapters/notifications';
import { startApp, TestApp } from '../support/app';
import { Browser } from '../support/browser';
import { IdentityFixtures } from '../support/identity';

// U1-04: sign-in, MFA, refresh rotation, sign-out and sessions (Unit 1 sections 4.2 and 6.2), over HTTP
// against PostgreSQL and Redis, through the real security pipeline.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const problem = async (r: Response) => {
  const b = await r.json();
  return { status: r.status, type: b.type, title: b.title };
};

describe('sign-in and sessions', () => {
  let t: TestApp;
  let fx: IdentityFixtures;
  let origin: string;
  const browser = () => new Browser(t, origin);
  const totp = (secret: string) => authenticator.generate(secret);

  beforeAll(async () => {
    t = await startApp();
    fx = await IdentityFixtures.open();
    origin = loadConfig(process.env).publicOrigin;
  });
  afterAll(async () => {
    await fx?.close();
    await t?.close();
  });

  const signIn = (b: Browser, login: string, password: string) => b.post('/auth/signin', { login, password });

  describe('password step', () => {
    it('FR-ACC-05 a user signs in with a mobile number in local form and gets a session', async () => {
      const a = await fx.account();
      const b = browser();
      expect((await signIn(b, a.local, a.password)).status).toBe(204);
      for (const c of ['__Host-tb_at', '__Host-tb_csrf', '__Secure-tb_rt', '__Host-tb_dev']) expect(b.cookies.has(c)).toBe(true);
      const sessions = await (await b.get('/auth/sessions')).json();
      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toMatchObject({ current: true, device: 'Chrome on Android' });
    });

    it('FR-ACC-05 a user signs in with an e-mail address in any letter case', async () => {
      const a = await fx.account();
      expect((await signIn(browser(), a.email.toUpperCase(), a.password)).status).toBe(204);
    });

    it('SEC-SES-03 session cookies are HttpOnly, Secure and SameSite=Strict; the refresh cookie goes only to the refresh path', async () => {
      const a = await fx.account();
      const b = browser();
      await signIn(b, a.phone, a.password);
      expect(b.attributes('__Host-tb_at')).toMatchObject({ httponly: true, secure: true, samesite: 'Strict', path: '/' });
      expect(b.attributes('__Secure-tb_rt')).toMatchObject({ httponly: true, secure: true, samesite: 'Strict', path: '/api/v1/auth/refresh' });
      expect(b.attributes('__Host-tb_csrf')).toMatchObject({ secure: true, samesite: 'Strict', path: '/' });
      expect(b.attributes('__Host-tb_csrf').httponly).toBeUndefined(); // the page copies it into X-CSRF-Token
    });

    it('SEC-AUTH-05 an unknown account, a wrong password and a closed account get the same answer', async () => {
      const a = await fx.account();
      const closed = await fx.account({ status: 'closed' });
      const unknown = await problem(await signIn(browser(), `017${String(randomInt(0, 1e8)).padStart(8, '0')}`, 'whatever'));
      const wrong = await problem(await signIn(browser(), a.phone, 'not-the-password'));
      const gone = await problem(await signIn(browser(), closed.phone, closed.password));
      expect(unknown).toEqual({ status: 401, type: '/problems/signin-failed', title: unknown.title });
      expect(wrong).toEqual(unknown);
      expect(gone).toEqual(unknown);
    });

    it('SEC-AUTH-04 after five failures the next attempt waits, doubling; the owner is notified once', async () => {
      const a = await fx.account();
      const b = browser();
      const notes = t.app.get<ForwardedNotifications>(NOTIFICATIONS);
      for (let i = 0; i < 5; i++) expect((await signIn(b, a.phone, 'wrong')).status).toBe(401);
      let r = await signIn(b, a.phone, a.password);
      expect(r.status).toBe(429);
      expect(r.headers.get('retry-after')).toBe('1');
      await sleep(1100);
      expect((await signIn(b, a.phone, 'wrong')).status).toBe(401);
      r = await signIn(b, a.phone, a.password);
      expect(r.status).toBe(429);
      expect(r.headers.get('retry-after')).toBe('2');
      expect(notes.sent.filter((m) => m.to === a.phone && m.template === 'signin_throttled')).toHaveLength(1);
    });

    it('SEC-AUTH-04 unknown accounts are throttled exactly like real ones', async () => {
      const b = browser();
      const unknown = `013${String(randomInt(0, 1e8)).padStart(8, '0')}`; // a number no account has
      for (let i = 0; i < 5; i++) expect((await signIn(b, unknown, 'x')).status).toBe(401);
      expect((await signIn(b, unknown, 'x')).status).toBe(429);
    });

    it('SEC-AUTH-04 a successful sign-in clears the failure count', async () => {
      const a = await fx.account();
      for (let i = 0; i < 4; i++) await signIn(browser(), a.phone, 'wrong');
      expect((await signIn(browser(), a.phone, a.password)).status).toBe(204);
      for (let i = 0; i < 4; i++) expect((await signIn(browser(), a.phone, 'wrong')).status).toBe(401);
      expect((await signIn(browser(), a.phone, a.password)).status).toBe(204);
    });

    it('SEC-AUTH-03 a password hash with older parameters is replaced at sign-in', async () => {
      const a = await fx.account({ weakHash: true });
      expect((await signIn(browser(), a.phone, a.password)).status).toBe(204);
      const [{ password_hash }] = await fx.query<{ password_hash: string }>('SELECT password_hash FROM identity.users WHERE id = $1', [a.userId]);
      expect(password_hash).toMatch(/m=19456/);
    });

    it('FR-TNS-05 a suspended user can still sign in', async () => {
      const a = await fx.account({ status: 'suspended' });
      expect((await signIn(browser(), a.phone, a.password)).status).toBe(204);
    });

    it('SEC-LOG-01 sign-in success and failure are recorded in the audit log', async () => {
      const a = await fx.account();
      await signIn(browser(), a.phone, 'wrong');
      await signIn(browser(), a.phone, a.password);
      const rows = await fx.query<{ action: string }>(
        `SELECT action FROM audit.events WHERE actor_id = $1 ORDER BY chain_pos`, [a.userId]);
      expect(rows.map((r) => r.action)).toEqual(['identity.signin.failed', 'identity.signin.succeeded']);
    });
  });

  describe('second factor', () => {
    it('FR-ACC-06 with MFA the password step answers 200 mfaRequired, and the TOTP code completes sign-in', async () => {
      const a = await fx.account({ mfa: true });
      const b = browser();
      const r = await signIn(b, a.phone, a.password);
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ mfaRequired: true });
      expect(b.cookies.has('__Host-tb_at')).toBe(false);
      expect((await b.get('/auth/sessions')).status).toBe(401); // the ticket is not a session
      expect((await b.post('/auth/signin/mfa', { code: totp(a.totpSecret!) })).status).toBe(204);
      expect((await b.get('/auth/sessions')).status).toBe(200);
      expect(b.cookies.has('__Host-tb_mfa')).toBe(false);
    });

    it('FR-ACC-06 a TOTP code cannot be used twice', async () => {
      const a = await fx.account({ mfa: true });
      const code = totp(a.totpSecret!);
      const first = browser();
      await signIn(first, a.phone, a.password);
      expect((await first.post('/auth/signin/mfa', { code })).status).toBe(204);
      const second = browser();
      await signIn(second, a.phone, a.password);
      expect(await problem(await second.post('/auth/signin/mfa', { code }))).toMatchObject({ status: 401, type: '/problems/mfa-failed' });
    });

    it('FR-ACC-06 a recovery code replaces the TOTP code once', async () => {
      const a = await fx.account({ mfa: true });
      const code = a.recoveryCodes[0].toLowerCase();
      const first = browser();
      await signIn(first, a.phone, a.password);
      expect((await first.post('/auth/signin/mfa', { code })).status).toBe(204);
      const second = browser();
      await signIn(second, a.phone, a.password);
      expect((await second.post('/auth/signin/mfa', { code })).status).toBe(401);
    });

    it('FR-ACC-06 five wrong codes end the ticket; the password must be entered again', async () => {
      const a = await fx.account({ mfa: true });
      const b = browser();
      await signIn(b, a.phone, a.password);
      for (let i = 0; i < 5; i++) expect((await b.post('/auth/signin/mfa', { code: '000000' })).status).toBe(401);
      expect(await problem(await b.post('/auth/signin/mfa', { code: totp(a.totpSecret!) }))).toMatchObject({
        status: 401, type: '/problems/session-ended',
      });
    });
  });

  describe('refresh (SEC-SES-02)', () => {
    async function signedIn() {
      const a = await fx.account();
      const b = browser();
      await signIn(b, a.phone, a.password);
      return { a, b };
    }

    it('SEC-SES-02 a refresh replaces the refresh token and issues a new access token', async () => {
      const { b } = await signedIn();
      const before = { rt: b.cookies.get('__Secure-tb_rt'), at: b.cookies.get('__Host-tb_at') };
      await sleep(1100); // a new second, so the new access token differs
      expect((await b.post('/auth/refresh')).status).toBe(204);
      expect(b.cookies.get('__Secure-tb_rt')).not.toBe(before.rt);
      expect(b.cookies.get('__Host-tb_at')).not.toBe(before.at);
      expect((await b.get('/auth/sessions')).status).toBe(200);
    });

    it('SEC-SES-02 the replaced token presented within 10 seconds answers 409, so the tab retries', async () => {
      const { b } = await signedIn();
      const old = b.cookies.get('__Secure-tb_rt')!;
      expect((await b.post('/auth/refresh')).status).toBe(204);
      const stale = browser();
      stale.cookies.set('__Secure-tb_rt', old);
      expect(await problem(await stale.post('/auth/refresh'))).toMatchObject({ status: 409, type: '/problems/refresh-retry' });
      expect((await b.get('/auth/sessions')).status).toBe(200); // the session lives on
    });

    it('SEC-SES-02 twenty parallel refreshes of one token rotate it exactly once', async () => {
      const { b } = await signedIn();
      const token = b.cookies.get('__Secure-tb_rt')!;
      const tabs = Array.from({ length: 20 }, () => {
        const tab = browser();
        tab.cookies.set('__Secure-tb_rt', token);
        return tab;
      });
      const statuses = (await Promise.all(tabs.map((tab) => tab.post('/auth/refresh')))).map((r) => r.status).sort();
      expect(statuses.filter((s) => s === 204)).toHaveLength(1);
      expect(statuses.filter((s) => s === 409)).toHaveLength(19);
    });

    it('SEC-SES-02 a replaced token after the grace window ends the session and reports the reuse', async () => {
      const { a, b } = await signedIn();
      const old = b.cookies.get('__Secure-tb_rt')!;
      expect((await b.post('/auth/refresh')).status).toBe(204);
      await fx.query(
        `UPDATE identity.refresh_tokens SET used_at = used_at - interval '1 minute'
         WHERE session_id IN (SELECT id FROM identity.sessions WHERE user_id = $1) AND used_at IS NOT NULL`, [a.userId]);
      const thief = browser();
      thief.cookies.set('__Secure-tb_rt', old);
      expect((await thief.post('/auth/refresh')).status).toBe(401);
      expect((await b.get('/auth/sessions')).status).toBe(401); // the owner's session ended too
      expect((await b.post('/auth/refresh')).status).toBe(401);
      const [s] = await fx.query<{ end_reason: string }>(`SELECT end_reason FROM identity.sessions WHERE user_id = $1`, [a.userId]);
      expect(s.end_reason).toBe('refresh_reuse');
      const events = await fx.query(`SELECT 1 FROM identity.outbox WHERE event_type = 'identity.session.reuse_detected' AND aggregate_id = $1`, [a.userId]);
      expect(events).toHaveLength(1);
    });

    it('SEC-SES-02 a refresh without a token, or with an unknown one, answers 401', async () => {
      expect((await browser().post('/auth/refresh')).status).toBe(401);
      const b = browser();
      b.cookies.set('__Secure-tb_rt', 'not-a-token');
      expect((await b.post('/auth/refresh')).status).toBe(401);
    });
  });

  describe('sessions', () => {
    it('SEC-SES-05 sign-out ends the session at once: its access token is refused', async () => {
      const a = await fx.account();
      const b = browser();
      await signIn(b, a.phone, a.password);
      const at = b.cookies.get('__Host-tb_at')!;
      expect((await b.post('/auth/signout')).status).toBe(204);
      const replay = browser();
      replay.cookies.set('__Host-tb_at', at);
      expect((await replay.get('/auth/sessions')).status).toBe(401);
    });

    it('FR-ACC-08 a user lists their sessions, ends one, and ends all the others', async () => {
      const a = await fx.account();
      const [one, two, three] = [browser(), browser(), browser()];
      for (const b of [one, two, three]) await signIn(b, a.phone, a.password);
      const list = await (await one.get('/auth/sessions')).json();
      expect(list).toHaveLength(3);
      const twoId = list.find((s: { current: boolean }) => !s.current).id as string;
      expect((await one.del(`/auth/sessions/${twoId}`)).status).toBe(204);
      expect((await one.get('/auth/sessions')).status).toBe(200);
      expect(await (await one.post('/auth/sessions/end-others')).json()).toEqual({ ended: 1 });
      expect((await one.get('/auth/sessions')).status).toBe(200);
      expect((await two.get('/auth/sessions')).status).toBe(401);
      expect((await three.get('/auth/sessions')).status).toBe(401);
    });

    it('SEC-SDL-09 a user cannot end another user\'s session', async () => {
      const [a, z] = [await fx.account(), await fx.account()];
      const [ba, bz] = [browser(), browser()];
      await signIn(ba, a.phone, a.password);
      await signIn(bz, z.phone, z.password);
      const [zs] = await (await bz.get('/auth/sessions')).json();
      expect((await ba.del(`/auth/sessions/${zs.id}`)).status).toBe(404);
      expect((await bz.get('/auth/sessions')).status).toBe(200);
    });

    it('FR-NTF-06 a sign-in from a new device is announced; from a known device it is not', async () => {
      const a = await fx.account();
      const count = async () =>
        (await fx.query(`SELECT 1 FROM identity.outbox WHERE event_type = 'identity.signin.new_device' AND aggregate_id = $1`, [a.userId])).length;
      const b = browser();
      await signIn(b, a.phone, a.password);
      expect(await count()).toBe(1);
      await b.post('/auth/signout');
      await signIn(b, a.phone, a.password); // the device cookie is still there
      expect(await count()).toBe(1);
      await signIn(browser(), a.phone, a.password);
      expect(await count()).toBe(2);
    });

    it('SEC-LOG-01 ending a session is recorded in the audit log', async () => {
      const a = await fx.account();
      const b = browser();
      await signIn(b, a.phone, a.password);
      await b.post('/auth/signout');
      const rows = await fx.query<{ reason: string }>(
        `SELECT reason FROM audit.events WHERE actor_id = $1 AND action = 'identity.session.ended'`, [a.userId]);
      expect(rows.map((r) => r.reason)).toEqual(['logout']);
    });
  });
});
