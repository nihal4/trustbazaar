import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
// sharp's package types resolve to its ES module typings under this project's CommonJS setup, while
// require() returns the function itself; the cast joins the two.
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const sharp = require('sharp') as typeof import('sharp').default;
import { loadConfig } from '../../../kernel/config/config';
import { signFileLink, verifyFileLink } from '../security/file-links';
import { ageOn, validDocNumber } from '../services/kyc.service';
import { FileVault } from './file-vault';
import { IdentityCrypto, normaliseDocNumber, normaliseName } from './identity-crypto';
import { ImageRejected, reencodeImage, sniffImage } from './images';

const env = (filesRoot: string) => ({
  TB_ENV: 'test', FILES_ROOT: filesRoot,
  JWT_KEY_V1: 'j'.repeat(32), FIELD_KEY_V1: 'f'.repeat(32), KYC_KEK_V1: 'k'.repeat(32),
  BIDX_KEY: 'b'.repeat(32), CSRF_KEY: 'c'.repeat(32), LINK_KEY: 'l'.repeat(32), OTP_PEPPER: 'o'.repeat(32),
  CALLBACK_STATE_KEY: 's'.repeat(32), HANDOVER_KEY: 'h'.repeat(32),
  DATABASE_URL: 'postgres://u:p@localhost/db', REDIS_URL: 'redis://localhost:6379',
});

const photo = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 40 } } });

describe('KYC images (SEC-INP-04, SEC-DAT-08)', () => {
  it('SEC-INP-04 the type comes from the content: JPEG, PNG and WebP only, whatever the name says', async () => {
    expect(sniffImage(await photo(10, 10).jpeg().toBuffer())).toBe('image/jpeg');
    expect(sniffImage(await photo(10, 10).png().toBuffer())).toBe('image/png');
    expect(sniffImage(await photo(10, 10).webp().toBuffer())).toBe('image/webp');
    expect(sniffImage(await photo(10, 10).gif().toBuffer())).toBeNull();
    expect(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    await expect(reencodeImage(Buffer.from('%PDF-1.7 not an image'))).rejects.toEqual(new ImageRejected('not-an-image'));
  });

  it('SEC-INP-04 an image over 10 MB, or a damaged one, is refused', async () => {
    await expect(reencodeImage(Buffer.alloc(10 * 1024 * 1024 + 1, 0xff))).rejects.toEqual(new ImageRejected('too-large'));
    const jpeg = await photo(50, 50).jpeg().toBuffer();
    await expect(reencodeImage(jpeg.subarray(0, 40))).rejects.toEqual(new ImageRejected('unreadable'));
  });

  it('SEC-DAT-08 metadata, including the EXIF location, is removed; the image is turned upright and re-encoded as JPEG', async () => {
    const tagged = await photo(400, 200)
      .png()
      .withExif({ IFD0: { Copyright: 'someone', ImageDescription: 'home' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '23/1 48/1 0/1' } })
      .withMetadata({ orientation: 6 })
      .toBuffer();
    expect((await sharp(tagged).metadata()).exif).toBeDefined();
    const { jpeg, width, height } = await reencodeImage(tagged);
    const m = await sharp(jpeg).metadata();
    expect(m.format).toBe('jpeg');
    expect(m.exif).toBeUndefined();
    expect(m.orientation).toBeUndefined();
    expect([width, height]).toEqual([200, 400]); // orientation 6 is a quarter turn
  });

  it('DV-9 the long side is reduced to 2000 pixels, never enlarged', async () => {
    expect(await reencodeImage(await photo(4000, 1000).jpeg().toBuffer())).toMatchObject({ width: 2000, height: 500 });
    expect(await reencodeImage(await photo(300, 200).jpeg().toBuffer())).toMatchObject({ width: 300, height: 200 });
  });
});

describe('KYC encryption (SEC-DAT-02, SEC-DAT-03)', () => {
  let root: string;
  let crypto: IdentityCrypto;
  let vault: FileVault;

  beforeAll(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'tb-vault-'));
    const config = loadConfig(env(root));
    crypto = new IdentityCrypto(config);
    vault = new FileVault(config);
  });
  afterAll(() => fs.rm(root, { recursive: true, force: true }));

  it('SEC-DAT-03 the document index ignores spacing and dashes; the person index ignores case and punctuation', () => {
    expect(normaliseDocNumber('nid', '199 2-123 4567890')).toBe('19921234567890');
    expect(normaliseName('  Md.  Rahim   UDDIN ')).toBe('md rahim uddin');
    expect(crypto.docNumberIndex('nid', '1234-567-890').equals(crypto.docNumberIndex('nid', '1234567890'))).toBe(true);
    expect(crypto.docNumberIndex('nid', '1234567890').equals(crypto.docNumberIndex('passport', '1234567890'))).toBe(false);
    expect(crypto.personIndex('Md. Rahim Uddin', '1990-01-02').equals(crypto.personIndex('md rahim  uddin', '1990-01-02'))).toBe(true);
    expect(crypto.personIndex('Md. Rahim Uddin', '1990-01-02').equals(crypto.personIndex('Md. Rahim Uddin', '1990-01-03'))).toBe(false);
    expect(crypto.docNumberIndex('nid', '1234567890')).toHaveLength(32);
  });

  it('SEC-DAT-03 an encrypted field opens only in its own row and column', () => {
    const ctx = { table: 'kyc_submissions', column: 'full_name_enc', rowId: 'a' };
    const sealed = crypto.sealField('Rahim Uddin', ctx);
    expect(sealed.includes(Buffer.from('Rahim'))).toBe(false);
    expect(crypto.openField(sealed, ctx)).toBe('Rahim Uddin');
    expect(() => crypto.openField(sealed, { ...ctx, rowId: 'b' })).toThrow();
    expect(() => crypto.openField(sealed, { ...ctx, column: 'dob_enc' })).toThrow();
  });

  it('SEC-DAT-02 a vault file is encrypted with its own key, written 0600, and opens only for its own row', async () => {
    const plain = await photo(20, 20).jpeg().toBuffer();
    const a = await vault.seal('kyc', 'file-a', plain);
    const b = await vault.seal('kyc', 'file-b', plain);
    const onDisk = await fs.readFile(join(root, 'kyc', a.storageKey));
    expect(onDisk.includes(plain.subarray(0, 64))).toBe(false);
    expect((await fs.stat(join(root, 'kyc', a.storageKey))).mode & 0o777).toBe(0o600);
    expect(a.wrappedDek.equals(b.wrappedDek)).toBe(false);
    expect((await vault.open('kyc', 'file-a', a.storageKey, a.wrappedDek)).equals(plain)).toBe(true);
    await expect(vault.open('kyc', 'file-b', a.storageKey, a.wrappedDek)).rejects.toThrow();
    await vault.erase('kyc', a.storageKey);
    await expect(fs.stat(join(root, 'kyc', a.storageKey))).rejects.toThrow();
  });
});

