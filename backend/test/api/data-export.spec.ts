import { randomInt, randomUUID } from 'crypto';
import { inflateRawSync } from 'zlib';
import { DataExportService } from '../../src/modules/trust/services/data-export.service';
import { startApp, TestApp } from '../support/app';
import { IdentityFixtures } from '../support/identity';

// U7-11: the data export (docs/design/07_disputes_trust_staff.pdf section 10; FR-PRV-03, DV-49) on the running backend:
// the request with step-up, the 7-day rule, the build job through every unit's export source, the encrypted ZIP behind
// a signed link, the notice, and the expiry job.
describe('data export', () => {
  let t: TestApp;
  let fx: IdentityFixtures;
  let exports: DataExportService;

  beforeAll(async () => {
    t = await startApp();
    fx = await IdentityFixtures.open();
    exports = t.app.get(DataExportService);
  });
  afterAll(async () => {
    await fx?.close();
    await t?.close();
  });

  async function member() {
    const userId = await fx.user({ kyc: 'verified' });
    const sid = await fx.session({ userId });
    const ip = `203.0.113.${randomInt(1, 255)}, 10.3.${randomInt(0, 255)}.${randomInt(1, 255)}`;
    const headers = fx.headers(sid, userId, 'user');
    const call = async (method: string, path: string, stepUp = false) =>
      fetch(t.url(path), { method, headers: { ...headers, 'x-forwarded-for': ip, ...(stepUp ? { 'x-step-up': await fx.stepUpGrant(sid, 'data.export') } : {}) } });
    return { userId, sid, headers, call };
  }
  const row = async <T = Record<string, unknown>>(sql: string, p: unknown[]) => (await fx.query<T>(sql, p))[0];
  /** The files of a ZIP written by kernel/privacy/zip.ts (deflate, no data descriptors). */
  function unzip(buf: Buffer): Record<string, Buffer> {
    const files: Record<string, Buffer> = {};
    let o = 0;
    while (buf.readUInt32LE(o) === 0x04034b50) {
      const size = buf.readUInt32LE(o + 18);
      const nameLen = buf.readUInt16LE(o + 26);
      const extra = buf.readUInt16LE(o + 28);
      const name = buf.subarray(o + 30, o + 30 + nameLen).toString('utf8');
      const start = o + 30 + nameLen + extra;
      files[name] = inflateRawSync(buf.subarray(start, start + size));
      o = start + size;
    }
    return files;
  }

  it('FR-PRV-03 DV-49 a user asks for a copy (step-up), gets every unit\'s data as JSON in a ZIP behind a signed link, and is told', async () => {
    const u = await member();
    const other = await fx.user({ kyc: 'verified' });
    const [{ id: orderId }] = await fx.query<{ id: string }>(
      `INSERT INTO orders.orders (kind, listing_id, item_kind, buyer_id, seller_id, quantity, unit_price, item_price, fulfilment, delivery_fee, total,
          listing_snapshot, commission_bps, delivery_margin_bps, params_version, payment_due_at, status)
       VALUES ('fixed_price', $1, 'physical', $2, $3, 1, 100000, 100000, 'self_pickup', 0, 100000, '{"title":"Exported lamp"}', 500, 1000, 1, now() + interval '1 hour', 'awaiting_payment') RETURNING id`,
      [randomUUID(), u.userId, other],
    );

    expect((await u.call('GET', '/me/data-export')).status).toBe(204);
    expect((await u.call('POST', '/me/data-export')).status).toBe(403); // step-up
    const r = await u.call('POST', '/me/data-export', true);
    expect(r.status).toBe(202);
    expect(await r.json()).toMatchObject({ status: 'preparing', readyAt: null, download: null });
    const again = await u.call('POST', '/me/data-export', true);
    expect(again.status).toBe(409);
    expect((await again.json()).type).toBe('/problems/request-in-progress');

    expect(await exports.buildDue()).toBeGreaterThanOrEqual(1);
    const s = await (await u.call('GET', '/me/data-export')).json();
    expect(s).toMatchObject({ status: 'ready', readyAt: expect.any(String), download: { url: expect.stringMatching(/^\/api\/v1\/files\/v\//), expiresAt: expect.any(String) } });
    expect(new Date(s.expiresAt).getTime() - new Date(s.readyAt).getTime()).toBe(7 * 86_400_000);

    const file = await fetch(t.url(s.download.url.replace('/api/v1', '')), { headers: { ...u.headers } });
    expect(file.status).toBe(200);
    expect(file.headers.get('content-disposition')).toBe('attachment; filename="trustbazaar-data.zip"');
    const files = unzip(Buffer.from(await file.arrayBuffer()));
    expect(Object.keys(files)).toEqual(['trustbazaar-data.json']);
    const text = files['trustbazaar-data.json'].toString('utf8');
    const data = JSON.parse(text);
    expect(data).toMatchObject({ format: 'trustbazaar-data-export/1', userId: u.userId });
    for (const section of ['account', 'orders', 'listings', 'delivery', 'gameAccounts', 'chat', 'trust']) expect(data[section]).toBeDefined();
    expect(data.account.profile).toEqual([expect.objectContaining({ id: u.userId, phone_e164: expect.any(String), email: expect.any(String) })]);
    expect(data.orders.orders).toEqual([expect.objectContaining({ id: orderId, listing_snapshot: { title: 'Exported lamp' } })]);
    for (const secret of ['password_hash', 'device_key_hash', 'doc_number_enc', 'idempotency_key', 'account_number_enc', 'ciphertext', 'code_hash']) expect(text).not.toContain(secret);

    const stored = await row<{ file_key: string }>(`SELECT file_key FROM staff.export_requests WHERE user_id = $1`, [u.userId]);
    expect(stored.file_key.startsWith('v1.data_export.')).toBe(true);
    expect(await row(`SELECT template_code FROM notify.notifications WHERE user_id = $1 AND template_code = 'privacy.export_ready'`, [u.userId])).toEqual({ template_code: 'privacy.export_ready' });
    expect(await row(`SELECT count(*)::int AS n FROM audit.events WHERE object_id = $1 AND action IN ('privacy.export.requested', 'privacy.export.ready')`, [u.userId])).toEqual({ n: 2 });

    // someone else's session cannot use the link
    const stranger = await member();
    expect((await fetch(t.url(s.download.url.replace('/api/v1', '')), { headers: stranger.headers })).status).not.toBe(200);
  });

  it('DV-49 one request every 7 days; after 7 days the file is deleted and the export shows as expired', async () => {
    const u = await member();
    expect((await u.call('POST', '/me/data-export', true)).status).toBe(202);
    await exports.buildDue();
    const limited = await u.call('POST', '/me/data-export', true);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(6 * 86_400);

    await fx.query(`UPDATE staff.export_requests SET requested_at = requested_at - interval '8 days', ready_at = ready_at - interval '8 days', expires_at = expires_at - interval '8 days' WHERE user_id = $1`, [u.userId]);
    expect(await exports.expireDue()).toBeGreaterThanOrEqual(1);
    expect(await row(`SELECT file_key FROM staff.export_requests WHERE user_id = $1`, [u.userId])).toEqual({ file_key: 'erased' });
    expect(await (await u.call('GET', '/me/data-export')).json()).toMatchObject({ status: 'expired', download: null });
    expect(await exports.expireDue()).toBe(0);
    expect((await u.call('POST', '/me/data-export', true)).status).toBe(202); // 7 days have passed
  });
});
