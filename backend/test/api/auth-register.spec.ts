import { randomInt, randomUUID } from 'crypto';
import Redis from 'ioredis';
import { loadConfig } from '../../src/kernel/config/config';
import { NOTIFICATIONS, SimulatedNotifications } from '../../src/modules/identity/adapters/notifications';
import { hashOtp } from '../../src/modules/identity/crypto/otp';
import { startApp, TestApp } from '../support/app';
import { Browser } from '../support/browser';
import { requireEnv } from '../support/env';
import { IdentityFixtures } from '../support/identity';

// U1-03: registration with phone OTP, and the e-mail link (Unit 1 sections 4.2 and 6.1), over HTTP against
// PostgreSQL and Redis, through the real security pipeline.
const problem = async (r: Response) => {
  const b = await r.json();
  return { status: r.status, type: b.type, errors: b.errors };
};
const newLocal = () => `01${randomInt(3, 10)}${String(randomInt(0, 1e8)).padStart(8, '0')}`;

describe('registration', () => {
  let t: TestApp;
  let fx: IdentityFixtures;
  let redis: Redis;
  let origin: string;
  let legal: { termsVersion: string; privacyVersion: string };
  let notes: SimulatedNotifications;
  const browser = () => new Browser(t, origin);

  beforeAll(async () => {
    t = await startApp();
    fx = await IdentityFixtures.open();
    redis = new Redis(requireEnv('REDIS_URL'));
    const cfg = loadConfig(process.env);
    origin = cfg.publicOrigin;
    legal = cfg.legal;
    notes = t.app.get<SimulatedNotifications>(NOTIFICATIONS);
  });
  afterAll(async () => {
    redis?.disconnect();
    await fx?.close();
    await t?.close();
  });

  const details = (o: Partial<Record<string, unknown>> = {}) => ({
    phone: newLocal(),
    email: `r-${randomUUID()}@tb.test`,
    displayName: 'Karim Hossain',
    password: 'green tea at dawn by the river',
    ...legal,
    adultConfirmed: true,
    ...o,
  });
  const e164 = (local: string) => `+88${local}`;
  const sms = (phone: string, template: string) => notes.sent.filter((m) => m.channel === 'sms' && m.to === phone && m.template === template);
  const codeFor = (phone: string) => sms(phone, 'otp_register').at(-1)!.vars.code;
  const wrong = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, '0');
  const userCount = async (phone: string) => (await fx.query(`SELECT count(*)::int AS n FROM identity.users WHERE phone_e164 = $1`, [phone]))[0].n;

  async function start(b: Browser, d = details()) {
    const r = await b.post('/auth/register', d);
    return { r, d, body: r.status === 202 ? await r.json() : undefined };
  }

  it('FR-ACC-02 a new number gets an OTP; the account exists only after the code, and the person is signed in', async () => {
    const b = browser();
    const { r, d, body } = await start(b);
    expect(r.status).toBe(202);
    expect(body.registrationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Date(body.resendAt).getTime()).toBeGreaterThan(Date.now());
    expect(await userCount(e164(d.phone as string))).toBe(0);

    expect((await b.post('/auth/register/verify', { registrationId: body.registrationId, code: codeFor(e164(d.phone as string)) })).status).toBe(204);
    const [u] = await fx.query<{ id: string; phone_verified_at: Date; email_verified_at: Date | null; password_hash: string; display_name: string }>(
      `SELECT id, phone_verified_at, email_verified_at, password_hash, display_name FROM identity.users WHERE phone_e164 = $1`,
      [e164(d.phone as string)],
    );
    expect(u.phone_verified_at).toBeInstanceOf(Date);
    expect(u.email_verified_at).toBeNull();
    expect(u.password_hash).toMatch(/^\$argon2id\$/);
    expect(u.display_name).toBe('Karim Hossain');
    expect((await b.get('/auth/sessions')).status).toBe(200);
    const events = await fx.query(`SELECT event_type FROM identity.outbox WHERE aggregate_id = $1`, [u.id]);
    expect(events.map((e) => e.event_type)).toContain('identity.user.registered');
    const audit = await fx.query(`SELECT action FROM audit.events WHERE object_id = $1`, [u.id]);
    expect(audit.map((a) => a.action)).toContain('identity.account.registered');
  });

  it('FR-ACC-04 the accepted terms and privacy versions are recorded with the time; age confirmation is required', async () => {
    const b = browser();
    const { d, body } = await start(b);
    await b.post('/auth/register/verify', { registrationId: body.registrationId, code: codeFor(e164(d.phone as string)) });
    const consents = await fx.query(
      `SELECT c.document, c.version, c.granted, c.recorded_at FROM identity.consents c JOIN identity.users u ON u.id = c.user_id
       WHERE u.phone_e164 = $1 ORDER BY c.document`,
      [e164(d.phone as string)],
    );
    expect(consents).toEqual([
      { document: 'privacy', version: legal.privacyVersion, granted: true, recorded_at: expect.any(Date) },
      { document: 'terms', version: legal.termsVersion, granted: true, recorded_at: expect.any(Date) },
    ]);

    const old = await problem((await start(browser(), details({ termsVersion: 'old-1' }))).r);
    expect(old).toMatchObject({ status: 400, type: '/problems/validation-failed', errors: [{ field: 'termsVersion', reason: 'not-current' }] });
    const minor = await problem((await start(browser(), details({ adultConfirmed: false }))).r);
    expect(minor).toMatchObject({ status: 400, errors: [{ field: 'adultConfirmed', reason: 'required' }] });
  });

  it('FR-ACC-01 only a Bangladeshi mobile number is accepted, in local or international form', async () => {
    for (const phone of ['+14155550100', '029123456', '01212345678']) {
      expect(await problem((await start(browser(), details({ phone }))).r)).toMatchObject({
        status: 400, errors: [{ field: 'phone', reason: 'not-bangladeshi-mobile' }],
      });
    }
    expect((await start(browser(), details({ phone: e164(newLocal()) }))).r.status).toBe(202);
  });

  it('SEC-AUTH-02 a short, common or personal password is refused before any code is sent', async () => {
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
      expect(sms(e164(d.phone as string), 'otp_register')).toHaveLength(0);
    }
  });

  it('SEC-AUTH-06 a new number, an existing number and an existing e-mail get identical first answers', async () => {
    const owner = await fx.account();
    const fresh = await start(browser());
    const sameNumber = await start(browser(), details({ phone: owner.local }));
    const sameEmail = await start(browser(), details({ email: owner.email.toLowerCase() }));
    for (const s of [fresh, sameNumber, sameEmail]) {
      expect(s.r.status).toBe(202);
      expect(Object.keys(s.body).sort()).toEqual(['registrationId', 'resendAt']);
    }
    // FR-ACC-03: the existing number gets no code; its owner is told instead.
    expect(sms(owner.phone, 'otp_register')).toHaveLength(0);
    expect(sms(owner.phone, 'register_attempt_existing_number')).toHaveLength(1);
  });

  it('FR-ACC-03 a registration with an e-mail of an open account is refused generically, and that owner is told', async () => {
    const owner = await fx.account();
    const b = browser();
    const { d, body } = await start(b, details({ email: owner.email.toUpperCase() }));
    const r = await problem(await b.post('/auth/register/verify', { registrationId: body.registrationId, code: codeFor(e164(d.phone as string)) }));
    expect(r).toMatchObject({ status: 409, type: '/problems/registration-refused' });
    expect(await userCount(e164(d.phone as string))).toBe(0);
    expect(notes.sent.filter((m) => m.channel === 'email' && m.to.toLowerCase() === owner.email.toLowerCase() && m.template === 'register_attempt_existing_email')).toHaveLength(1);
    expect(b.cookies.has('__Host-tb_at')).toBe(false);
  });

  it('SEC-AUTH-09 the OTP is stored only as an HMAC under the pepper, and works once', async () => {
    const b = browser();
    const { d, body } = await start(b);
    const code = codeFor(e164(d.phone as string));
    const [ch] = await fx.query<{ code_hash: Buffer }>(`SELECT code_hash FROM identity.otp_challenges WHERE pending_registration_id = $1`, [body.registrationId]);
    expect(ch.code_hash.equals(hashOtp(loadConfig(process.env).secrets.otpPepper.reveal(), code))).toBe(true);
    expect((await b.post('/auth/register/verify', { registrationId: body.registrationId, code })).status).toBe(204);
    const again = await problem(await browser().post('/auth/register/verify', { registrationId: body.registrationId, code }));
    expect(again).toMatchObject({ status: 410, type: '/problems/otp-expired' });
  });

  it('FR-ACC-03 ten simultaneous entries of the right code create exactly one account', async () => {
    const { d, body } = await start(browser());
    const code = codeFor(e164(d.phone as string));
    const answers = await Promise.all(
      Array.from({ length: 10 }, () => browser().post('/auth/register/verify', { registrationId: body.registrationId, code })),
    );
    expect(answers.map((a) => a.status).sort()).toEqual([204, ...Array(9).fill(410)]);
    expect(await userCount(e164(d.phone as string))).toBe(1);
  });

  it('SEC-AUTH-09 five wrong codes end the challenge, also for the right code afterwards', async () => {
    const b = browser();
    const { d, body } = await start(b);
    const code = codeFor(e164(d.phone as string));
    for (let i = 0; i < 5; i++) {
      expect(await problem(await b.post('/auth/register/verify', { registrationId: body.registrationId, code: wrong(code) }))).toMatchObject({
        status: 400, type: '/problems/otp-failed',
      });
    }
    expect((await problem(await b.post('/auth/register/verify', { registrationId: body.registrationId, code }))).type).toBe('/problems/otp-expired');
    const [ch] = await fx.query(`SELECT attempts FROM identity.otp_challenges WHERE pending_registration_id = $1`, [body.registrationId]);
    expect(ch.attempts).toBe(5);
  });

  it('SEC-AUTH-09 an expired code is refused', async () => {
    const b = browser();
    const { d, body } = await start(b);
    await fx.query(
      `UPDATE identity.otp_challenges SET created_at = now() - interval '10 minutes', expires_at = now() - interval '5 minutes'
       WHERE pending_registration_id = $1`,
      [body.registrationId],
    );
    const r = await problem(await b.post('/auth/register/verify', { registrationId: body.registrationId, code: codeFor(e164(d.phone as string)) }));
    expect(r.type).toBe('/problems/otp-expired');
  });

  it('SEC-AUTH-09 a resend waits for the resend time, replaces the code, and sends per number are limited (CP-05)', async () => {
    const b = browser();
    const { d, body } = await start(b);
    const phone = e164(d.phone as string);
    const first = codeFor(phone);
    const early = await b.post('/auth/register/resend', { registrationId: body.registrationId });
    expect(early.status).toBe(429);
    expect(Number(early.headers.get('retry-after'))).toBeGreaterThan(0);

    await redis.del(`otp:gap:${phone}`);
    expect((await browser().post('/auth/register/resend', { registrationId: body.registrationId })).status).toBe(202);
    const second = codeFor(phone);
    expect(sms(phone, 'otp_register')).toHaveLength(2);
    if (first !== second) {
      expect((await problem(await b.post('/auth/register/verify', { registrationId: body.registrationId, code: first }))).type).toBe('/problems/otp-failed');
    }
    await redis.del(`otp:gap:${phone}`);
    expect((await browser().post('/auth/register/resend', { registrationId: body.registrationId })).status).toBe(202);
    await redis.del(`otp:gap:${phone}`);
    const fourth = await browser().post('/auth/register/resend', { registrationId: body.registrationId });
    expect(fourth.status).toBe(429); // CP-05: 3 sends per number per hour
    expect(sms(phone, 'otp_register')).toHaveLength(3);
    expect((await b.post('/auth/register/verify', { registrationId: body.registrationId, code: codeFor(phone) })).status).toBe(204);
  });

  it('FR-ACC-02 the e-mail link verifies the address once', async () => {
    const b = browser();
    const { d, body } = await start(b);
    await b.post('/auth/register/verify', { registrationId: body.registrationId, code: codeFor(e164(d.phone as string)) });
    const mail = notes.sent.filter((m) => m.channel === 'email' && m.to === d.email && m.template === 'email_verify').at(-1)!;
    expect(mail.vars.link.startsWith(`${origin}/verify-email#token=`)).toBe(true);
    const token = mail.vars.link.split('#token=')[1];

    expect((await browser().post('/auth/email/verify', { token })).status).toBe(204);
    const [u] = await fx.query(`SELECT email_verified_at FROM identity.users WHERE phone_e164 = $1`, [e164(d.phone as string)]);
    expect(u.email_verified_at).toBeInstanceOf(Date);
    expect(await problem(await browser().post('/auth/email/verify', { token }))).toMatchObject({ status: 410, type: '/problems/link-invalid' });
    expect((await browser().post('/auth/email/verify', { token: 'A'.repeat(43) })).status).toBe(410);
  });
});
