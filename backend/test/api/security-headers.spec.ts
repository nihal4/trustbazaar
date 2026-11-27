import { config } from '../../src/kernel/config/config';
import { startApp, TestApp } from '../support/app';

// U1-11: the running backend's security headers and CORS allow-list (DC-11; SEC-WEB-01 to SEC-WEB-03).
describe('security headers and CORS', () => {
  let t: TestApp;
  let web: string;

  beforeAll(async () => {
    t = await startApp();
    web = config().publicOrigin;
  });
  afterAll(async () => {
    await t?.close();
  });

  it('SEC-WEB-01 SEC-WEB-02 every API response, an error included, has the headers', async () => {
    for (const path of ['/health/live', '/no-such-route']) {
      const h = (await fetch(t.url(path))).headers;
      expect(h.get('content-security-policy')).toBe("default-src 'none';frame-ancestors 'none';base-uri 'none';form-action 'none'");
      expect(h.get('x-content-type-options')).toBe('nosniff');
      expect(h.get('referrer-policy')).toBe('no-referrer');
      expect(h.get('permissions-policy')).toContain('camera=(), ');
      expect(h.get('x-powered-by')).toBeNull();
      expect(h.get('x-correlation-id')).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it("SEC-WEB-03 only the web client's origin may read API responses across origins, with credentials", async () => {
    const ok = await fetch(t.url('/health/live'), { headers: { origin: web } });
    expect(ok.headers.get('access-control-allow-origin')).toBe(web);
    expect(ok.headers.get('access-control-allow-credentials')).toBe('true');
    expect(ok.headers.get('access-control-expose-headers')).toContain('X-Correlation-Id');

    const evil = await fetch(t.url('/health/live'), { headers: { origin: 'https://evil.example' } });
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();

    const pre = (origin: string) =>
      fetch(t.url('/orders'), {
        method: 'OPTIONS',
        headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,idempotency-key' },
      });
    const good = await pre(web);
    expect(good.status).toBe(204);
    expect(good.headers.get('access-control-allow-origin')).toBe(web);
    expect(good.headers.get('access-control-allow-headers')).toContain('Idempotency-Key');
    const bad = await pre('https://evil.example');
    expect(bad.headers.get('access-control-allow-origin')).toBeNull();
    expect(bad.headers.get('access-control-allow-methods')).toBeNull();
  });
});
