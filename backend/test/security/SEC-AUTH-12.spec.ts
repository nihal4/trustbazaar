import { suite } from './setup';

// SEC-AUTH-12: devices an account used before are recognised; a sign-in from an unrecognised device counts as new for
// FR-NTF-06 (identity.signin.new_device), and one from a known device does not.
const s = suite();
const newDeviceEvents = async (userId: string) =>
  (
    await s.fx.query<{ n: number }>(`SELECT count(*)::int AS n FROM identity.outbox WHERE aggregate_id = $1 AND event_type = 'identity.signin.new_device'`, [
      userId,
    ])
  )[0].n;

describe('SEC-AUTH-12 device recognition', () => {
  it('SEC-AUTH-12 a first sign-in on a browser is a new device; signing in again on it is not', async () => {
    const a = await s.fx.account();
    const b = s.browser();
    expect((await b.post('/auth/signin', { login: a.phone, password: a.password })).status).toBe(204);
    expect(b.cookies.has('__Host-tb_dev')).toBe(true);
    expect(await newDeviceEvents(a.userId)).toBe(1);
    expect((await b.post('/auth/signout')).status).toBe(204);
    expect((await b.post('/auth/signin', { login: a.phone, password: a.password })).status).toBe(204);
    expect(await newDeviceEvents(a.userId)).toBe(1);
  });

  it('SEC-AUTH-12 another browser is a new device, and a made-up device cookie does not pass as a known one', async () => {
    const a = await s.fx.account();
    await s.browser().post('/auth/signin', { login: a.phone, password: a.password });
    await s.browser().post('/auth/signin', { login: a.phone, password: a.password });
    expect(await newDeviceEvents(a.userId)).toBe(2);
    const forged = s.browser();
    forged.cookies.set('__Host-tb_dev', 'A'.repeat(43));
    await forged.post('/auth/signin', { login: a.phone, password: a.password });
    expect(await newDeviceEvents(a.userId)).toBe(3);
  });

  it('SEC-AUTH-12 the device key is stored only as a hash', async () => {
    const a = await s.fx.account();
    const b = s.browser();
    await b.post('/auth/signin', { login: a.phone, password: a.password });
    const key = b.cookies.get('__Host-tb_dev')!;
    const rows = await s.fx.query(`SELECT * FROM identity.known_devices WHERE user_id = $1`, [a.userId]);
    expect(JSON.stringify(rows)).not.toContain(key);
  });
});
