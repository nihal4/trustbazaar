import { newLocal, suite } from './setup';

// SEC-AUTH-04: after CP-04 failed sign-ins for one account, further attempts are delayed progressively; attempts per
// source address are limited as well; the owner is notified; and the throttling does not lock the owner out.
const s = suite();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('SEC-AUTH-04 sign-in throttling', () => {
  it('SEC-AUTH-04 after five failures the next attempt waits, and the wait grows', async () => {
    const a = await s.fx.account();
    for (let i = 0; i < 5; i++) expect((await s.browser().post('/auth/signin', { login: a.phone, password: 'wrong' })).status).toBe(401);
    const first = await s.browser().post('/auth/signin', { login: a.phone, password: a.password });
    expect(first.status).toBe(429);
    const wait = Number(first.headers.get('retry-after'));
    expect(wait).toBeGreaterThan(0);
    await sleep(wait * 1000 + 100);
    expect((await s.browser().post('/auth/signin', { login: a.phone, password: 'wrong' })).status).toBe(401);
    const second = await s.browser().post('/auth/signin', { login: a.phone, password: a.password });
    expect(Number(second.headers.get('retry-after'))).toBeGreaterThan(wait);
  });

  it('SEC-AUTH-04 the owner is notified, and is not locked out: once the wait passes the right password signs in', async () => {
    const a = await s.fx.account();
    for (let i = 0; i < 5; i++) await s.browser().post('/auth/signin', { login: a.phone, password: 'wrong' });
    const r = await s.browser().post('/auth/signin', { login: a.phone, password: a.password });
    expect(r.status).toBe(429);
    expect(s.sent(a.phone, 'signin_throttled')).toHaveLength(1);
    await sleep(Number(r.headers.get('retry-after')) * 1000 + 100);
    expect((await s.browser().post('/auth/signin', { login: a.phone, password: a.password })).status).toBe(204);
  });

  it('SEC-AUTH-04 one address trying many accounts is limited too: 50 attempts in 15 minutes, then 429', async () => {
    const b = s.browser();
    b.solveChallenges = false; // past 10 the address meets the human check (SEC-ABU-02); the attempts still count
    const statuses: number[] = [];
    for (let i = 0; i < 51; i++) statuses.push((await b.post('/auth/signin', { login: newLocal(), password: 'wrong' })).status);
    expect(statuses.slice(0, 10).every((x) => x === 401)).toBe(true);
    expect(statuses.slice(10, 50).every((x) => x === 428)).toBe(true);
    expect(statuses[50]).toBe(429);
  });
});
