import { authenticator } from 'otplib';
import { DataSource } from 'typeorm';
import { loadConfig } from '../../src/kernel/config/config';
import { CONFIG_PORT, ConfigPort } from '../../src/kernel/config-port';
import { ConfigService } from '../../src/modules/trust/services/config.service';
import { startApp, TestApp } from '../support/app';
import { Browser } from '../support/browser';
import { IdentityFixtures } from '../support/identity';

// U7-01: ConfigPort over the versioned parameter set, and the administrators' changes (Unit 7 section
// "Parameters and Feature Switches"; FR-OPS-03, FR-OPS-08, FR-OPS-09, SEC-IRM-04, DV-50).
// The parameters changed here (CP-13, CP-45) are published back to their values from before this file in
// afterAll, so the test files that read them (checkout reads CP-13 since U2-02) see the usual values.
const CHANGED = ['CP-13', 'CP-45'];

describe('parameters (ConfigPort)', () => {
  let t: TestApp;
  let fx: IdentityFixtures;
  let origin: string;
  let port: ConfigPort;
  let original: Record<string, unknown>;

  beforeAll(async () => {
    t = await startApp();
    fx = await IdentityFixtures.open();
    origin = loadConfig(process.env).publicOrigin;
    port = t.app.get(CONFIG_PORT);
    const now = await port.current();
    original = Object.fromEntries(CHANGED.map((c) => [c, now.get(c)]));
  });
  afterAll(async () => {
    if (t && original) {
      const a = await admin();
      expect((await a.b.post('/admin/config', { changes: original, reason: 'Restore the values from before the config tests' })).status).toBe(201);
    }
    await fx?.close();
    await t?.close();
  });

  async function admin(role: 'administrator' | 'operator' = 'administrator') {
    const s = await fx.staffAccount(role);
    const b = new Browser(t, origin, '__Host-tb_scsrf');
    await b.post('/staff/auth/signin', { email: s.email, password: s.password });
    expect((await b.post('/staff/auth/mfa', { code: authenticator.generate(s.totpSecret!) })).status).toBe(204);
    return { ...s, b };
  }
  const current = async (a: { b: Browser }) => (await a.b.get('/admin/config')).json();

  it('FR-OPS-08 version 1 holds the SRS defaults, read through ConfigPort by any unit', async () => {
    const v1 = await port.atVersion(1);
    expect(v1.ms('CP-01', 'access')).toBe(15 * 60_000);
    expect(v1.ms('CP-03', 'absolute')).toBe(8 * 3_600_000);
    expect(v1.get<number>('CP-34')).toBe(3);
    expect(v1.get<string[]>('CP-30')).toContain('staff.mfa_reset');
    expect((await port.current()).version).toBeGreaterThanOrEqual(1);
  });

  it('FR-OPS-03 an administrator publishes a change as a new version; the earlier version keeps its values', async () => {
    const a = await admin();
    const before = await current(a);
    const value = `${10 + Math.floor(Math.random() * 40)} minutes`;
    const r = await a.b.post('/admin/config', { changes: { 'CP-13': value }, reason: 'Longer checkout reservation for testing' });
    expect(r.status).toBe(201);
    const { version } = await r.json();
    expect(version).toBe(before.version + 1);
    expect((await port.current()).get('CP-13')).toBe(value); // this instance refreshes at once
    expect((await port.atVersion(before.version)).get('CP-13')).toBe(before.values['CP-13']);
    const [audit] = await fx.query(`SELECT actor_id, before_state, after_state FROM audit.events WHERE action = 'staff.config.published' ORDER BY chain_pos DESC LIMIT 1`);
    expect(audit).toEqual({ actor_id: a.staffId, before_state: { 'CP-13': before.values['CP-13'] }, after_state: { version, 'CP-13': value } });
    const versions = await (await a.b.get('/admin/config/versions')).json();
    expect(versions[0]).toMatchObject({ version, createdBy: a.staffId, reason: 'Longer checkout reservation for testing' });
  });

  it('FR-OPS-09 every broken rule is reported at once and nothing is published', async () => {
    const a = await admin();
    const before = await current(a);
    const changes = { 'CP-01': { access: '2 minutes' }, 'CP-31': '20 minutes', 'CP-45': 12 };
    const v = await (await a.b.post('/admin/config/validate', { changes })).json();
    expect(v.violations).toEqual(expect.arrayContaining(['CP-01 must be 5-30 minutes', 'CP-31 signed links at most 15 minutes', 'CP-45 must be 3-10']));
    const r = await a.b.post('/admin/config', { changes, reason: 'An attempt that must be refused' });
    expect(r.status).toBe(422);
    expect((await r.json()).errors).toHaveLength(3);
    expect((await current(a)).version).toBe(before.version);
    expect((await (await a.b.post('/admin/config/validate', { changes: { 'CP-99': 1 } })).json()).violations).toEqual(['unknown parameter CP-99']);
    await expect((await a.b.post('/admin/config/validate', { changes: { 'CP-30': ['kyc.revoke'] } })).json()).resolves.toMatchObject({
      violations: ['CP-30 four-eyes list may only grow'],
    });
  });

  it('SEC-IRM-04 an emergency switch changes only with a second administrator, and takes effect at once', async () => {
    const [a, b] = [await admin(), await admin()];
    const direct = await a.b.post('/admin/config', { changes: { 'SW-payouts': false }, reason: 'Stop payouts during an incident' });
    expect(direct.status).toBe(409);
    expect(await port.switchOn('SW-payouts')).toBe(true);

    const p = await (await a.b.post('/admin/config/proposals', { changes: { 'SW-payouts': false }, reason: 'Stop payouts during an incident' })).json();
    expect(p).toMatchObject({ action: 'emergency.control', decision: null });
    expect((await b.b.post(`/staff/approvals/${p.id}/decision`, { decision: 'approved' })).status).toBe(200);
    expect(await port.switchOn('SW-payouts')).toBe(false);
    const [v] = await fx.query(`SELECT approval_id FROM staff.config_versions ORDER BY version DESC LIMIT 1`);
    expect(v.approval_id).toBe(p.id);

    // and back on, the same way
    const q = await (await b.b.post('/admin/config/proposals', { changes: { 'SW-payouts': true }, reason: 'Incident over, payouts resume' })).json();
    await a.b.post(`/staff/approvals/${q.id}/decision`, { decision: 'approved' });
    expect(await port.switchOn('SW-payouts')).toBe(true);
  });

  it('FR-OPS-08 ten publications at once give ten consecutive, complete versions', async () => {
    const a = await admin();
    const start = (await current(a)).version;
    const answers = await Promise.all(
      Array.from({ length: 10 }, (_, i) => a.b.post('/admin/config', { changes: { 'CP-45': 3 + (i % 8) }, reason: `Parallel publication ${i}` })),
    );
    const versions = (await Promise.all(answers.map((r) => r.json()))).map((b: { version: number }) => b.version).sort((x, y) => x - y);
    expect(versions).toEqual(Array.from({ length: 10 }, (_, i) => start + 1 + i));
    const counts = await fx.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM staff.config_values WHERE version > $1 GROUP BY version`, [start]);
    const [{ n: full }] = await fx.query<{ n: number }>(`SELECT count(*)::int AS n FROM staff.config_values WHERE version = 1`);
    expect(counts.map((c) => c.n)).toEqual(Array(10).fill(full));
  });

  it('FR-OPS-03 only administrators change parameters', async () => {
    const op = await admin('operator');
    expect((await op.b.get('/admin/config')).status).toBe(403);
    expect((await op.b.post('/admin/config', { changes: { 'CP-13': '20 minutes' }, reason: 'Not allowed for operators' })).status).toBe(403);
  });

  it('FR-OPS-08 parameter versions cannot be rewritten by the application role', async () => {
    await expect(fx.query(`UPDATE staff.config_values SET value = '"1 minute"' WHERE version = 1 AND code = 'CP-31'`)).rejects.toThrow();
    await expect(fx.query(`DELETE FROM staff.config_versions WHERE version = 1`)).rejects.toThrow();
  });

  it('DV-50 another instance sees a new version within 60 seconds of its last read', async () => {
    let now = Date.now();
    const other = new ConfigService(t.app.get(DataSource), { now: () => new Date(now) });
    const seen = (await other.current()).version;
    const a = await admin();
    await a.b.post('/admin/config', { changes: { 'CP-45': 4 + Math.floor(Math.random() * 5) }, reason: 'Change for the cache test' });
    expect((await other.current()).version).toBe(seen); // cached
    now += 60_000;
    expect((await other.current()).version).toBe(seen + 1);
  });
});
