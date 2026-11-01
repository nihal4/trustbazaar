import { sign } from 'jsonwebtoken';
import { loadConfig } from '../../../kernel/config/config';
import { accessTokenStatus, signAccessToken, verifyAccessToken } from './access-token';
import { cookieValue } from './live-auth';

const base = {
  DATABASE_URL: 'postgres://u:p@h/db', REDIS_URL: 'redis://h:6379/0',
  JWT_KEY_V1: 'k'.repeat(32), FIELD_KEY_V1: 'f'.repeat(32), KYC_KEK_V1: 'q'.repeat(32), BIDX_KEY: 'b'.repeat(32),
  CSRF_KEY: 'c'.repeat(32), LINK_KEY: 'l'.repeat(32), OTP_PEPPER: 'o'.repeat(32),
  CALLBACK_STATE_KEY: 's'.repeat(32), HANDOVER_KEY: 'h'.repeat(32),
};
const keys = loadConfig(base).keys.jwt;
const now = new Date('2026-11-01T00:00:00Z');
const sec = Math.floor(now.getTime() / 1000);
const claims = { sub: '11111111-1111-4111-8111-111111111111', sid: '22222222-2222-4222-8222-222222222222', pt: 'user' as const };

describe('access token', () => {
  it('SEC-SES-01 a token signed with the current key verifies, with its claims', () => {
    const t = signAccessToken(keys, claims, 900, now);
    expect(verifyAccessToken(keys, t, now)).toEqual({ ...claims, iat: sec, exp: sec + 900 });
  });

  it('SEC-SES-01 an expired token is refused', () => {
    const t = signAccessToken(keys, claims, 900, now);
    expect(verifyAccessToken(keys, t, new Date(now.getTime() + 901_000))).toBeNull();
  });

  it.each([
    ['alg none', () => sign({ sid: claims.sid, pt: 'user' }, '', { algorithm: 'none', subject: claims.sub, keyid: 'v1' })],
    ['HS512', () => sign({ sid: claims.sid, pt: 'user' }, 'k'.repeat(32), { algorithm: 'HS512', subject: claims.sub, keyid: 'v1' })],
    ['an unknown key id', () => sign({ sid: claims.sid, pt: 'user' }, 'k'.repeat(32), { algorithm: 'HS256', subject: claims.sub, keyid: 'v9' })],
    ['no key id', () => sign({ sid: claims.sid, pt: 'user' }, 'k'.repeat(32), { algorithm: 'HS256', subject: claims.sub })],
    ['another key', () => sign({ sid: claims.sid, pt: 'user' }, 'x'.repeat(32), { algorithm: 'HS256', subject: claims.sub, keyid: 'v1' })],
    ['a session id that is not a UUID', () => sign({ sid: 'abc', pt: 'user' }, 'k'.repeat(32), { algorithm: 'HS256', subject: claims.sub, keyid: 'v1' })],
    ['an unknown principal type', () => sign({ sid: claims.sid, pt: 'root' }, 'k'.repeat(32), { algorithm: 'HS256', subject: claims.sub, keyid: 'v1' })],
  ])('SEC-SES-01 a token with %s is refused', (_case, make) => {
    expect(verifyAccessToken(keys, make(), now)).toBeNull();
  });

  it('SEC-SES-01 a tampered payload is refused', () => {
    const [h, , s] = signAccessToken(keys, claims, 900, now).split('.');
    const forged = Buffer.from(JSON.stringify({ sub: claims.sub, sid: claims.sid, pt: 'staff', iat: sec, exp: sec + 900 })).toString('base64url');
    expect(verifyAccessToken(keys, `${h}.${forged}.${s}`, now)).toBeNull();
  });

  it('SEC-DAT-05 after rotation the new key signs, and tokens of the previous key still verify', () => {
    const rotated = loadConfig({ ...base, JWT_KEY_V2: 'n'.repeat(32) }).keys.jwt;
    const old = signAccessToken(keys, claims, 900, now);
    const fresh = signAccessToken(rotated, claims, 900, now);
    expect(JSON.parse(Buffer.from(fresh.split('.')[0], 'base64url').toString()).kid).toBe('v2');
    expect(verifyAccessToken(rotated, old, now)).not.toBeNull();
    expect(verifyAccessToken(rotated, fresh, now)).not.toBeNull();
  });

  it('I-51 an expired but well-signed token is told apart from a bad one, so the client knows to refresh', () => {
    const t = signAccessToken(keys, claims, 900, now);
    expect(accessTokenStatus(keys, t, now)).toEqual({ ...claims, iat: sec, exp: sec + 900 });
    expect(accessTokenStatus(keys, t, new Date(now.getTime() + 901_000))).toBe('expired');
    expect(accessTokenStatus(keys, `${t.slice(0, -4)}AAAA`, new Date(now.getTime() + 901_000))).toBe('invalid');
    expect(accessTokenStatus(keys, sign({ sid: claims.sid, pt: 'user' }, 'k'.repeat(32), { algorithm: 'HS512', keyid: 'v1', subject: claims.sub }), now)).toBe('invalid');
    expect(accessTokenStatus(keys, 'nonsense', now)).toBe('invalid');
  });

  it('SEC-SES-07 the handshake reads the access cookie by its exact name', () => {
    expect(cookieValue('a=1; __Host-tb_at=tok%2Ben; b=2', '__Host-tb_at')).toBe('tok+en');
    expect(cookieValue('x__Host-tb_at=evil; __Host-tb_atx=evil', '__Host-tb_at')).toBeUndefined();
    expect(cookieValue(undefined, '__Host-tb_at')).toBeUndefined();
    expect(cookieValue('__Host-tb_at=%E0%A4%A', '__Host-tb_at')).toBeUndefined();
  });
});
