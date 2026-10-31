import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import type { Keyring } from '../../../kernel/config/config';

// Field encryption (Unit 1 section 5.5; SEC-DAT-03): AES-256-GCM under FIELD_KEY_V{n}. A value is stored
// as one byte of key version, a 12-byte random IV, the ciphertext and the 16-byte tag. The associated data
// is the table, column and row id, so a ciphertext copied into another row or column fails to decrypt.
// The AES key is SHA-256 of FIELD_KEY_Vn, so every byte of the secret counts (K-01: at least 32 bytes).
// (U1-06 completes IdentityCrypto with blind indexes and file keys.)
export interface FieldContext {
  table: string;
  column: string;
  rowId: string;
}

const aad = (c: FieldContext) => Buffer.from(`${c.table}|${c.column}|${c.rowId}`, 'utf8');
const keyBytes = (keys: Keyring, version: number) => {
  const k = keys.key(version);
  if (!k) throw new Error(`field key version ${version} is not configured`);
  return createHash('sha256').update(k.reveal(), 'utf8').digest();
};

export function encryptField(keys: Keyring, plain: Buffer, ctx: FieldContext): Buffer {
  const version = keys.current;
  if (version > 255) throw new Error('field key versions above 255 do not fit the stored format');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBytes(keys, version), iv).setAAD(aad(ctx));
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([Buffer.from([version]), iv, body, cipher.getAuthTag()]);
}

/** The plaintext; throws if the value was altered, moved to another row or column, or its key is unknown. */
export function decryptField(keys: Keyring, blob: Buffer, ctx: FieldContext): Buffer {
  if (blob.length < 1 + 12 + 16) throw new Error('ciphertext too short');
  const version = blob[0];
  const iv = blob.subarray(1, 13);
  const tag = blob.subarray(blob.length - 16);
  const body = blob.subarray(13, blob.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', keyBytes(keys, version), iv).setAAD(aad(ctx));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}