describe('signed file links (SEC-DAT-04)', () => {
  const key = 'l'.repeat(32);
  const now = new Date('2026-11-01T10:00:00Z');
  const claims = { f: 'file', s: 'session', p: 'user' as const, e: now.getTime() + 300_000 };

  it('SEC-DAT-04 a link is authentic, names its file and session, and expires (CP-31)', () => {
    const token = signFileLink(key, claims);
    expect(verifyFileLink(key, token, now)).toEqual(claims);
    expect(verifyFileLink(key, token, new Date(claims.e + 1))).toBeNull();
    expect(verifyFileLink('x'.repeat(32), token, now)).toBeNull();
    const [body, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...claims, f: 'other' })).toString('base64url');
    expect(verifyFileLink(key, `${forged}.${sig}`, now)).toBeNull();
    expect(verifyFileLink(key, body, now)).toBeNull();
  });
});

describe('KYC details (FR-KYC-01, FR-KYC-03)', () => {
  it('FR-KYC-03 the age is counted in whole years on the day of submission', () => {
    const on = new Date('2026-11-01T00:00:00Z');
    expect(ageOn('2008-11-01', on)).toBe(18);
    expect(ageOn('2008-11-02', on)).toBe(17);
    expect(ageOn('1990-05-20', on)).toBe(36);
  });

  it('FR-KYC-01 an NID number has 10, 13 or 17 digits; a passport number 1 or 2 letters and 7 or 8 digits', () => {
    for (const ok of ['1234567890', '1234567890123', '19901234567890123', '123 456 7890']) expect(validDocNumber('nid', ok)).toBe(true);
    for (const bad of ['123456789', '12345678901', 'A123456789']) expect(validDocNumber('nid', bad)).toBe(false);
    expect(validDocNumber('passport', 'A01234567')).toBe(true);
    expect(validDocNumber('passport', 'EB1234567')).toBe(true);
    expect(validDocNumber('passport', '012345678')).toBe(false);
  });
});
