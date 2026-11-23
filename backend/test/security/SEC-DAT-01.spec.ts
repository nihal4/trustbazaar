import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import * as express from 'express';
import type { AddressInfo } from 'net';
import { securityHeaders } from '../../src/kernel/http/security-headers';
import { suite } from './setup';

// SEC-DAT-01: external connections use TLS 1.2 or later with HSTS on every response; plain HTTP only redirects to
// HTTPS; connections to providers verify certificates. TLS ends at the front (a reverse proxy or the provider's load
// balancer, Unit 9 section 6.3): what the repository controls is tested here.
const s = suite();
const ROOT = join(__dirname, '..', '..', '..');
const files = (dir: string, ext: RegExp): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (n === 'node_modules' || n === 'dist' || n.startsWith('.')) return [];
    return statSync(p).isDirectory() ? files(p, ext) : ext.test(n) ? [p] : [];
  });

describe('SEC-DAT-01 transport', () => {
  it('SEC-DAT-01 in production every API response carries HSTS for a year, subdomains included', async () => {
    const app = express();
    app.use(securityHeaders(true));
    app.get('/x', (_q, r) => r.json({}));
    app.use((_q, r) => r.status(404).end());
    const server = await new Promise<import('http').Server>((ok) => { const x = app.listen(0, '127.0.0.1', () => ok(x)); });
    try {
      const { port } = server.address() as AddressInfo;
      for (const path of ['/x', '/missing']) {
        const r = await fetch(`http://127.0.0.1:${port}${path}`);
        expect(r.headers.get('strict-transport-security')).toBe('max-age=31536000; includeSubDomains');
      }
    } finally {
      server.close();
    }
  });

  it('SEC-DAT-01 the production stack is reachable only through the TLS front: the web port listens on the loopback', () => {
    const prod = readFileSync(join(ROOT, 'docs/design/deploy/docker-compose.prod.yml'), 'utf8');
    expect(prod).toMatch(/terminates HTTPS, sets HSTS/);
    const ports = [...prod.matchAll(/ports:\s*!override\s*\[([^\]]*)\]/g)].map((m) => m[1]);
    expect(ports.length).toBeGreaterThan(0);
    for (const p of ports) expect(p).toMatch(/^"127\.0\.0\.1:/);
    expect(s.cfg.publicOrigin.startsWith('http')).toBe(true);
  });

  it('SEC-DAT-01 nothing turns certificate verification off, and provider endpoints are https', () => {
    const sources = [...files(join(ROOT, 'backend/src'), /\.ts$/), ...files(join(ROOT, 'docs/design/deploy'), /\.(ya?ml|example|env|sh)$/)];
    const offenders = sources.filter((f) => /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED|checkServerIdentity\s*:/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
    const adapters = files(join(ROOT, 'backend/src/modules'), /adapter.*\.ts$|-provider\.ts$|client\.ts$/).filter((f) => !f.endsWith('.spec.ts'));
    const plain = adapters.flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/['"`]http:\/\/(?!127\.0\.0\.1|localhost)[^'"`]+/g)].map((m) => `${f}: ${m[0]}`));
    expect(plain).toEqual([]);
  });
});
