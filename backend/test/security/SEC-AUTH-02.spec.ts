import { randomUUID } from 'crypto';
import { newLocal, problem, suite } from './setup';

// SEC-AUTH-02: new and changed passwords are checked against breached and common passwords and against context words
// (the site's name, the person's own name or number), and refused if found.
const s = suite();

describe('SEC-AUTH-02 password checks', () => {
  const register = (password: string, o: Record<string, unknown> = {}) =>
    s.browser().post('/auth/register', { email: `p-${randomUUID()}@tb.test`, displayName: 'Rafiq Uddin', password, ...o });

  it.each([
    ['a breached and common password', 'password1234567', 'common'],
    ['a common password in another letter case', 'PASSWORD1234567', 'common'],
    ['the site name', 'my trustbazaar account', 'context'],
    ["the person's own name", 'rafiq uddin forever', 'context'],
  ])('SEC-AUTH-02 registration refuses %s', async (_case, password, reason) => {
    expect(await problem(await register(password))).toMatchObject({ status: 422, type: '/problems/password-rejected', errors: [{ field: 'password', reason }] });
  });

  it("SEC-AUTH-02 registration refuses the person's own mobile number inside the password, at the step that asks for it", async () => {
    const phone = newLocal();
    const password = `call me on ${phone} now`;
    const email = `p-${randomUUID()}@tb.test`;
    const b = s.browser();
    const started = await (await b.post('/auth/register', { email, displayName: 'Rafiq Uddin', password })).json();
    const code = s.sent(email, 'otp_register_email').at(-1)!.vars.code;
    expect((await b.post('/auth/register/verify', { registrationId: started.registrationId, code })).status).toBe(204);
    expect(await problem(await b.post('/auth/register/complete', { registrationId: started.registrationId, phone, password, ...s.cfg.legal, adultConfirmed: true }))).toMatchObject({
      status: 422, errors: [{ field: 'password', reason: 'context' }],
    });
  });

  it('SEC-AUTH-02 a password reset refuses a common password too', async () => {
    const a = await s.fx.account();
    await s.browser().post('/auth/password/forgot', { login: a.email });
    const token = s.sent(a.email, 'password_reset').at(-1)!.vars.link.split('#token=')[1];
    expect(await problem(await s.browser().post('/auth/password/reset', { token, newPassword: 'qwertyuiop12345' }))).toMatchObject({ status: 422, errors: [{ field: 'newPassword', reason: 'common' }] });
    // the token was not spent by the refusal
    expect((await s.browser().post('/auth/password/reset', { token, newPassword: `fresh ${randomUUID()}` })).status).toBe(204);
  });
});
