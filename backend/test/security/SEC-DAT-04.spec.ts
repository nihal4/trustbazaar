import { CONFIG_PORT, type ConfigPort } from '../../src/kernel/config-port';
import { submitKyc, suite } from './setup';

// SEC-DAT-04: protected files are served only through short-lived signed URLs (CP-31), issued to an authorised viewer
// after the check of SEC-ACC-06.
const s = suite();

describe('SEC-DAT-04 signed file links', () => {
  async function link() {
    const owner = await s.signedIn({ kyc: 'unsubmitted' });
    await submitKyc(owner.b);
    const body = (await (await owner.b.post('/kyc/files/doc_front/view')).json()) as { url: string; expiresAt?: string };
    return { owner, ...body, path: body.url.replace('/api/v1', '') };
  }

  it('SEC-DAT-04 a link names no file and lives no longer than CP-31', async () => {
    const { url, expiresAt } = await link();
    expect(url).toMatch(/^\/api\/v1\/files\/v\//);
    expect(url).not.toMatch(/kyc|doc_front|\.jpe?g/i);
    const cp31 = (await s.t.app.get<ConfigPort>(CONFIG_PORT).current()).ms('CP-31');
    if (expiresAt) expect(Date.parse(expiresAt) - Date.now()).toBeLessThanOrEqual(cp31 + 2000);
    expect(cp31).toBeLessThanOrEqual(10 * 60_000);
  });

  it('SEC-DAT-04 a changed signature, a changed path or a guessed link is refused', async () => {
    const { owner, path } = await link();
    expect((await owner.b.get(path)).status).toBe(200);
    const last = path.slice(-1);
    const flipped = path.slice(0, -1) + (last === 'A' ? 'B' : 'A');
    expect((await owner.b.get(flipped)).status).toBeGreaterThanOrEqual(400);
    expect((await owner.b.get('/files/v/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).status).toBeGreaterThanOrEqual(400);
  });

  it('SEC-DAT-04 an expired link is refused', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'queueMicrotask', 'hrtime', 'performance'] });
    try {
      const { owner, path } = await link();
      const cp31 = (await s.t.app.get<ConfigPort>(CONFIG_PORT).current()).ms('CP-31');
      jest.setSystemTime(Date.now() + cp31 + 60_000);
      expect((await owner.b.get(path)).status).toBe(410);
    } finally {
      jest.useRealTimers();
    }
  });
});
