import { createHmac, timingSafeEqual } from 'crypto';

// Signed file links (Unit 1 section 6.7 "Protected files"; SEC-DAT-04, CP-31). The token names the file,
// the session that asked for it, whether that is a user or a staff session, and the expiry, authenticated
// with HMAC-SHA-256 under LINK_KEY. Using the link needs the same session, so a leaked link is useless.
export interface FileLinkClaims {
  f: string; // kyc_files.id
  s: string; // session id
  p: 'user' | 'staff';
  e: number; // expiry, ms since the epoch
}

const mac = (key: string, body: string) => createHmac('sha256', key).update(`file-link|${body}`).digest();

export function signFileLink(key: string, c: FileLinkClaims): string {
  const body = Buffer.from(JSON.stringify(c)).toString('base64url');
  return `${body}.${mac(key, body).toString('base64url')}`;
}

/** The claims if the token is authentic and not expired, else null. */
export function verifyFileLink(key: string, token: string, now: Date): FileLinkClaims | null {
  const [body, sig] = token.split('.');
  if (!body || !sig || token.split('.').length !== 2) return null;
  const given = Buffer.from(sig, 'base64url');
  const expected = mac(key, body);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const c = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as FileLinkClaims;
    if (typeof c.f !== 'string' || typeof c.s !== 'string' || (c.p !== 'user' && c.p !== 'staff') || typeof c.e !== 'number') return null;
    return c.e > now.getTime() ? c : null;
  } catch {
    return null;
  }
}
