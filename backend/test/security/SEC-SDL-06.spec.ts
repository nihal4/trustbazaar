import { readFileSync } from 'fs';
import { join } from 'path';

// SEC-SDL-06 (should): container images are scanned for known vulnerabilities before release. The images are built in CI
// today; their scan is U9-01's (images scanned, SBOM), and this file is completed with it (Decisions log, U9-02).
const ROOT = join(__dirname, '..', '..', '..');

describe('SEC-SDL-06 image scanning', () => {
  it('SEC-SDL-06 CI builds both images, so there is something to scan before release', () => {
    expect(readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8')).toMatch(/docker compose build backend web/);
  });

  it.todo('SEC-SDL-06 each built image is scanned and the build fails on a known critical or high finding (U9-01)');
});
