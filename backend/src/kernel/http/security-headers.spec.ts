import * as express from 'express';
import type { AddressInfo } from 'net';
import { PERMISSIONS_POLICY, securityHeaders } from './security-headers';

// U1-11: the headers on an API response, on a bare Express app (the running backend: test/api/security-headers.spec.ts).
describe('security headers (DC-11)', () => {
  async function headersOf(production: boolean, route?: (res: express.Response) => void) {
    const app = express();
    app.use(securityHeaders(production));
    app.get('/x', (_req, res) => {
      route?.(res);
      res.json({ ok: true });
    });
    const server = app.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    try {
      const r = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/x`);
      return r.headers;
    } finally {
      server.close();
    }
  }

  it('SEC-WEB-01 SEC-WEB-02 an API response loads nothing, is framed nowhere and turns every powerful feature off', async () => {
    const h = await headersOf(false);
    expect(h.get('content-security-policy')).toBe("default-src 'none';frame-ancestors 'none';base-uri 'none';form-action 'none'");
    expect(h.get('x-content-type-options')).toBe('nosniff');
    expect(h.get('referrer-policy')).toBe('no-referrer');
    expect(h.get('x-frame-options')).toBe('DENY');
    expect(h.get('cross-origin-opener-policy')).toBe('same-origin');
    expect(h.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(h.get('permissions-policy')).toBe(PERMISSIONS_POLICY);
    expect(PERMISSIONS_POLICY).toContain('camera=()');
    expect(PERMISSIONS_POLICY).toContain('geolocation=()');
    expect(h.get('x-powered-by')).toBeNull();
    expect(h.get('strict-transport-security')).toBeNull(); // not in development
  });

  it('SEC-DAT-01 HSTS in production; a page sets its own policy over the default', async () => {
    expect((await headersOf(true)).get('strict-transport-security')).toBe('max-age=31536000; includeSubDomains');
    const page = await headersOf(false, (res) => res.set('Content-Security-Policy', "default-src 'none'; form-action 'self'"));
    expect(page.get('content-security-policy')).toBe("default-src 'none'; form-action 'self'");
  });
});
