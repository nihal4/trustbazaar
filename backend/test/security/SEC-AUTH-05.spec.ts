import { randomUUID } from 'crypto';
import { newLocal, problem, suite } from './setup';

// SEC-AUTH-05: sign-in, registration and password-reset answers do not tell whether a number or e-mail is
// registered, and their times do not differ measurably either.
const s = suite();

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
async function timed(f: () => Promise<Response>): Promise<{ ms: number; r: Response }> {
  const t0 = performance.now();
  const r = await f();
  return { ms: performance.now() - t0, r };
}

describe('SEC-AUTH-05 no account enumeration', () => {
  it('SEC-AUTH-05 sign-in: a registered number with a wrong password and an unknown number get the same answer, in about the same time', async () => {
    const known: number[] = [];
    const unknown: number[] = [];
    let a = await s.fx.account();
    for (let i = 0; i < 8; i++) {
      if (i === 4) a = await s.fx.account(); // stay under the per-account delay of SEC-AUTH-04
      const k = await timed(() => s.browser().post('/auth/signin', { login: a.phone, password: 'not the password' }));
      const u = await timed(() => s.browser().post('/auth/signin', { login: newLocal(), password: 'not the password' }));
      expect(await problem(k.r)).toEqual(await problem(u.r));
      known.push(k.ms);
      unknown.push(u.ms);
    }
    // both pay the same Argon2id work: the medians stay within a quarter of each other (or 40 ms)
    const [mk, mu] = [median(known), median(unknown)];
    expect(Math.abs(mk - mu)).toBeLessThan(Math.max(40, 0.25 * Math.max(mk, mu)));
  });

  it('SEC-AUTH-05 password reset: a known and an unknown login get the same answer', async () => {
    const a = await s.fx.account();
    const answers: { status: number; body: string }[] = [];
    for (const login of [a.phone, a.email, newLocal(), `nobody-${randomUUID()}@tb.test`]) {
      const r = await s.browser().post('/auth/password/forgot', { login });
      answers.push({ status: r.status, body: await r.text() });
    }
    for (const x of answers) expect(x).toEqual(answers[0]);
  });

  it('SEC-AUTH-05 registration: a taken and a free number get the same first answer', async () => {
    const owner = await s.fx.account();
    const start = (phone: string) =>
      s.browser().post('/auth/register', { phone, email: `e-${randomUUID()}@tb.test`, displayName: 'Mitu Das', password: 'bright kites above the river', ...s.cfg.legal, adultConfirmed: true });
    const taken = await start(owner.local);
    const free = await start(newLocal());
    expect(taken.status).toBe(free.status);
    expect(Object.keys(await taken.json()).sort()).toEqual(Object.keys(await free.json()).sort());
  });
});
