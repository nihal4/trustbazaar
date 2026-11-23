import { readFileSync } from 'fs';
import { join } from 'path';

// SEC-INF-02: PostgreSQL and Redis are not reachable from outside the internal container network, and both require
// authentication. Read from the Compose files the system runs from (the repository root), development and production.
const ROOT = join(__dirname, '..', '..', '..');
const compose = readFileSync(join(ROOT, 'docker-compose.yml'), 'utf8');
const prod = readFileSync(join(ROOT, 'docker-compose.prod.yml'), 'utf8');

/** The text of one top-level service, up to the next service or section. */
function service(text: string, name: string): string {
  const start = text.search(new RegExp(`^  ${name}:`, 'm'));
  if (start < 0) return '';
  const rest = text.slice(start + 1);
  const end = rest.search(/^ {2}[a-z][\w-]*:|^[a-z]/m);
  return end < 0 ? rest : rest.slice(0, end);
}

describe('SEC-INF-02 the data stores stay inside', () => {
  it.each(['postgres', 'redis'])('SEC-INF-02 %s publishes no port and is only on the internal network', (name) => {
    for (const text of [compose, prod]) {
      const s = service(text, name);
      expect(s).not.toMatch(/^\s+ports:/m);
      if (text === compose) expect(s).toMatch(/networks:\s*\[data\]/);
    }
  });

  it('SEC-INF-02 the data network is internal: no route out of it', () => {
    expect(compose).toMatch(/^\s+data:\s*\{\s*internal:\s*true\s*\}/m);
    expect(prod).not.toMatch(/internal:\s*false/);
  });

  it('SEC-INF-02 PostgreSQL requires a password (SCRAM) on every connection, and Redis requires its password', () => {
    expect(service(compose, 'postgres')).toMatch(/--auth-host=scram-sha-256 --auth-local=scram-sha-256/);
    expect(service(compose, 'postgres')).toMatch(/POSTGRES_PASSWORD:/);
    expect(service(compose, 'redis')).toMatch(/--requirepass \\?"\$\$REDIS_PASSWORD\\?"/);
  });

  it('SEC-INF-02 only the web container publishes a port', () => {
    const published = [...compose.matchAll(/^ {2}([a-z][\w-]*):[\s\S]*?(?=^ {2}[a-z][\w-]*:|^[a-z]|$(?![\s\S]))/gm)]
      .filter((m) => /^\s+ports:/m.test(m[0])).map((m) => m[1]);
    expect(published).toEqual(['web']);
  });
});
