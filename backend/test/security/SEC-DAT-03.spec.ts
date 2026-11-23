import { createHmac } from 'crypto';
import { submitKyc, suite } from './setup';

// SEC-DAT-03: NID and passport numbers are stored encrypted; the uniqueness check (FR-KYC-04) and the blacklist
// (FR-TNS-06) use a blind index, an HMAC-SHA-256 under a separate secret key, so a copy of the database does not reveal
// or confirm a number.
const s = suite();

describe('SEC-DAT-03 document numbers', () => {
  it('SEC-DAT-03 the number is stored encrypted; its index is a keyed HMAC, not a plain hash', async () => {
    const owner = await s.signedIn({ kyc: 'unsubmitted' });
    const { id, docNumber } = await submitKyc(owner.b);
    const [row] = await s.fx.query<{ doc_number_enc: Buffer; doc_number_bidx: Buffer }>(
      `SELECT doc_number_enc, doc_number_bidx FROM identity.kyc_submissions WHERE id = $1`, [id]);
    expect(row.doc_number_enc.includes(Buffer.from(docNumber))).toBe(false);
    const keyed = createHmac('sha256', s.cfg.secrets.bidxKey.reveal()).update(`doc|nid|${docNumber}`).digest();
    expect(row.doc_number_bidx.equals(keyed)).toBe(true);
    // without the separate key the index cannot be rebuilt: not under the field key, nor under an empty key
    const field = s.cfg.keys.field;
    expect(row.doc_number_bidx.equals(createHmac('sha256', field.key(field.current)!.reveal()).update(`doc|nid|${docNumber}`).digest())).toBe(false);
    expect(row.doc_number_bidx.equals(createHmac('sha256', '').update(`doc|nid|${docNumber}`).digest())).toBe(false);
    expect(s.cfg.secrets.bidxKey.reveal()).not.toBe(field.key(field.current)!.reveal());
  });

  it('SEC-DAT-03 the same number on a second account is found through the index alone', async () => {
    const first = await s.signedIn({ kyc: 'unsubmitted' });
    const { docNumber } = await submitKyc(first.b);
    const second = await s.signedIn({ kyc: 'unsubmitted' });
    const { id } = await submitKyc(second.b, { docNumber });
    const [row] = await s.fx.query<{ routed_flags: string[] }>(`SELECT routed_flags FROM identity.kyc_submissions WHERE id = $1`, [id]);
    expect(row.routed_flags.join(' ')).toMatch(/duplicate/);
  });

  it('SEC-DAT-03 the blacklist holds indexes only', async () => {
    const cols = await s.fx.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'identity' AND table_name = 'nid_blacklist'`);
    const names = cols.map((c) => c.column_name);
    expect(names).toContain('doc_number_bidx');
    expect(names.filter((n) => /number/.test(n) && !/bidx/.test(n))).toEqual([]);
  });
});
