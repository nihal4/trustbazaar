import { leadingZeroBits, powDigest, solvePow } from '../../src/modules/identity/security/human-check';
import { newLocal, problem, suite } from './setup';

// SEC-ABU-02 (I-64): after repeated failures or unusual rates on registration, sign-in and OTP requests, the server
// answers 428 with a proof-of-work challenge it issues and checks itself; a solved challenge works once.
const s = suite();
const asIs = () => {
  const b = s.browser();
  b.solveChallenges = false;
  return b;
};
type Challenge = { id: string; algorithm: string; prefix: string; difficulty: number; expiresAt: string };

describe('SEC-ABU-02 human verification', () => {
  it('SEC-ABU-02 an unusual sign-in rate from one address meets the challenge; a solved one lets the request through, once', async () => {
    const a = await s.fx.account();
    const b = asIs();
    for (let i = 0; i < 10; i++) expect((await b.post('/auth/signin', { login: newLocal(), password: 'wrong' })).status).toBe(401);
    const r = await b.post('/auth/signin', { login: a.phone, password: a.password });
    expect(await problem(r.clone())).toMatchObject({ status: 428, type: '/problems/human-verification-required' });
    const { challenge } = (await r.json()) as { challenge: Challenge };
    expect(challenge).toMatchObject({ algorithm: 'sha256', difficulty: expect.any(Number) });
    const proof = `${challenge.id}:${solvePow(challenge.prefix, challenge.difficulty)}`;
    expect((await b.post('/auth/signin', { login: a.phone, password: a.password }, { 'x-human-proof': proof })).status).toBe(204);
    // the same proof again is not accepted
    expect((await b.post('/auth/signin', { login: a.phone, password: a.password }, { 'x-human-proof': proof })).status).toBe(428);
  });

  it('SEC-ABU-02 repeated failures on one login meet the challenge from any address', async () => {
    const a = await s.fx.account();
    for (let i = 0; i < 3; i++) expect((await asIs().post('/auth/signin', { login: a.phone, password: 'wrong' })).status).toBe(401);
    expect((await asIs().post('/auth/signin', { login: a.phone, password: a.password })).status).toBe(428);
  });

  it('SEC-ABU-02 registration and OTP requests meet it too; a wrong nonce is refused', async () => {
    const b = asIs();
    const start = () => b.post('/auth/register', { email: `r-${Date.now()}-${Math.random()}@tb.test`, displayName: 'Rina Akter', password: 'river lamps over the old bridge' });
    expect((await start()).status).toBe(202);
    expect((await start()).status).toBe(202);
    const r = await start();
    expect(r.status).toBe(428);
    const { challenge } = (await r.json()) as { challenge: Challenge };
    let bad = 0;
    while (leadingZeroBits(powDigest(challenge.prefix, String(bad))) >= challenge.difficulty) bad++;
    expect((await b.post('/auth/register', {}, { 'x-human-proof': `${challenge.id}:${bad}` })).status).toBe(428);
  });
});
