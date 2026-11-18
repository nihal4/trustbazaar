// TrustBazaar - Unit 5 reference implementation of the sealed credential handover (browser side).
// Runs only in the buyer's and seller's browsers. The server never sees a private key or plaintext
// (SEC-GAM-01). HPKE (RFC 9180) base mode with DHKEM(P-256, HKDF-SHA256), HKDF-SHA256 and
// AES-256-GCM, through @hpke/core, which is built only on the Web Cryptography API (SEC-DAT-10,
// C-4: no construction of our own).
import { Aes256Gcm, CipherSuite, DhkemP256HkdfSha256, HkdfSha256 } from "@hpke/core";

const suite = new CipherSuite({ kem: new DhkemP256HkdfSha256(), kdf: new HkdfSha256(), aead: new Aes256Gcm() });
const INFO = new TextEncoder().encode("TrustBazaar/game-credentials/v1");          // DV-35
const BLOCK = 512, MAX = 4096;                                                       // DV-34
const aad = (orderId, keyVersion) => new TextEncoder().encode(`order:${orderId}|key:${keyVersion}`);

// FR-GAM-07: a P-256 key pair whose private key can never be exported
export async function generateBuyerKey() {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));   // 65 bytes, 0x04...
  return { pair, publicRaw };
}

// the key pair is kept in IndexedDB of this browser only (structured clone keeps it non-extractable)
function db() {
  return new Promise((ok, fail) => {
    const r = indexedDB.open("tb-game-keys", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("keys");
    r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error);
  });
}
export async function storeKey(orderId, version, pair) {
  const d = await db();
  await new Promise((ok, fail) => { const t = d.transaction("keys", "readwrite");
    t.objectStore("keys").put(pair, `${orderId}:${version}`); t.oncomplete = ok; t.onerror = () => fail(t.error); });
}
export async function loadKey(orderId, version) {
  const d = await db();
  return new Promise((ok, fail) => { const r = d.transaction("keys").objectStore("keys").get(`${orderId}:${version}`);
    r.onsuccess = () => ok(r.result || null); r.onerror = () => fail(r.error); });
}

// FR-GAM-08: first 80 bits of SHA-256 over the raw public key, five groups of four hex digits (DV-36)
export async function fingerprint(publicRaw) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", publicRaw));
  const hex = [...h.slice(0, 10)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex.match(/.{4}/g).join("-");
}

// DV-34: 2-byte length, the JSON, zero padding to a multiple of 512 bytes; at most 4096 bytes
function pad(obj) {
  const body = new TextEncoder().encode(JSON.stringify(obj));
  const total = Math.max(BLOCK, Math.ceil((body.length + 2) / BLOCK) * BLOCK);
  if (total > MAX) throw new Error("credentials too long");
  const out = new Uint8Array(total);
  out[0] = body.length >> 8; out[1] = body.length & 255; out.set(body, 2);
  return out;
}
function unpad(bytes) {
  const n = (bytes[0] << 8) | bytes[1];
  return JSON.parse(new TextDecoder().decode(bytes.slice(2, 2 + n)));
}

// FR-GAM-09: the seller's browser seals the credentials for the buyer's current key
export async function seal(publicRaw, orderId, keyVersion, credentials) {
  const recipientPublicKey = await suite.kem.deserializePublicKey(publicRaw);
  const sender = await suite.createSenderContext({ recipientPublicKey, info: INFO });
  const ciphertext = new Uint8Array(await sender.seal(pad(credentials), aad(orderId, keyVersion)));
  return { enc: new Uint8Array(sender.enc), ciphertext };
}

// FR-GAM-11, FR-GAM-13: the buyer's browser opens them with the stored, non-extractable key
export async function open(pair, orderId, keyVersion, enc, ciphertext) {
  const recipient = await suite.createRecipientContext({ recipientKey: pair, enc, info: INFO });
  return unpad(new Uint8Array(await recipient.open(ciphertext, aad(orderId, keyVersion))));
}
