import { loadConfig } from '../../src/kernel/config/config';
import { leadingZeroBits, powDigest, solvePow } from '../../src/modules/identity/security/human-check';
import { startApp, TestApp } from '../support/app';
import { Browser } from '../support/browser';
import { IdentityFixtures } from '../support/identity';

// U1-09, second part: the human-verification challenge (SEC-ABU-02, I-64) on the running backend. The browser
// helper here does not solve challenges by itself, so the 428s are seen.
describe('human verification', () => {
  let t: TestApp;
  let fx: IdentityFixtures;
  let origin: string;

  beforeAll(async () => {
    t = await startApp();
    fx = await IdentityFixtures.open();
    origin = loadConfig(process.env).publicOrigin;
  });
  afterAll(async () => {
    await fx?.close();
    await t?.close();
  });

  const browser = () => {
    const b = new Browser(t, origin);
    b.solveChallenges = false;
    return b;
  };
  const proofOf = (c: { id: string; prefix: string; difficulty: number }) => `${c.id}:${solvePow(c.prefix, c.difficulty)}`;

  it('SEC-ABU-02 an unusual rate of registrations from one address meets a proof-of-work the server checks itself', async () => {
    const b = browser();
    // the body is refused after the guards: these requests count without creating anything
    for (let i = 0; i < 2; i++) expect((await b.post('/auth/register', {})).status).toBe(400);
    const r = await b.post('/auth/register', {});
    expect(r.status).toBe(428);
    const body = await r.json();
    expect(body).toMatchObject({
      type: '/problems/human-verification-required', status: 428,
      challenge: { id: expect.stringMatching(/^[0-9a-f-]{36}$/), algorithm: 'sha256', prefix: expect.stringMatching(/^[0-9a-f]{32}$/), difficulty: 16, expiresAt: expect.any(String) },
    });
    const proof = proofOf(body.challenge);
    expect(leadingZeroBits(powDigest(body.challenge.prefix, proof.split(':')[1]))).toBeGreaterThanOrEqual(16);

    // a wrong nonce, or the proof from another address, is refused with a new challenge; a proof works once
    expect((await b.post('/auth/register', {}, { 'x-human-proof': `${body.challenge.id}:0x` })).status).toBe(428);
    const c2 = (await (await b.post('/auth/register', {})).json()).challenge;
    const other = browser();
    for (let i = 0; i < 2; i++) await other.post('/auth/register', {});
    expect((await other.post('/auth/register', {}, { 'x-human-proof': proofOf(c2) })).status).toBe(428);
  });

  it('SEC-ABU-02 a solved challenge lets the request through once', async () => {
    const b = browser();
    for (let i = 0; i < 2; i++) await b.post('/auth/register', {});
    const c = (await (await b.post('/auth/register', {})).json()).challenge;
    const proof = proofOf(c);
    expect((await b.post('/auth/register', {}, { 'x-human-proof': proof })).status).toBe(400); // past the guard
    expect((await b.post('/auth/register', {}, { 'x-human-proof': proof })).status).toBe(428); // used
  });

  it('SEC-ABU-02 after repeated failures for one account, a sign-in from any address needs the challenge', async () => {
    const a = await fx.account();
    for (let i = 0; i < 3; i++) expect((await browser().post('/auth/signin', { login: a.phone, password: 'wrong' })).status).toBe(401);
    const b = browser();
    const r = await b.post('/auth/signin', { login: a.phone, password: a.password });
    expect(r.status).toBe(428);
    const { challenge } = await r.json();
    expect((await b.post('/auth/signin', { login: a.phone, password: a.password }, { 'x-human-proof': proofOf(challenge) })).status).toBe(204);
    // the success cleared the failures: the next sign-in needs no challenge
    expect((await browser().post('/auth/signin', { login: a.phone, password: a.password })).status).toBe(204);
  });

  it('SEC-ABU-02 I-64 over both the address mark and the login failures, one solved challenge lets the sign-in through', async () => {
    const a = await fx.account();
    for (let i = 0; i < 3; i++) expect((await browser().post('/auth/signin', { login: a.phone, password: 'wrong' })).status).toBe(401);
    const b = browser();
    // ten sign-ins from this address reach its mark (more than 10 in 15 minutes asks for the challenge)
    for (let i = 0; i < 10; i++) expect((await b.post('/auth/signin', { login: `nobody-${i}@example.com`, password: 'wrong' })).status).toBe(401);
    const r = await b.post('/auth/signin', { login: a.phone, password: a.password });
    expect(r.status).toBe(428);
    const { challenge } = await r.json();
    // the guard accepts the proof, and the sign-in service does not ask for a second one the client could not give
    expect((await b.post('/auth/signin', { login: a.phone, password: a.password }, { 'x-human-proof': proofOf(challenge) })).status).toBe(204);
  });
});
