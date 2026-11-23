import { startApp } from '../support/app';
import { Browser } from '../support/browser';
import { suite } from './setup';

// SEC-ABU-03: rate-limit state is shared across backend instances (in Redis), so adding instances does not multiply
// the allowance. Two whole backends on one Redis share one address's counters.
const s = suite();

describe('SEC-ABU-03 shared rate-limit state', () => {
  it('SEC-ABU-03 requests from one address spread over two instances count against one limit', async () => {
    const second = await startApp();
    try {
      const one = s.browser();
      const two = new Browser(second, s.origin);
      Object.defineProperty(two, 'ip', { value: one.ip }); // the same client address, through either instance
      for (let i = 0; i < 60; i++) expect((await (i % 2 ? two : one).get('/search?q=lamp')).status).toBe(200);
      expect((await two.get('/search?q=lamp')).status).toBe(429);
      expect((await one.get('/search?q=lamp')).status).toBe(429);
    } finally {
      await second.close();
    }
  });

  it('SEC-ABU-03 the sign-in failures of one account are counted once, whichever instance takes them', async () => {
    const second = await startApp();
    try {
      const a = await s.fx.account();
      for (let i = 0; i < 5; i++) {
        const b = i % 2 ? new Browser(second, s.origin) : s.browser();
        expect((await b.post('/auth/signin', { login: a.phone, password: 'wrong' })).status).toBe(401);
      }
      // the sixth attempt waits (SEC-AUTH-04), on either instance
      expect((await new Browser(second, s.origin).post('/auth/signin', { login: a.phone, password: a.password })).status).toBe(429);
      expect((await s.browser().post('/auth/signin', { login: a.phone, password: a.password })).status).toBe(429);
    } finally {
      await second.close();
    }
  });
});
