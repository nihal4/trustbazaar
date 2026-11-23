import { readFileSync } from 'fs';
import { join } from 'path';

// SEC-SDL-02: the CI pipeline runs linting, the unit tests, the concurrency suite and the security tests on every push and
// pull request to the main branch. Read from .github/workflows/ci.yml and the test configuration it runs.
const ROOT = join(__dirname, '..', '..', '..');
const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
const integration = JSON.parse(readFileSync(join(ROOT, 'backend/test/jest.integration.json'), 'utf8')) as { roots: string[] };
const pkg = JSON.parse(readFileSync(join(ROOT, 'backend/package.json'), 'utf8')) as { scripts: Record<string, string> };

describe('SEC-SDL-02 the pipeline', () => {
  it('SEC-SDL-02 it runs on every push and every pull request to main', () => {
    expect(ci).toMatch(/^\s+push:\s*\{\s*branches:\s*\[main\]\s*\}/m);
    expect(ci).toMatch(/^\s+pull_request:\s*\{\s*branches:\s*\[main\]\s*\}/m);
  });

  it('SEC-SDL-02 it lints and runs the unit tests of the backend and the web client', () => {
    expect(ci).toMatch(/app:\s*\[backend,\s*frontend\]/);
    expect(ci).toMatch(/run: npm run lint/);
    expect(ci).toMatch(/run: npm test -- --coverage/);
  });

  it('SEC-SDL-02 it runs the concurrency suite: the SQL race scripts and the API concurrency tests', () => {
    expect(ci).toMatch(/_concurrency\.sh/);
    expect(ci).toMatch(/run: npm run test:integration/);
    expect(integration.roots).toContain('<rootDir>/test/concurrency');
  });

  it('SEC-SDL-02 it runs the security tests (test/security) in the same integration job', () => {
    expect(integration.roots).toContain('<rootDir>/test/security');
    expect(pkg.scripts['test:integration']).toMatch(/test\/jest\.integration\.json/);
  });
});
