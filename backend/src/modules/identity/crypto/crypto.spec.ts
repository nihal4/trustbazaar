import { authenticator } from 'otplib';
import * as argon2 from 'argon2';
import { loadConfig } from '../../../kernel/config/config';
import { decryptField, encryptField } from './field-crypto';
import { ARGON2_PARAMS, PasswordHasher } from './password';
import { checkTotp, hashRecoveryCode } from './totp';

const env = {
  DATABASE_URL: 'postgres://u:p@h/db', REDIS_URL: 'redis://h:6379/0',
  JWT_KEY_V1: 'k'.repeat(32), FIELD_KEY_V1: 'field-key-version-1-0123456789abcdef', KYC_KEK_V1: 'q'.repeat(32),
  BIDX_KEY: 'b'.repeat(32), CSRF_KEY: 'c'.repeat(32), LINK_KEY: 'l'.repeat(32), OTP_PEPPER: 'o'.repeat(32),
  CALLBACK_STATE_KEY: 's'.repeat(32), HANDOVER_KEY: 'h'.repeat(32),
};
const keys = loadConfig(env).keys.field;
const ctx = { table: 'totp_factors', column: 'secret_enc', rowId: '11111111-1111-4111-8111-111111111111' };

describe('passwords', () => {
  const hasher = new PasswordHasher();

  it('SEC-AUTH-03 passwords are Argon2id with at least 19 MiB, 2 iterations, parallelism 1', async () => {
    const h = await hasher.hash('correct horse battery staple');
    const params = Object.fromEntries(h.split('$')[3].split(',').map((kv) => kv.split('=')));
    expect(h.startsWith('$argon2id$')).toBe(true);
    expect(params).toEqual({ m: '19456', t: '2', p: '1' });
    expect(await hasher.verifyOrDummy(h, 'correct horse battery staple')).toBe(true);
    expect(await hasher.verifyOrDummy(h, 'wrong')).toBe(false);
  });

  it('SEC-AUTH-03 a Bangla passphrase longer than 72 bytes is hashed in full', async () => {
    const pass = 'আমার সোনার বাংলা আমি তোমায় ভালোবাসি';
    expect(Buffer.byteLength(pass)).toBeGreaterThan(72);
    const h = await hasher.hash(pass);
    expect(await hasher.verifyOrDummy(h, pass)).toBe(true);
    expect(await hasher.verifyOrDummy(h, pass.slice(0, -1))).toBe(false);
  });

  it('SEC-AUTH-05 an unknown account costs the same Argon2id work and is refused', async () => {
    expect(await hasher.verifyOrDummy(null, 'dummy-password-for-unknown-accounts')).toBe(false);
    expect(await hasher.verifyOrDummy('not-a-hash', 'x')).toBe(false);
  });

  it('SEC-AUTH-03 a hash with older parameters needs a re-hash; a current one does not', async () => {
    const weak = await argon2.hash('pw', { ...ARGON2_PARAMS, memoryCost: 4096, timeCost: 1 });
    expect(hasher.needsRehash(weak)).toBe(true);
    expect(hasher.needsRehash(await hasher.hash('pw'))).toBe(false);
  });
});

describe('field encryption', () => {
  it('SEC-DAT-03 a value encrypts and decrypts in its own row and column', () => {
    const blob = encryptField(keys, Buffer.from('JBSWY3DPEHPK3PXP'), ctx);
    expect(blob[0]).toBe(1);
    expect(decryptField(keys, blob, ctx).toString()).toBe('JBSWY3DPEHPK3PXP');
  });

  it.each([
    ['another row', { ...ctx, rowId: '22222222-2222-4222-8222-222222222222' }],
    ['another column', { ...ctx, column: 'other' }],
    ['another table', { ...ctx, table: 'users' }],
  ])('SEC-DAT-03 a ciphertext moved to %s fails to decrypt', (_case, moved) => {
    const blob = encryptField(keys, Buffer.from('secret'), ctx);
    expect(() => decryptField(keys, blob, moved)).toThrow();
  });

  it('SEC-DAT-03 an altered ciphertext fails to decrypt', () => {
    const blob = encryptField(keys, Buffer.from('secret'), ctx);
    blob[20] ^= 1;
    expect(() => decryptField(keys, blob, ctx)).toThrow();
  });

  it('SEC-DAT-05 after rotation, new values use the new version and old ones still decrypt', () => {
    const rotated = loadConfig({ ...env, FIELD_KEY_V2: 'field-key-version-2-0123456789abcdef' }).keys.field;
    const old = encryptField(keys, Buffer.from('old'), ctx);
    const fresh = encryptField(rotated, Buffer.from('new'), ctx);
    expect(fresh[0]).toBe(2);
    expect(decryptField(rotated, old, ctx).toString()).toBe('old');
  });
});

describe('TOTP', () => {
  const secret = authenticator.generateSecret();
  const now = new Date('2026-11-01T00:00:15Z');
  const step = Math.floor(now.getTime() / 30000);
  const codeAt = (offsetSteps: number) =>
    authenticator.clone({ epoch: now.getTime() + offsetSteps * 30000 }).generate(secret);

  it('FR-ACC-06 the current code is accepted and its step returned', () => {
    expect(checkTotp(secret, codeAt(0), now)).toBe(step);
  });

  it('FR-ACC-06 codes one step either side are accepted; two steps away are refused', () => {
    expect(checkTotp(secret, codeAt(-1), now)).toBe(step - 1);
    expect(checkTotp(secret, codeAt(1), now)).toBe(step + 1);
    expect(checkTotp(secret, codeAt(-2), now)).toBeNull();
    expect(checkTotp(secret, codeAt(2), now)).toBeNull();
  });

  it('FR-ACC-06 malformed codes are refused', () => {
    expect(checkTotp(secret, '12345', now)).toBeNull();
    expect(checkTotp(secret, 'abcdef', now)).toBeNull();
  });

  it('FR-ACC-06 recovery codes compare ignoring case, spaces and hyphens', () => {
    expect(hashRecoveryCode('abcd-efgh-ijkl')).toEqual(hashRecoveryCode('ABCD EFGH IJKL'));
    expect(hashRecoveryCode('abcd-efgh-ijkl')).not.toEqual(hashRecoveryCode('abcd-efgh-ijkm'));
  });
});
