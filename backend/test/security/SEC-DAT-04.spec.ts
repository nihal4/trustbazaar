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
    // Mutations that always change the signature's data bits (the top bit of a base64url character is always significant), at the
    // first, the middle and the last position, plus the other spellings of the same signature (same 4 data bits in the last
    // character). The old check swapped the last character for 'A' or 'B'; when the real last character was 'A' (1 time in 16) 'B'
    // spelled the same signature and the link was accepted, so the test failed by chance (Decisions log, U9-07).
    const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const sigStart = path.lastIndexOf('.') + 1;
    const at = (p: string, i: number, ch: string) => p.slice(0, i) + ch + p.slice(i + 1);
    for (const i of [sigStart, Math.floor((sigStart + path.length) / 2), path.length - 1]) {
      expect((await owner.b.get(at(path, i, B64[B64.indexOf(path[i]) ^ 32]))).status).toBeGreaterThanOrEqual(400);
    }
    const group = B64.indexOf(path.slice(-1)) >> 2;
    for (let v = group * 4; v < group * 4 + 4; v++) {
      if (B64[v] !== path.slice(-1)) expect((await owner.b.get(at(path, path.length - 1, B64[v]))).status).toBeGreaterThanOrEqual(400);
    }
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
