import { Aes256Gcm, CipherSuite, DhkemP256HkdfSha256, HkdfSha256 } from '@hpke/core';
import { webcrypto } from 'crypto';

// The browser side of the sealed handover, for the tests: the same construction and format as Unit 5's reference
// module docs/design/crypto/sealed.js (DV-34, DV-35), so the API is tested with real ciphertexts. HPKE base mode,
// DHKEM(P-256, HKDF-SHA256), HKDF-SHA256, AES-256-GCM; info TrustBazaar/game-credentials/v1; AAD order:<id>|key:<v>;
// a 2-byte length, the JSON and zero padding to 512-byte blocks, at most 4096 bytes.
const suite = new CipherSuite({ kem: new DhkemP256HkdfSha256(), kdf: new HkdfSha256(), aead: new Aes256Gcm() });
const INFO = new TextEncoder().encode('TrustBazaar/game-credentials/v1');
const BLOCK = 512;
const MAX = 4096;
const aad = (orderId: string, keyVersion: number) => new TextEncoder().encode(`order:${orderId}|key:${keyVersion}`);

export interface BuyerKey {
  pair: CryptoKeyPair;
  publicRaw: Uint8Array;
}

/** FR-GAM-07: a P-256 key pair whose private key cannot be exported. */
export async function generateBuyerKey(): Promise<BuyerKey> {
  const pair = (await webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])) as CryptoKeyPair;
  return { pair, publicRaw: new Uint8Array(await webcrypto.subtle.exportKey('raw', pair.publicKey)) };
}

function pad(obj: unknown): Uint8Array {
  const body = new TextEncoder().encode(JSON.stringify(obj));
  const total = Math.max(BLOCK, Math.ceil((body.length + 2) / BLOCK) * BLOCK);
  if (total > MAX) throw new Error('credentials too long');
  const out = new Uint8Array(total);
  out[0] = body.length >> 8;
  out[1] = body.length & 255;
  out.set(body, 2);
  return out;
}

/** FR-GAM-09: the seller's browser seals for the buyer's key. */
export async function seal(publicRaw: Uint8Array, orderId: string, keyVersion: number, credentials: unknown) {
  const recipientPublicKey = await suite.kem.deserializePublicKey(publicRaw);
  const sender = await suite.createSenderContext({ recipientPublicKey, info: INFO });
  const ciphertext = new Uint8Array(await sender.seal(pad(credentials), aad(orderId, keyVersion)));
  return { enc: new Uint8Array(sender.enc), ciphertext };
}

/** FR-GAM-11: the buyer's browser opens them with its key. */
export async function open(pair: CryptoKeyPair, orderId: string, keyVersion: number, enc: Uint8Array, ciphertext: Uint8Array): Promise<unknown> {
  const recipient = await suite.createRecipientContext({ recipientKey: pair, enc, info: INFO });
  const bytes = new Uint8Array(await recipient.open(ciphertext, aad(orderId, keyVersion)));
  const n = (bytes[0] << 8) | bytes[1];
  return JSON.parse(new TextDecoder().decode(bytes.slice(2, 2 + n)));
}

export const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64url');
export const unb64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64url'));
