import { promises as fs } from 'fs';
import { join } from 'path';
import { PURPOSE_FOLDER } from '../../src/modules/identity/crypto/file-vault';
import { image, submitKyc, suite } from './setup';

// SEC-DAT-02: KYC images and dispute evidence are encrypted at rest with an authenticated cipher (AES-256-GCM) under
// keys held outside the database, and are never reachable through a public or guessable URL.
const s = suite();

describe('SEC-DAT-02 protected files at rest', () => {
  it('SEC-DAT-02 a KYC image on the volume is not the image, and its key in the database is wrapped', async () => {
    const owner = await s.signedIn({ kyc: 'unsubmitted' });
    const { id } = await submitKyc(owner.b);
    const rows = await s.fx.query<{ storage_key: string; wrapped_dek: Buffer; sha256: Buffer; byte_size: number }>(
      `SELECT storage_key, wrapped_dek, sha256, byte_size FROM identity.kyc_files WHERE submission_id = $1`,
      [id],
    );
    expect(rows).toHaveLength(4);
    for (const f of rows) {
      const stored = await fs.readFile(join(s.cfg.filesRoot, PURPOSE_FOLDER.kyc, f.storage_key));
      expect(stored.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))).toBe(false); // no JPEG header
      expect(stored.subarray(1, 4).toString()).not.toBe('PNG');
      expect(stored.length).toBe(f.byte_size + 12 + 16); // IV and GCM tag around the ciphertext
      expect(f.wrapped_dek.length).toBeGreaterThanOrEqual(1 + 12 + 32 + 16); // version, IV, key, tag: never a bare key
      expect(f.storage_key).toMatch(/^[A-Za-z0-9_-]{20,}$/); // a random name
    }
    const mode = (await fs.stat(join(s.cfg.filesRoot, PURPOSE_FOLDER.kyc, rows[0].storage_key))).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('SEC-DAT-02 a changed byte on the volume is detected, not served (authenticated encryption)', async () => {
    const owner = await s.signedIn({ kyc: 'unsubmitted' });
    const { id } = await submitKyc(owner.b);
    const [f] = await s.fx.query<{ storage_key: string }>(`SELECT storage_key FROM identity.kyc_files WHERE submission_id = $1 AND kind = 'doc_front'`, [id]);
    const path = join(s.cfg.filesRoot, PURPOSE_FOLDER.kyc, f.storage_key);
    const bytes = await fs.readFile(path);
    bytes[20] ^= 0xff;
    await fs.writeFile(path, bytes);
    const { url } = (await (await owner.b.post('/kyc/files/doc_front/view')).json()) as { url: string };
    expect((await owner.b.get(url.replace('/api/v1', ''))).status).toBeGreaterThanOrEqual(400);
  });

  it('SEC-DAT-02 dispute evidence is sealed the same way', async () => {
    const buyer = await s.signedIn({ kyc: 'verified' });
    const seller = await s.fx.user({ kyc: 'verified' });
    const [{ id: order }] = await s.fx.query<{ id: string }>(
      `INSERT INTO orders.orders (kind, listing_id, item_kind, buyer_id, seller_id, quantity, unit_price, item_price, fulfilment, delivery_fee, total,
          listing_snapshot, commission_bps, delivery_margin_bps, params_version, payment_due_at, status, paid_at, fulfilment_step, fulfilment_due_at)
       VALUES ('fixed_price', gen_random_uuid(), 'physical', $1, $2, 1, 300000, 300000, 'self_pickup', 0, 300000, '{"title":"Radio"}', 500, 1000, 1,
               now(), 'paid', now(), 'meetup_handover', now() + interval '3 days') RETURNING id`,
      [buyer.a.userId, seller],
    );
    const [{ id: dispute }] = await s.fx.query<{ id: string }>(
      `INSERT INTO disputes.disputes (order_id, buyer_id, seller_id, item_kind, type, description, item_price, amount_collected, seller_due_at)
       VALUES ($1, $2, $3, 'physical', 'not_as_described', 'The radio has no sound at all.', 300000, 300000, now() + interval '2 days') RETURNING id`,
      [order, buyer.a.userId, seller],
    );
    const form = new FormData();
    form.set('file', new Blob([new Uint8Array(await image())], { type: 'image/jpeg' }), 'proof.jpg');
    expect((await buyer.b.upload(`/disputes/${dispute}/evidence`, form)).status).toBeLessThan(300);
    const dir = join(s.cfg.filesRoot, PURPOSE_FOLDER.dispute_evidence);
    const names = await fs.readdir(dir);
    const newest = (await Promise.all(names.map(async (n) => ({ n, t: (await fs.stat(join(dir, n))).mtimeMs })))).sort((a, b) => b.t - a.t)[0].n;
    const stored = await fs.readFile(join(dir, newest));
    expect(stored.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))).toBe(false);
  });

  it('SEC-DAT-02 no URL serves the volume: a stored name, with or without the API prefix, is not found', async () => {
    const owner = await s.signedIn({ kyc: 'unsubmitted' });
    const { id } = await submitKyc(owner.b);
    const [f] = await s.fx.query<{ storage_key: string }>(`SELECT storage_key FROM identity.kyc_files WHERE submission_id = $1 LIMIT 1`, [id]);
    for (const path of [`/files/${f.storage_key}`, `/files/kyc/${f.storage_key}`, `/api/files/kyc/${f.storage_key}`, `/kyc/${f.storage_key}`]) {
      const r = await owner.b.get(path);
      expect([401, 403, 404, 410]).toContain(r.status);
    }
  });
});
