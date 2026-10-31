import { decode, sign, verify } from 'jsonwebtoken';
import type { Keyring } from '../../../kernel/config/config';

// The access token (Unit 1 section 7.1): a JWT, HS256 only, with the key version as kid; claims sub, sid,
// pt, iat, exp (SEC-SES-01). It only names the session: AuthGuard still loads the session on every request.
export interface AccessClaims {
  sub: string;
  sid: string;
  pt: 'user' | 'staff';
  iat: number;
  exp: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === 'string' && UUID.test(s);

export function signAccessToken(
  keys: Keyring,
  claims: { sub: string; sid: string; pt: 'user' | 'staff' },
  ttlSeconds: number,
  now: Date,
): string {
  const iat = Math.floor(now.getTime() / 1000);
  return sign({ sid: claims.sid, pt: claims.pt, iat, exp: iat + ttlSeconds }, keys.key(keys.current)!.reveal(), {
    algorithm: 'HS256',
    keyid: `v${keys.current}`,
    subject: claims.sub,
  });
}

/** The claims of a valid token, or null: wrong algorithm, unknown key id, bad signature, expired, or malformed. */
export function verifyAccessToken(keys: Keyring, token: string, now: Date): AccessClaims | null {
  const header = decode(token, { complete: true })?.header;
  const version = /^v([1-9]\d*)$/.exec(header?.kid ?? '')?.[1];
  const key = version ? keys.key(Number(version)) : undefined;
  if (!header || header.alg !== 'HS256' || !key) return null;
  try {
    const c = verify(token, key.reveal(), { algorithms: ['HS256'], clockTimestamp: Math.floor(now.getTime() / 1000) });
    if (typeof c !== 'object' || !isUuid(c.sub) || !isUuid(c.sid) || (c.pt !== 'user' && c.pt !== 'staff')) return null;
    if (typeof c.iat !== 'number' || typeof c.exp !== 'number') return null;
    return { sub: c.sub, sid: c.sid, pt: c.pt, iat: c.iat, exp: c.exp };
  } catch {
    return null;
  }
}
