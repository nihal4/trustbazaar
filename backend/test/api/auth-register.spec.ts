import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { loadConfig } from '../../src/kernel/config/config';
import { NOTIFICATIONS, ForwardedNotifications } from '../../src/modules/identity/adapters/notifications';
import { startApp, TestApp } from '../support/app';
import { Browser } from '../support/browser';
import { requireEnv } from '../support/env';
import { IdentityFixtures } from '../support/identity';
import { randomLocal } from '../support/phones';

// U1-03, U10-25: registration over HTTP against PostgreSQL and Redis, through the real security pipeline: the name, the e-mail address
// and the password, a code by e-mail, then the mobile number and the terms. The person is not signed in by it (Unit 1 section 6.1).
const problem = async (r: Response) => {
  const b = await r.json();
  return { status: r.status, type: b.type, errors: b.errors };
};
const newLocal = () => randomLocal();

describe('registration', () => {
  let t: TestApp;
  let fx: IdentityFixtures;
  let redis: Redis;
  let legal: { termsVersion: string; privacyVersion: string };
  let notes: ForwardedNotifications;
  const browser = () => new Browser(t, loadConfig(process.env).publicOrigin);

  beforeAll(async () => {
    t = await startApp();
    fx = await IdentityFixtures.open();
    redis = new Redis(requireEnv('REDIS_URL'));
    legal = loadConfig(process.env).legal;
    notes = t.app.get<ForwardedNotifications>(NOTIFICATIONS);
  });
  afterAll(async () => {
    redis?.disconnect();
    await fx?.close();
    await t?.close();
  });

  const details = (o: Partial<Record<string, unknown>> = {}) => ({
    email: `r-${randomUUID()}@tb.test`,
    displayName: 'Karim Hossain',
    password: 'green tea at dawn by the river',
    ...o,
  });
  const finish = (registrationId: string, d: { password: string }, o: Partial<Record<string, unknown>> = {}) => ({
    registrationId, phone: newLocal(), password: d.password, ...legal, adultConfirmed: true, ...o,
  });
  const e164 = (local: string) => `+88${local}`;
  const mails = (to: string, template: string) => notes.sent.filter((m) => m.channel === 'email' && m.to.toLowerCase() === to.toLowerCase() && m.template === template);
  const codeFor = (email: string) => mails(email, 'otp_register_email').at(-1)!.vars.code;
  const wrong = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, '0');
  const userByEmail = async (email: string) => (await fx.query(`SELECT * FROM identity.users WHERE email = $1`, [email]))[0];

  async function start(b: Browser, d = details()) {
    const r = await b.post('/auth/register', d);
    return { r, d, body: r.status === 202 ? await r.json() : undefined };
  }
  async function confirmed(b = browser(), d = details()) {
    const s = await start(b, d);
    expect((await b.post('/auth/register/verify', { registrationId: s.body.registrationId, code: codeFor(d.email) })).status).toBe(204);
    return s;
  }

  it('FR-ACC-02 a new address gets a code by e-mail; the code alone creates no account and signs nobody in', async () => {
    const b = browser();
    const { r, d, body } = await start(b);
    expect(r.status).toBe(202);
    expect(body.registrationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Date(body.resendAt).getTime()).toBeGreaterThan(Date.now());
    expect(mails(d.email, 'otp_register_email')).toHaveLength(1);
    expect(await userByEmail(d.email)).toBeUndefined();

    expect((await b.post('/auth/register/verify', { registrationId: body.registrationId, code: codeFor(d.email) })).status).toBe(204);
    expect(await userByEmail(d.email)).toBeUndefined(); // the number and the terms are still to come
    expect(b.cookies.has('__Host-tb_at')).toBe(false);
    expect((await b.get('/auth/sessions')).status).toBe(401);
  });

  it('FR-ACC-01 the number, the age confirmation and the current terms create the account; the e-mail counts as verified; nobody is signed in; the person is told', async () => {
    const b = browser();
    const { d, body } = await confirmed();
    const phone = newLocal();
    const r = await b.post('/auth/register/complete', finish(body.registrationId, d, { phone }));
    expect(r.status).toBe(204);
    const u = await userByEmail(d.email);
    expect(u).toMatchObject({ phone_e164: e164(phone), display_name: 'Karim Hossain', phone_verified_at: null });
    expect(u.email_verified_at).toBeInstanceOf(Date);
    expect(u.password_hash).toMatch(/^\$argon2id\$/);
    expect(b.cookies.has('__Host-tb_at')).toBe(false);
    expect((await b.get('/auth/sessions')).status).toBe(401);
    const events = await fx.query(`SELECT event_type FROM identity.outbox WHERE aggregate_id = $1`, [u.id]);
    expect(events.map((e) => e.event_type)).toContain('identity.user.registered');
    const audit = await fx.query(`SELECT action FROM audit.events WHERE object_id = $1`, [u.id]);
    expect(audit.map((a) => a.action)).toContain('identity.account.registered');
    const welcome = mails(d.email, 'account_created');
    expect(welcome).toHaveLength(1);
    expect(welcome[0].vars.link).toMatch(/\/signin$/);
    // a second answer cannot make a second account: the sign-up is used up
    expect((await problem(await b.post('/auth/register/complete', finish(body.registrationId, d)))).type).toBe('/problems/otp-expired');
  });

  it('FR-ACC-04 the accepted terms and privacy versions are recorded with the time; the age confirmation is required; an old version is refused and keeps the sign-up', async () => {
    const { d, body } = await confirmed();
    const old = await problem(await browser().post('/auth/register/complete', finish(body.registrationId, d, { termsVersion: 'old-1' })));
    expect(old).toMatchObject({ status: 400, type: '/problems/validation-failed', errors: [{ field: 'termsVersion', reason: 'not-current' }] });
    const minor = await problem(await browser().post('/auth/register/complete', finish(body.registrationId, d, { adultConfirmed: false })));
    expect(minor).toMatchObject({ status: 400, errors: [{ field: 'adultConfirmed', reason: 'required' }] });
    expect(await userByEmail(d.email)).toBeUndefined();

    expect((await browser().post('/auth/register/complete', finish(body.registrationId, d))).status).toBe(204);
    const consents = await fx.query(
      `SELECT c.document, c.version, c.granted, c.recorded_at FROM identity.consents c JOIN identity.users u ON u.id = c.user_id
       WHERE u.email = $1 ORDER BY c.document`,
      [d.email],
    );
    expect(consents).toEqual([
      { document: 'privacy', version: legal.privacyVersion, granted: true, recorded_at: expect.any(Date) },
      { document: 'terms', version: legal.termsVersion, granted: true, recorded_at: expect.any(Date) },
    ]);
  });

  it('FR-ACC-01 only a Bangladeshi mobile number is accepted, in local or international form', async () => {
    const { d, body } = await confirmed();
    for (const phone of ['+14155550100', '029123456', '01212345678']) {
      expect(await problem(await browser().post('/auth/register/complete', finish(body.registrationId, d, { phone })))).toMatchObject({
        status: 400, errors: [{ field: 'phone', reason: 'not-bangladeshi-mobile' }],
      });
    }
    expect((await browser().post('/auth/register/complete', finish(body.registrationId, d, { phone: e164(newLocal()) }))).status).toBe(204);
  });

  it('SEC-AUTH-02 a short, common or personal password is refused before any code is sent; one with the number in it is refused at the last step', async () => {
    for (const [password, reason] of [
      ['short phrase', 'too-short'],
      ['123456789012345', 'common'],
      ['karim hossain forever', 'context'],
      ['trustbazaar rocks a lot', 'context'],
    ]) {
      const d = details({ password });
      expect(await problem((await start(browser(), d)).r)).toMatchObject({
        status: 422, type: '/problems/password-rejected', errors: [{ field: 'password', reason }],
      });
      expect(mails(d.email, 'otp_register_email')).toHaveLength(0);
    }
    const phone = newLocal();
    const d = details({ password: `call me on ${phone} now` });
    const s = await confirmed(browser(), d);
    expect(await problem(await browser().post('/auth/register/complete', finish(s.body.registrationId, d, { phone })))).toMatchObject({
      status: 422, errors: [{ field: 'password', reason: 'context' }],
    });
    // a password other than the first step's is refused
    expect(await problem(await browser().post('/auth/register/complete', finish(s.body.registrationId, d, { password: 'another long phrase here' })))).toMatchObject({
      status: 400, errors: [{ field: 'password', reason: 'mismatch' }],
    });
  });

  it('SEC-AUTH-06 a new and an existing e-mail address get identical first answers; the owner is told and no code is sent', async () => {
    const owner = await fx.account();
    const fresh = await start(browser());
    const same = await start(browser(), details({ email: owner.email.toUpperCase() }));
    for (const s of [fresh, same]) {
      expect(s.r.status).toBe(202);
      expect(Object.keys(s.body).sort()).toEqual(['registrationId', 'resendAt']);
    }
    expect(mails(owner.email, 'otp_register_email')).toHaveLength(0);
    expect(mails(owner.email, 'register_attempt_existing_email')).toHaveLength(1);
    // no code can ever be right for it, and nothing leaks about why
    const r = await problem(await browser().post('/auth/register/verify', { registrationId: same.body.registrationId, code: '123456' }));
    expect(r).toMatchObject({ status: 400, type: '/problems/otp-failed' });
  });

  it('FR-ACC-03 a number of an open account is refused at the last step, generically, and its owner is told', async () => {
    const owner = await fx.account();
    const { d, body } = await confirmed();
    const r = await problem(await browser().post('/auth/register/complete', finish(body.registrationId, d, { phone: owner.local })));
    expect(r).toMatchObject({ status: 409, type: '/problems/registration-refused' });
    expect(await userByEmail(d.email)).toBeUndefined();
    expect(notes.sent.filter((m) => m.channel === 'sms' && m.to === owner.phone && m.template === 'register_attempt_existing_number')).toHaveLength(1);
    expect(mails(d.email, 'account_created')).toHaveLength(0);
  });

  it('SEC-AUTH-09 the code is stored only as an HMAC (never in the clear), and works once', async () => {
    const b = browser();
    const { d, body } = await start(b);
    const code = codeFor(d.email);
    const stored = (await redis.get(`reg:pending:${body.registrationId}`))!;
    expect(stored).not.toContain(code);
    expect(stored).not.toContain(d.password);
    expect((await b.post('/auth/register/verify', { registrationId: body.registrationId, code })).status).toBe(204);
    const again = await problem(await browser().post('/auth/register/verify', { registrationId: body.registrationId, code }));
    expect(again).toMatchObject({ status: 410, type: '/problems/otp-expired' });
  });

  it('FR-ACC-03 ten simultaneous completions create exactly one account', async () => {
    const { d, body } = await confirmed();
    const phone = newLocal();
    const answers = await Promise.all(Array.from({ length: 10 }, () => browser().post('/auth/register/complete', finish(body.registrationId, d, { phone }))));
    expect(answers.map((a) => a.status).sort()).toEqual([204, ...Array(9).fill(410)]);
    expect((await fx.query(`SELECT count(*)::int AS n FROM identity.users WHERE email = $1`, [d.email]))[0].n).toBe(1);
  });

  it('FR-ACC-02 the number and the terms cannot be completed before the code is right', async () => {
    const { d, body } = await start(browser());
    expect((await problem(await browser().post('/auth/register/complete', finish(body.registrationId, d)))).type).toBe('/problems/otp-expired');
    expect(await userByEmail(d.email)).toBeUndefined();
  });

  it('SEC-AUTH-09 five wrong codes end the sign-up, also for the right code afterwards', async () => {
    const b = browser();
    const { d, body } = await start(b);
    const code = codeFor(d.email);
    for (let i = 0; i < 4; i++) {
      expect(await problem(await b.post('/auth/register/verify', { registrationId: body.registrationId, code: wrong(code) }))).toMatchObject({
        status: 400, type: '/problems/otp-failed',
      });
    }
    expect((await problem(await b.post('/auth/register/verify', { registrationId: body.registrationId, code: wrong(code) }))).type).toBe('/problems/otp-expired');
    expect((await problem(await b.post('/auth/register/verify', { registrationId: body.registrationId, code }))).type).toBe('/problems/otp-expired');
  });

  it('SEC-AUTH-09 an expired code is refused', async () => {
    const b = browser();
    const { d, body } = await start(b);
    const key = `reg:pending:${body.registrationId}`;
    const p = JSON.parse((await redis.get(key))!);
    await redis.set(key, JSON.stringify({ ...p, until: Date.now() - 1000 }), 'EX', 60);
    expect((await problem(await b.post('/auth/register/verify', { registrationId: body.registrationId, code: codeFor(d.email) }))).type).toBe('/problems/otp-expired');
  });

  it('SEC-AUTH-09 a resend waits for the resend time, replaces the code, and sends per address are limited (CP-05)', async () => {
    const b = browser();
    const { d, body } = await start(b);
    const first = codeFor(d.email);
    const early = await b.post('/auth/register/resend', { registrationId: body.registrationId });
    expect(early.status).toBe(429);
    expect(Number(early.headers.get('retry-after'))).toBeGreaterThan(0);

    const gap = `otp:gap:email:${d.email}`;
    await redis.del(gap);
    expect((await browser().post('/auth/register/resend', { registrationId: body.registrationId })).status).toBe(202);
    const second = codeFor(d.email);
    expect(mails(d.email, 'otp_register_email')).toHaveLength(2);
    if (first !== second) {
      expect((await problem(await b.post('/auth/register/verify', { registrationId: body.registrationId, code: first }))).type).toBe('/problems/otp-failed');
    }
    await redis.del(gap);
    expect((await browser().post('/auth/register/resend', { registrationId: body.registrationId })).status).toBe(202);
    await redis.del(gap);
    const fourth = await browser().post('/auth/register/resend', { registrationId: body.registrationId });
    expect(fourth.status).toBe(429); // CP-05: 3 sends per address per hour
    expect(mails(d.email, 'otp_register_email')).toHaveLength(3);
    expect((await b.post('/auth/register/verify', { registrationId: body.registrationId, code: codeFor(d.email) })).status).toBe(204);
  });
});
