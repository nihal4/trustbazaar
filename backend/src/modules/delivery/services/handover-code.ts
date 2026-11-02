import { createHmac, timingSafeEqual } from 'crypto';

// The handover code (docs/design/04_delivery.pdf section 6.4; DV-28; FR-DLV-06). Never stored: derived on each request
// as HMAC-SHA-256(HANDOVER_KEY, orderId || ':' || codeVersion), the first 8 bytes as an unsigned integer, mod 10^6,
// padded to 6 digits. A new version (an operator's unlock) is a new code; the old one stops working.
export function deriveCode(key: string | Buffer, orderId: string, version: number): string {
  const mac = createHmac('sha256', key).update(`${orderId}:${version}`).digest();
  return (mac.readBigUInt64BE(0) % 1_000_000n).toString().padStart(6, '0');
}

/** Constant-time comparison of an entry with the expected code; anything but 6 digits is simply wrong. */
export function codeMatches(entered: string, expected: string): boolean {
  const e = entered.trim();
  const a = Buffer.from(/^\d{6}$/.test(e) ? e : '------');
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) && /^\d{6}$/.test(e);
}
