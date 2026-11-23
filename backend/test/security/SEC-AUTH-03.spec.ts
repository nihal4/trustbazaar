import { randomUUID } from 'crypto';
import { suite } from './setup';

// SEC-AUTH-03: passwords are stored only as salted Argon2id hashes, with at least 19 MiB, 2 iterations, parallelism 1;
// not bcrypt, which ignores input beyond 72 bytes (a Bangla passphrase reaches that quickly).
const s = suite();

describe('SEC-AUTH-03 password storage', () => {
  const hashOf = async (userId: string) =>
    (await s.fx.query<{ password_hash: string }>('SELECT password_hash FROM identity.users WHERE id = $1', [userId]))[0].password_hash;

  it('SEC-AUTH-03 a password set through the API is stored as Argon2id with the OWASP parameters, salted', async () => {
    const { a, b } = await s.signedIn();
    const fresh = `new passphrase ${randomUUID()}`;
    await s.browser().post('/auth/password/forgot', { login: a.email });
    const token = s.sent(a.email, 'password_reset').at(-1)!.vars.link.split('#token=')[1];
    expect((await b.post('/auth/password/reset', { token, newPassword: fresh })).status).toBe(204);
    const hash = await hashOf(a.userId);
    const m = /^\$argon2id\$v=19\$([a-z=0-9,]+)\$([A-Za-z0-9+/]+)\$[A-Za-z0-9+/]+$/.exec(hash);
    expect(m).not.toBeNull();
    const params = Object.fromEntries(m![1].split(',').map((kv) => kv.split('=')).map(([k, v]) => [k, Number(v)]));
    expect(params.m).toBeGreaterThanOrEqual(19 * 1024);
    expect(params.t).toBeGreaterThanOrEqual(2);
    expect(params.p).toBe(1);
    expect(Buffer.from(m![2], 'base64').length).toBeGreaterThanOrEqual(16); // the salt
    expect(hash).not.toContain(fresh);
  });

  it('SEC-AUTH-03 the same password gives different hashes for two accounts (a salt each)', async () => {
    const password = `shared ${randomUUID()}`;
    const one = await s.fx.account({ password });
    const two = await s.fx.account({ password });
    await s.browser().post('/auth/signin', { login: one.phone, password });
    expect(await hashOf(one.userId)).not.toBe(await hashOf(two.userId));
  });

  it('SEC-AUTH-03 a Bangla passphrase longer than 72 bytes is checked in full', async () => {
    const long = 'আমার সোনার বাংলা আমি তোমায় ভালোবাসি চিরদিন তোমার আকাশ'; // well over 72 bytes in UTF-8
    expect(Buffer.byteLength(long)).toBeGreaterThan(72);
    const a = await s.fx.account({ password: `${long} এক` });
    expect((await s.browser().post('/auth/signin', { login: a.phone, password: `${long} দুই` })).status).toBe(401); // differs after byte 72
    expect((await s.browser().post('/auth/signin', { login: a.phone, password: `${long} এক` })).status).toBe(204);
  });
});
