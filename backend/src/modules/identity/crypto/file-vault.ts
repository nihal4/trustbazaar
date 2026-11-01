import { Inject, Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { join } from 'path';
import { TbConfig } from '../../../kernel/config/config';
import { TB_CONFIG } from '../../../kernel/config/config.provider';

// FileVault (Unit 1 section 5.5 "Images", section 6.6; SEC-DAT-02). Each file gets a fresh 256-bit data key
// and is encrypted with AES-256-GCM, with the file id as associated data. The data key is wrapped with the
// key-encryption key KYC_KEK_V{n} (also AES-256-GCM, file id as associated data) and stored with the file's
// row, never on the volume. Files are written under random names with mode 0600 to the purpose's volume.
// Erasing deletes the file; the caller sets wrapped_dek to NULL (crypto-shredding).
// Stored form: 12-byte IV | ciphertext | 16-byte tag. Wrapped key: 1-byte KEK version | IV | key | tag.
export type FilePurpose = 'kyc';

export interface SealedFile {
  storageKey: string;
  wrappedDek: Buffer;
  keyVersion: number;
  sha256: Buffer;
  size: number;
}

const kekBytes = (config: TbConfig, version: number) => {
  const k = config.keys.kycKek.key(version);
  if (!k) throw new Error(`KYC_KEK version ${version} is not configured`);
  return createHash('sha256').update(k.reveal(), 'utf8').digest();
};

function gcm(key: Buffer, plain: Buffer, aad: Buffer): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv).setAAD(aad);
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([iv, body, c.getAuthTag()]);
}

function ungcm(key: Buffer, sealed: Buffer, aad: Buffer): Buffer {
  const d = createDecipheriv('aes-256-gcm', key, sealed.subarray(0, 12)).setAAD(aad);
  d.setAuthTag(sealed.subarray(sealed.length - 16));
  return Buffer.concat([d.update(sealed.subarray(12, sealed.length - 16)), d.final()]);
}

@Injectable()
export class FileVault {
  constructor(@Inject(TB_CONFIG) private readonly config: TbConfig) {}

  private dir(purpose: FilePurpose): string {
    return join(this.config.filesRoot, purpose);
  }

  /** Encrypts and writes the bytes for the row `fileId`; returns what the row must keep. */
  async seal(purpose: FilePurpose, fileId: string, bytes: Buffer): Promise<SealedFile> {
    const dek = randomBytes(32);
    const aad = Buffer.from(fileId, 'utf8');
    const version = this.config.keys.kycKek.current;
    const wrappedDek = Buffer.concat([Buffer.from([version]), gcm(kekBytes(this.config, version), dek, aad)]);
    const storageKey = randomUUID().replace(/-/g, '') + randomBytes(8).toString('hex');
    await fs.mkdir(this.dir(purpose), { recursive: true, mode: 0o700 });
    await fs.writeFile(join(this.dir(purpose), storageKey), gcm(dek, bytes, aad), { mode: 0o600, flag: 'wx' });
    return { storageKey, wrappedDek, keyVersion: version, sha256: createHash('sha256').update(bytes).digest(), size: bytes.length };
  }

  /** The plaintext; throws if the file, its key or its row id do not match. */
  async open(purpose: FilePurpose, fileId: string, storageKey: string, wrappedDek: Buffer): Promise<Buffer> {
    const aad = Buffer.from(fileId, 'utf8');
    const dek = ungcm(kekBytes(this.config, wrappedDek[0]), wrappedDek.subarray(1), aad);
    return ungcm(dek, await fs.readFile(join(this.dir(purpose), this.safeKey(storageKey))), aad);
  }

  /** Deletes the file (the caller removes the wrapped key from its row). Missing files are already erased. */
  async erase(purpose: FilePurpose, storageKey: string): Promise<void> {
    await fs.rm(join(this.dir(purpose), this.safeKey(storageKey)), { force: true });
  }

  private safeKey(storageKey: string): string {
    if (!/^[0-9a-f]{48}$/.test(storageKey)) throw new Error('not a storage key');
    return storageKey;
  }
}
