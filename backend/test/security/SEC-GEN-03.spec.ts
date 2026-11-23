import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

// SEC-GEN-03: every security requirement marked T in the SRS has at least one automated test in the CI pipeline. The
// pipeline's tests: the backend (unit, API, concurrency, security), the web client's unit tests and the design's
// reference tests. A to-do is not a test: the few still waiting for their task are listed here with it, and must leave
// this list when their test is written.
const ROOT = join(__dirname, '..', '..', '..');
const PENDING: Record<string, string> = { 'SEC-DAT-06': 'U9-05, backup and restore rehearsal' };

const walk = (d: string): string[] =>
  readdirSync(d).flatMap((n) => {
    if (n === 'node_modules' || n === 'dist' || n.startsWith('.')) return [];
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(spec|test)\.(ts|tsx|mjs|js)$/.test(n) ? [p] : [];
  });

describe('SEC-GEN-03 every T security requirement is tested', () => {
  const srs = readFileSync(join(ROOT, 'docs/srs.tex'), 'utf8');
  const marked = [...srs.matchAll(/\\req\{(SEC-[A-Z]+-\d+)\}\{[^}]*\}\{T\}/g)].map((m) => m[1]);
  const titles = ['backend/src', 'backend/test', 'frontend/src', 'docs/design/web', 'docs/design/crypto']
    .flatMap((d) => walk(join(ROOT, d)))
    .flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/\b(?:it|test)(?:\.each\([\s\S]*?\))?\(\s*(['"`])((?:(?!\1)[^\\]|\\.)*)\1/g)].map((m) => m[2]));

  it('SEC-GEN-03 the SRS marks security requirements for testing', () => {
    expect(marked.length).toBeGreaterThan(50);
  });

  it('SEC-GEN-03 each of them has a test named after it, run by CI; a to-do does not count', () => {
    const untested = marked.filter((id) => !titles.some((t) => new RegExp(`\\b${id}\\b`).test(t)));
    expect(untested).toEqual(Object.keys(PENDING));
  });
});
