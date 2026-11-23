import { readFileSync } from 'fs';
import { join } from 'path';

// SEC-SDL-08 (should): a dynamic scan (OWASP ZAP baseline) is run against the release candidate and its findings are
// triaged before the demonstration. The scan is wired in .github/workflows/security.yml; the triage is U9-04's.
const ROOT = join(__dirname, '..', '..', '..');
const security = readFileSync(join(ROOT, '.github/workflows/security.yml'), 'utf8');

describe('SEC-SDL-08 dynamic scan', () => {
  it('SEC-SDL-08 the ZAP baseline runs against the whole system started with Compose', () => {
    expect(security).toMatch(/zap-baseline:/);
    expect(security).toMatch(/docker compose up --build -d --wait/);
    expect(security).toMatch(/uses: zaproxy\/action-baseline@[0-9a-f]{40}/); // pinned to a commit
    expect(security).toMatch(/target: "http:\/\/localhost:8080"/);
  });

  it('SEC-SDL-08 it can be started on demand for a release candidate', () => {
    expect(security).toMatch(/workflow_dispatch:/);
    expect(security).toMatch(/zap:\s*\{\s*description:/);
  });

  it.todo('SEC-SDL-08 the findings of the release candidate\'s scan are triaged in the repository (U9-04)');
});
