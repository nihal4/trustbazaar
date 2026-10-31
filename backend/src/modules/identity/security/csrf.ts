import { createHash, createHmac, timingSafeEqual } from 'crypto';
import type { Secret } from '../../../kernel/config/config';

// Signed double-submit CSRF token (SEC-SES-04): the readable CSRF cookie holds an HMAC of the session id,
// and the client copies it into X-CSRF-Token. A request passes only if header and cookie are equal and
// both are the HMAC of this request's session, so a token from another session or a forged cookie fails.
export function csrfToken(key: Secret, sessionId: string): string {
  return createHmac('sha256', key.reveal()).update(`csrf:${sessionId}`).digest('base64url');
}

const same = (a: string, b: string) => {
  // Compare digests, so the lengths match and the comparison takes constant time.
  const h = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(h(a), h(b));
};

export function csrfMatches(key: Secret, sessionId: string, header: unknown, cookie: unknown): boolean {
  if (typeof header !== 'string' || typeof cookie !== 'string' || header === '' || cookie === '') return false;
  const expected = csrfToken(key, sessionId);
  return same(header, cookie) && same(header, expected);
}
