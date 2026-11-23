import { loadConfig } from '../../src/kernel/config/config';
import { useTestSecrets } from '../support/env';
import { suite } from './setup';

// SEC-WEB-03: cross-origin requests to the API are allowed only from the configured web-client origins.
const s = suite();
useTestSecrets();
const ORIGIN = loadConfig(process.env).publicOrigin; // known before the tests are listed

describe('SEC-WEB-03 CORS', () => {
  const preflight = (origin: string) =>
    fetch(s.t.url('/auth/signin'), { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,x-csrf-token' } });

  it('SEC-WEB-03 the web client\'s origin is allowed, with credentials', async () => {
    const r = await preflight(s.origin);
    expect(r.headers.get('access-control-allow-origin')).toBe(s.origin);
    expect(r.headers.get('access-control-allow-credentials')).toBe('true');
  });

  it.each(['https://evil.example', 'null', `${ORIGIN}.evil.example`, ORIGIN.replace('://', '://evil.')])('SEC-WEB-03 another origin (%s) is not allowed', async (origin) => {
    const r = await preflight(origin);
    expect(r.headers.get('access-control-allow-origin')).toBeNull();
    const get = await fetch(s.t.url('/categories'), { headers: { origin } });
    expect(get.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('SEC-WEB-03 a signed-in member\'s cookies sent from another origin change nothing', async () => {
    const { b } = await s.signedIn();
    const r = await b.post('/auth/signout', {}, { origin: 'https://evil.example' });
    expect(r.status).toBe(403);
    expect((await b.get('/me')).status).toBe(200);
  });
});
