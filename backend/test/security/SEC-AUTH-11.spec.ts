import { randomUUID } from 'crypto';
import type { Browser } from '../support/browser';
import { suite } from './setup';

// SEC-AUTH-11: changing a password ends every other session of that user (and keeps the one that changed it).
const s = suite();

describe('SEC-AUTH-11 password change ends other sessions', () => {
  async function stepUp(b: Browser, phone: string): Promise<string> {
    await s.fx.clearSendGap(phone);
    await b.post('/auth/step-up/start', { action: 'password.change' });
    const code = s.sent(phone, 'otp_step_up').at(-1)!.vars.code;
    return ((await (await b.post('/auth/step-up/verify', { action: 'password.change', code })).json()) as { grant: string }).grant;
  }

  it("SEC-AUTH-11 the session that changes the password stays; the user's two other sessions end", async () => {
    const { a, b } = await s.signedIn();
    const phone = s.browser();
    const laptop = s.browser();
    for (const x of [phone, laptop]) expect((await x.post('/auth/signin', { login: a.phone, password: a.password })).status).toBe(204);
    const grant = await stepUp(b, a.phone);
    const r = await b.post('/auth/password/change', { currentPassword: a.password, newPassword: `changed ${randomUUID()}` }, { 'x-step-up': grant });
    expect(r.status).toBe(204);
    expect((await b.get('/auth/sessions')).status).toBe(200);
    expect((await phone.get('/auth/sessions')).status).toBe(401);
    expect((await laptop.get('/auth/sessions')).status).toBe(401);
    // their refresh tokens cannot bring them back
    expect((await phone.post('/auth/refresh')).status).toBe(401);
    const live = await s.fx.query<{ n: number }>(`SELECT count(*)::int AS n FROM identity.sessions WHERE user_id = $1 AND ended_at IS NULL`, [a.userId]);
    expect(live[0].n).toBe(1);
  });
});
