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
const PURPOSES: FilePurpose[] = ['kyc', 'ownership_proof', 'dispute_evidence', 'dispute_video', 'chat_image', 'data_export'];

export function parseVaultKey(key: string): VaultKey | null {
  const m = /^v1\.([a-z_]+)\.([0-9a-f-]{36})\.([0-9a-f]{48})\.([A-Za-z0-9_-]+)$/.exec(key);
  if (!m || !(PURPOSES as string[]).includes(m[1])) return null;
  return { purpose: m[1] as FilePurpose, fileId: m[2], storageKey: m[3], wrappedDek: Buffer.from(m[4], 'base64url') };
}

/** The kind of a video by its first bytes: WebM (EBML header) or an MP4/QuickTime container ('ftyp' box); null when it is neither. */
const VIDEO_BRANDS = ['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'M4V ', 'MSNV', 'dash', 'qt  '];
export function videoKind(bytes: Uint8Array): 'video/webm' | 'video/mp4' | null {
  if (bytes.length > 12 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'video/webm';
  if (bytes.length > 12 && String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]) === 'ftyp') {
    // the major brand must be a video one: not a HEIC or AVIF picture, M4A audio or 3GP
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    return VIDEO_BRANDS.includes(brand) ? 'video/mp4' : null;
  }
  return null;
}

export const mimeOf = (purpose: FilePurpose, bytes?: Uint8Array) =>
  purpose === 'data_export' ? 'application/octet-stream' : purpose === 'dispute_video' ? (bytes ? videoKind(bytes) : null) ?? 'video/mp4' : 'image/jpeg';
