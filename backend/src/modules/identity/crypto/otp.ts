import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto';

// One-time codes and link tokens (SEC-AUTH-09, SEC-AUTH-10; Unit 1 section 5.5).
// An OTP is 6 digits from the CSPRNG. Only HMAC-SHA-256(code) under OTP_PEPPER is stored, so a database copy
// alone cannot be searched through the million possible codes. Comparison takes constant time.
// A link token is 256 random bits; only its SHA-256 is stored.
export function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function hashOtp(pepper: string, code: string): Buffer {
  return createHmac('sha256', pepper).update(code).digest();
}

export function otpMatches(pepper: string, code: string, stored: Buffer): boolean {
  const h = hashOtp(pepper, /^\d{6}$/.test(code) ? code : '');
  return stored.length === h.length && timingSafeEqual(h, stored);
}

export function generateLinkToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashLinkToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}
