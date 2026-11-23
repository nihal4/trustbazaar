import { randomUUID } from 'crypto';
import { problem, suite } from './setup';

// SEC-AUTH-10: reset tokens carry at least 128 random bits, work once, expire after CP-06 and are stored only as
// hashes; a successful reset ends every session of the user and notifies them.
const s = suite();
const tokenIn = (link: string) => link.split('#token=')[1];

describe('SEC-AUTH-10 password reset tokens', () => {
  async function linkFor(email: string) {
    await s.browser().post('/auth/password/forgot', { login: email });
    return tokenIn(s.sent(email, 'password_reset').at(-1)!.vars.link);
  }

  it('SEC-AUTH-10 the token has at least 128 bits and only its hash is stored', async () => {
    const a = await s.fx.account();
    const token = await linkFor(a.email);
    expect(Buffer.from(token, 'base64url').length * 8).toBeGreaterThanOrEqual(128);
    const rows = await s.fx.query<{ token_hash: Buffer }>(`SELECT token_hash FROM identity.one_time_tokens WHERE user_id = $1 AND purpose = 'password_reset'`, [a.userId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).toHaveLength(32); // a SHA-256 digest
    expect(rows[0].token_hash.equals(Buffer.from(token, 'base64url'))).toBe(false); // not the token itself
    // what a copy of the database holds does not work as a link
    for (const leaked of [rows[0].token_hash.toString('base64url'), rows[0].token_hash.toString('hex')]) {
      const r = await s.browser().post('/auth/password/reset', { token: leaked, newPassword: `stolen ${randomUUID()}` });
      expect([400, 422]).toContain(r.status); // refused, as an invalid link or as no token at all
    }
    const all = await s.fx.query(`SELECT * FROM identity.one_time_tokens WHERE user_id = $1`, [a.userId]);
    expect(JSON.stringify(all)).not.toContain(token);
  });

  it('SEC-AUTH-10 the token works once; a second use is refused', async () => {
    const a = await s.fx.account();
    const token = await linkFor(a.email);
    expect((await s.browser().post('/auth/password/reset', { token, newPassword: `first ${randomUUID()}` })).status).toBe(204);
    expect((await problem(await s.browser().post('/auth/password/reset', { token, newPassword: `second ${randomUUID()}` }))).type).toBe('/problems/link-invalid');
  });

  it('SEC-AUTH-10 an expired token is refused', async () => {
    const a = await s.fx.account();
    const token = await linkFor(a.email);
    await s.fx.query(`UPDATE identity.one_time_tokens SET expires_at = now() - interval '1 second' WHERE user_id = $1 AND purpose = 'password_reset'`, [a.userId]);
    expect((await problem(await s.browser().post('/auth/password/reset', { token, newPassword: `late ${randomUUID()}` }))).type).toBe('/problems/link-invalid');
  });

  it('SEC-AUTH-10 a successful reset ends every session of the user and notifies them', async () => {
    const { a, b } = await s.signedIn();
    const other = s.browser();
    expect((await other.post('/auth/signin', { login: a.phone, password: a.password })).status).toBe(204);
    const token = await linkFor(a.email);
    expect((await s.browser().post('/auth/password/reset', { token, newPassword: `after ${randomUUID()}` })).status).toBe(204);
    expect((await b.get('/auth/sessions')).status).toBe(401);
    expect((await other.get('/auth/sessions')).status).toBe(401);
    const [ev] = await s.fx.query(`SELECT payload FROM identity.outbox WHERE aggregate_id = $1 AND event_type = 'identity.password.changed'`, [a.userId]);
    expect(ev.payload).toEqual({ userId: a.userId, via: 'reset' }); // FR-NTF-06 tells the user from this event
  });
});
