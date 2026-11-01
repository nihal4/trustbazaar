import type { FilePurpose } from '../crypto/file-vault';

/**
 * The vault key other units keep: "v1.<purpose>.<file id>.<storage name>.<wrapped data key>". The wrapped key
 * travels with it because only the owning unit's row knows the file; the key-encryption key never leaves here.
 */
export interface VaultKey {
  purpose: FilePurpose;
  fileId: string;
  storageKey: string;
  wrappedDek: Buffer;
}
const PURPOSES: FilePurpose[] = ['kyc', 'ownership_proof', 'dispute_evidence', 'chat_image', 'data_export'];

export function parseVaultKey(key: string): VaultKey | null {
  const m = /^v1\.([a-z_]+)\.([0-9a-f-]{36})\.([0-9a-f]{48})\.([A-Za-z0-9_-]+)$/.exec(key);
  if (!m || !(PURPOSES as string[]).includes(m[1])) return null;
  return { purpose: m[1] as FilePurpose, fileId: m[2], storageKey: m[3], wrappedDek: Buffer.from(m[4], 'base64url') };
}

export const mimeOf = (purpose: FilePurpose) => (purpose === 'data_export' ? 'application/octet-stream' : 'image/jpeg');
