import { randomUUID } from 'crypto';
import { Logger } from '@nestjs/common';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { JsonLogger } from '../../src/kernel/logging/json-logger';
import { submitKyc, suite } from './setup';

// SEC-DAT-07: passwords, OTPs, tokens, NID numbers, payout account numbers and game-account ciphertext never appear in
// logs, error messages, analytics or URLs; phone numbers and e-mail addresses in logs are masked.
const s = suite();
const lines: string[] = [];

beforeAll(() => {
  s.t.app.useLogger(new JsonLogger('debug', (l) => lines.push(l)));
});

describe('SEC-DAT-07 no secrets in logs, errors or URLs', () => {
  it('SEC-DAT-07 sign-in, registration, reset and KYC, with their secrets, leave none of them in the log', async () => {
    const password = `Secret-Pass-${randomUUID()}`;
    const a = await s.fx.account({ password });
    await s.browser().post('/auth/signin', { login: a.phone, password: `${password}-wrong` });
    await s.browser().post('/auth/signin', { login: a.phone, password });
    const regEmail = `log-${randomUUID()}@tb.test`;
    await s.browser().post('/auth/register', { email: regEmail, displayName: 'Log Person', password });
    const otp = s.sent(regEmail, 'otp_register_email').at(-1)?.vars.code;
    await s.browser().post('/auth/password/forgot', { login: a.email });
    const token = s.sent(a.email, 'password_reset').at(-1)!.vars.link.split('#token=')[1];
    const member = await s.signedIn({ kyc: 'unsubmitted' });
    const { docNumber } = await submitKyc(member.b);
    // and a service logging something careless is redacted too
    new Logger('Careless').warn({
      msg: 'oops',
      password,
      otp,
      token,
      nid: docNumber,
      accountNumber: '01711999888',
      ciphertext: 'c'.repeat(40),
      phone: a.phone,
      email: a.email,
    });

    const log = lines.join('\n');
    expect(lines.length).toBeGreaterThan(0);
    for (const secret of [password, token, docNumber, '01711999888', 'c'.repeat(40), ...(otp ? [otp] : [])]) expect(log).not.toContain(secret);
    expect(log).not.toContain(a.phone);
    expect(log.toLowerCase()).not.toContain(a.email.toLowerCase());
    expect(log).toContain('[redacted]');
  });

  it('SEC-DAT-07 an error never repeats the secret it was sent', async () => {
    const weak = 'password1234567';
    const r = await s.browser().post('/auth/register', { email: `e-${randomUUID()}@tb.test`, displayName: 'Err Person', password: weak });
    expect(r.status).toBe(422);
    expect(await r.text()).not.toContain(weak);
    const bad = await s.browser().post('/auth/password/reset', { token: 'Z'.repeat(43), newPassword: `x ${randomUUID()}` });
    expect(await bad.text()).not.toContain('Z'.repeat(43));
  });

  it('SEC-DAT-07 links put tokens after #, never in a query a server or proxy would log', async () => {
    const a = await s.fx.account();
    await s.browser().post('/auth/password/forgot', { login: a.email });
    const link = s.sent(a.email, 'password_reset').at(-1)!.vars.link;
    expect(link).toMatch(/#token=/);
    expect(new URL(link).search).toBe('');
    const root = join(__dirname, '..', '..', 'src');
    const walk = (d: string): string[] =>
      readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : n.endsWith('.ts') && !n.endsWith('.spec.ts') ? [join(d, n)] : []));
    const inQuery = walk(root).filter((f) => /[?&](token|code|otp|password|nid)=/.test(readFileSync(f, 'utf8')));
    expect(inQuery).toEqual([]);
  });
});
