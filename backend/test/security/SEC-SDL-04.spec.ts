import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// SEC-SDL-04: dependencies are pinned by lock file and scanned for known vulnerabilities on every pull request (npm
// audit and Dependabot); the build fails on a known critical or high vulnerability with a fix, unless a documented
// exception exists.
const ROOT = join(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const PACKAGES = ['backend', 'frontend', 'docs/design/web', 'docs/design/crypto'];

describe('SEC-SDL-04 dependencies', () => {
  it.each(PACKAGES)('SEC-SDL-04 %s is pinned by its lock file and installed with npm ci', (dir) => {
    expect(existsSync(join(ROOT, dir, 'package-lock.json'))).toBe(true);
    const lock = JSON.parse(read(`${dir}/package-lock.json`)) as { lockfileVersion: number };
    expect(lock.lockfileVersion).toBeGreaterThanOrEqual(2);
  });

  it('SEC-SDL-04 CI installs from the lock files and runs the audit gate on every pull request', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).not.toMatch(/run: npm install\b/);
    expect(ci).toMatch(/run: npm ci/);
    expect(ci).toMatch(/node \.\.\/scripts\/audit-check\.mjs/);
    expect(ci).toMatch(/pull_request:\s*\{\s*branches:\s*\[main\]\s*\}/);
  });

  it('SEC-SDL-04 the audit gate fails on high and critical findings, and its own tests are run', () => {
    const gate = read('scripts/audit-check.mjs');
    expect(gate).toMatch(/high/);
    expect(gate).toMatch(/critical/);
    expect(existsSync(join(ROOT, 'scripts/audit-check.test.mjs'))).toBe(true);
    expect(read('.github/workflows/ci.yml')).toMatch(/node --test \.\.\/scripts\/audit-check\.test\.mjs/);
  });

  it('SEC-SDL-04 every exception is documented with its reason and an end date', () => {
    const file = join(ROOT, 'scripts/audit-exceptions.json');
    const list = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as { exceptions?: Record<string, unknown>[] } | Record<string, unknown>[]) : [];
    const items = Array.isArray(list) ? list : (list.exceptions ?? []);
    for (const e of items) {
      expect(JSON.stringify(e)).toMatch(/reason|why/i);
      expect(JSON.stringify(e)).toMatch(/expires|until|review/i);
    }
  });

  it('SEC-SDL-04 Dependabot watches every npm package of the repository', () => {
    const bot = read('.github/dependabot.yml');
    for (const dir of PACKAGES) expect(bot).toContain(`package-ecosystem: npm, directory: /${dir}`);
  });
});
