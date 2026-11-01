import { randomInt } from 'crypto';
import { startApp, TestApp } from '../support/app';
import { IdentityFixtures } from '../support/identity';

// U1-13: GET /me, the signed-in user's own account and the web client's refresh probe (I-51 (c);
// docs/design/08_frontend.pdf section 5), over HTTP through the real security pipeline.
describe('GET /me', () => {
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

  const ip = () => `203.0.113.${randomInt(1, 255)}, 10.9.${randomInt(0, 255)}.${randomInt(1, 255)}`;
  const me = (headers: Record<string, string> = {}) => fetch(t.url('/me'), { headers: { 'x-forwarded-for': ip(), ...headers } });

  it('IF-UI-01 answers the signed-in user\'s own account, with the number masked', async () => {
    const userId = await fx.user({ kyc: 'verified', emailVerified: true });
    const sid = await fx.session({ userId });
    const r = await me(fx.headers(sid, userId, 'user'));
    expect(r.status).toBe(200);
    const body = await r.json();
    const [u] = await fx.query<{ phone_e164: string; email: string }>(`SELECT phone_e164, email FROM identity.users WHERE id = $1`, [userId]);
    expect(body).toEqual({
      id: userId, displayName: 'Test user', phoneMasked: `***${u.phone_e164.slice(-3)}`, email: u.email,
      emailVerified: true, kycStatus: 'verified', accountStatus: 'active', mfaEnabled: false,
    });
    expect(JSON.stringify(body)).not.toContain(u.phone_e164); // SEC-DAT-07
  });

  it('SEC-SES-03 is the refresh probe: 401 without a valid session, and not rate-limited for a few calls a minute', async () => {
    expect((await me()).status).toBe(401);
    const userId = await fx.user();
    const expired = await fx.session({ userId }, { idleSeconds: -60 });
    expect((await me(fx.headers(expired, userId, 'user'))).status).toBe(401);
    const ended = await fx.session({ userId }, { ended: true });
    expect((await me(fx.headers(ended, userId, 'user'))).status).toBe(401);
    const sid = await fx.session({ userId });
    const h = fx.headers(sid, userId, 'user');
    const statuses = await Promise.all(Array.from({ length: 30 }, () => fetch(t.url('/me'), { headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1', ...h } }).then((r) => r.status)));
    expect(new Set(statuses)).toEqual(new Set([200]));
  });

  it('SEC-SDL-09 a staff session cannot use it; staff have GET /staff/me', async () => {
    const staffId = await fx.staff('operator');
    const sid = await fx.session({ staffId });
    const r = await me(fx.headers(sid, staffId, 'staff')); // staff cookies are not a user session (I-51 (a))
    expect([r.status, (await r.json()).type]).toEqual([401, '/problems/session-ended']);
  });
});
