import { sign } from 'jsonwebtoken';
import { CONFIG_PORT, type ConfigPort } from '../../src/kernel/config-port';
import { suite } from './setup';

// SEC-SES-01: access tokens are short-lived (CP-01) and signed with an algorithm fixed on the server; tokens with
// alg=none or an unexpected algorithm are refused.
const s = suite();
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');

describe('SEC-SES-01 access tokens', () => {
  async function session() {
    const { a, b } = await s.signedIn();
    const token = b.cookies.get('__Host-tb_at')!;
    const [h, p] = token.split('.').slice(0, 2).map((x) => JSON.parse(Buffer.from(x, 'base64url').toString()));
    return { a, b, token, header: h as { alg: string; kid: string }, payload: p as { sub: string; sid: string; pt: string; iat: number; exp: number } };
  }
  const withToken = (token: string) => {
    const b = s.browser();
    b.cookies.set('__Host-tb_at', token);
    return b;
  };

  it('SEC-SES-01 the token is HS256, and lives no longer than CP-01', async () => {
    const { header, payload, b } = await session();
    expect(header.alg).toBe('HS256');
    const cp01 = (await s.t.app.get<ConfigPort>(CONFIG_PORT).current()).ms('CP-01', 'access') / 1000; // 15 minutes as shipped
    expect(cp01).toBeLessThanOrEqual(15 * 60);
    expect(payload.exp - payload.iat).toBe(cp01);
    expect((await b.get('/auth/sessions')).status).toBe(200);
  });

  it('SEC-SES-01 the same claims with alg=none are refused', async () => {
    const { header, payload } = await session();
    const none = `${b64({ ...header, alg: 'none' })}.${b64(payload)}.`;
    expect((await withToken(none).get('/auth/sessions')).status).toBe(401);
  });

  it('SEC-SES-01 the same claims signed with the real key under another algorithm (HS512) are refused', async () => {
    const { header, payload } = await session();
    const keys = s.cfg.keys.jwt;
    const key = keys.key(keys.current)!.reveal();
    const hs512 = sign(payload, key, { algorithm: 'HS512', keyid: header.kid });
    expect((await withToken(hs512).get('/auth/sessions')).status).toBe(401);
  });

  it('SEC-SES-01 a token signed with another key, or with its payload changed, is refused', async () => {
    const { token, header, payload } = await session();
    const other = sign(payload, 'not-the-server-key-0123456789abcdef', { algorithm: 'HS256', keyid: header.kid });
    expect((await withToken(other).get('/auth/sessions')).status).toBe(401);
    const [h, , sig] = token.split('.');
    const longer = `${h}.${b64({ ...payload, exp: payload.exp + 86400 })}.${sig}`;
    expect((await withToken(longer).get('/auth/sessions')).status).toBe(401);
  });

  it('SEC-SES-01 an expired token is refused even though its signature is good', async () => {
    const { header, payload } = await session();
    const keys = s.cfg.keys.jwt;
    const past = Math.floor(Date.now() / 1000) - 3600;
    const expired = sign({ ...payload, iat: past - 60, exp: past }, keys.key(keys.current)!.reveal(), { algorithm: 'HS256', keyid: header.kid });
    expect((await withToken(expired).get('/auth/sessions')).status).toBe(401);
  });
});
