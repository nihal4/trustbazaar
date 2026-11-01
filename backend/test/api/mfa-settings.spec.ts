import { randomInt } from 'crypto';
import { authenticator } from 'otplib';
import { startApp, TestApp } from '../support/app';
import { IdentityFixtures } from '../support/identity';

// U1-12: MFA settings (Unit 1 sections 4.2 and 6.5; FR-ACC-06, SEC-AUTH-01), over HTTP through the real
// security pipeline against PostgreSQL and Redis.
const at = (secret: string, offsetSeconds = 0) => authenticator.clone({ epoch: Date.now() + offsetSeconds * 1000 }).generate(secret);
const secretOf = (uri: string) => new URL(uri).searchParams.get('secret')!;

describe('MFA settings', () => {
  let t: TestApp;
  let fx: IdentityFixtures;

  beforeAll(async () => {
    t = await startApp();
    fx = await IdentityFixtures.open();
  });
  afterAll(async () => {
    await fx?.close();
    await t?.close();
  });

  async function signedIn(o: { mfa?: boolean } = {}) {
    const a = await fx.account(o);
    const sid = await fx.session({ userId: a.userId });
    const ip = `198.51.100.${randomInt(1, 255)}, 10.6.${randomInt(0, 255)}.${randomInt(1, 255)}`;
    const call = (method: string, path: string, body?: unknown, extra: Record<string, string> = {}) =>
      fetch(t.url(path), {
        method,
        headers: { ...fx.headers(sid, a.userId, 'user'), 'x-forwarded-for': ip, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...extra },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const grant = async (action: string) => ({ 'x-step-up': await fx.stepUpGrant(sid, action) });
    return { ...a, sid, call, grant };
  }
  const user = (id: string) => fx.query<{ mfa_enabled: boolean; password_single_factor_ok: boolean }>(`SELECT mfa_enabled, password_single_factor_ok FROM identity.users WHERE id = $1`, [id]).then((r) => r[0]);
  const events = (id: string) => fx.query<{ event_type: string }>(`SELECT event_type FROM identity.outbox WHERE aggregate_id = $1 AND event_type LIKE 'identity.mfa.%' ORDER BY created_at`, [id]).then((r) => r.map((e) => e.event_type));

  it('FR-ACC-06 enrolment: a QR secret, confirmed by its first code, turns MFA on with ten recovery codes shown once', async () => {
    const a = await signedIn();
    const first = await (await a.call('POST', '/me/mfa/totp')).json();
    const r = await a.call('POST', '/me/mfa/totp');
    expect(r.status).toBe(201);
    const { otpauthUri, secret } = await r.json();
    expect(otpauthUri).toMatch(/^otpauth:\/\/totp\/TrustBazaar:/);
    expect(secretOf(otpauthUri)).toBe(secret);
    expect(secret).not.toBe(first.secret);
    expect(Buffer.from(secret.replace(/=+$/, ''), 'utf8').length).toBeGreaterThanOrEqual(32); // 160 bits in base32
    expect((await a.call('POST', '/me/mfa/totp/confirm', { code: at(first.secret) })).status).toBe(400); // the replaced secret is gone
    const c = await a.call('POST', '/me/mfa/totp/confirm', { code: at(secret) });
    expect(c.status).toBe(200);
    const { recoveryCodes } = await c.json();
    expect(recoveryCodes).toHaveLength(10);
    expect(new Set(recoveryCodes).size).toBe(10);
    for (const code of recoveryCodes) expect(code).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
    expect(await user(a.userId)).toMatchObject({ mfa_enabled: true });
    const stored = await fx.query<{ code_hash: Buffer }>(
      `SELECT r.code_hash FROM identity.recovery_codes r JOIN identity.totp_factors f ON f.id = r.totp_factor_id WHERE f.user_id = $1 AND f.removed_at IS NULL`, [a.userId],
    );
    expect(stored).toHaveLength(10);
    expect(stored.map((s) => s.code_hash.toString('latin1')).join()).not.toContain(recoveryCodes[0]); // hashed
    expect(await events(a.userId)).toEqual(['identity.mfa.enabled']);
    expect((await a.call('POST', '/me/mfa/totp')).status).toBe(409); // already on
    expect((await a.call('POST', '/me/mfa/totp/confirm', { code: at(secret, 30) })).status).toBe(409);
  });

  it('FR-ACC-06 a wrong code does not confirm; confirming before starting is refused', async () => {
    const a = await signedIn();
    expect((await a.call('POST', '/me/mfa/totp/confirm', { code: '123456' })).status).toBe(409);
    await a.call('POST', '/me/mfa/totp');
    const wrong = await a.call('POST', '/me/mfa/totp/confirm', { code: '000000' });
    // 400, not 401: the client reads every 401 as an ended session and would refresh, resend and sign out
    expect([wrong.status, (await wrong.json()).type]).toEqual([400, '/problems/otp-failed']);
    expect((await a.call('GET', '/me')).status).toBe(200); // the session is untouched
    expect((await a.call('POST', '/me/mfa/totp/confirm', { code: 'abc' })).status).toBe(400);
    expect(await user(a.userId)).toMatchObject({ mfa_enabled: false });
  });

  it('SEC-AUTH-01 turning MFA off needs step-up and a current TOTP code (not a recovery code)', async () => {
    const a = await signedIn({ mfa: true });
    expect((await a.call('DELETE', '/me/mfa/totp', { code: at(a.totpSecret!) })).status).toBe(403); // no step-up
    expect((await a.call('DELETE', '/me/mfa/totp', { code: a.recoveryCodes[0] }, await a.grant('mfa.disable'))).status).toBe(400);
    expect((await a.call('DELETE', '/me/mfa/totp', { code: '000000' }, await a.grant('mfa.disable'))).status).toBe(400);
    const r = await a.call('DELETE', '/me/mfa/totp', { code: at(a.totpSecret!) }, await a.grant('mfa.disable'));
    expect(r.status).toBe(204);
    expect(await user(a.userId)).toMatchObject({ mfa_enabled: false });
    expect(await fx.query(`SELECT count(*)::int AS n FROM identity.totp_factors WHERE user_id = $1 AND removed_at IS NULL`, [a.userId])).toEqual([{ n: 0 }]);
    expect(await events(a.userId)).toEqual(['identity.mfa.disabled']);
    expect((await a.call('DELETE', '/me/mfa/totp', { code: at(a.totpSecret!, 30) }, await a.grant('mfa.disable'))).status).toBe(409); // already off
  });

  it('SEC-AUTH-01 with a short password, turning MFA off also sets a 15-character password and ends other sessions', async () => {
    const a = await signedIn({ mfa: true });
    await fx.query(`UPDATE identity.users SET password_single_factor_ok = false WHERE id = $1`, [a.userId]);
    const other = await fx.session({ userId: a.userId });
    const missing = await a.call('DELETE', '/me/mfa/totp', { code: at(a.totpSecret!) }, await a.grant('mfa.disable'));
    expect([missing.status, (await missing.json()).errors]).toEqual([422, [{ field: 'newPassword', reason: 'required-without-mfa' }]]);
    const short = await a.call('DELETE', '/me/mfa/totp', { code: at(a.totpSecret!), newPassword: 'short pass 12' }, await a.grant('mfa.disable'));
    expect([short.status, (await short.json()).errors]).toEqual([422, [{ field: 'newPassword', reason: 'too-short' }]]);
    expect(await user(a.userId)).toMatchObject({ mfa_enabled: true }); // nothing changed
    const ok = await a.call('DELETE', '/me/mfa/totp', { code: at(a.totpSecret!), newPassword: 'a quiet walk by the old river' }, await a.grant('mfa.disable'));
    expect(ok.status).toBe(204);
    expect(await user(a.userId)).toEqual({ mfa_enabled: false, password_single_factor_ok: true });
    expect(await fx.query(`SELECT end_reason FROM identity.sessions WHERE id = $1`, [other])).toEqual([{ end_reason: 'password_changed' }]);
    expect((await a.call('GET', '/me')).status).toBe(200); // this session stays
  });

  it('FR-ACC-06 regenerating recovery codes needs step-up; the old codes stop working', async () => {
    const a = await signedIn({ mfa: true });
    expect((await a.call('POST', '/me/mfa/recovery-codes')).status).toBe(403);
    const r = await a.call('POST', '/me/mfa/recovery-codes', undefined, await a.grant('recovery.regenerate'));
    expect(r.status).toBe(200);
    const { recoveryCodes } = await r.json();
    expect(recoveryCodes).toHaveLength(10);
    const unused = await fx.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM identity.recovery_codes r JOIN identity.totp_factors f ON f.id = r.totp_factor_id WHERE f.user_id = $1 AND r.used_at IS NULL`, [a.userId],
    );
    expect(unused).toEqual([{ n: 10 }]); // the fixture's three are used up
    const off = await signedIn();
    expect((await off.call('POST', '/me/mfa/recovery-codes', undefined, await off.grant('recovery.regenerate'))).status).toBe(409);
  });

  it('SEC-SDL-09 no session, an expired session or a staff session cannot change MFA', async () => {
    expect((await fetch(t.url('/me/mfa/totp'), { method: 'POST' })).status).toBe(401);
    const a = await fx.account();
    const expired = await fx.session({ userId: a.userId }, { idleSeconds: -60 });
    expect((await fetch(t.url('/me/mfa/totp'), { method: 'POST', headers: fx.headers(expired, a.userId, 'user') })).status).toBe(401);
    const staffId = await fx.staff('operator');
    const sid = await fx.session({ staffId });
    expect((await fetch(t.url('/me/mfa/totp'), { method: 'POST', headers: fx.headers(sid, staffId, 'staff') })).status).toBe(401);
  });
});
