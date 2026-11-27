import { signFileLink, verifyFileLink, type FileLinkClaims } from './file-links';

// SEC-DAT-04 at the unit level: a signed file link has exactly one valid spelling. These checks are exhaustive and deterministic, so
// they cannot pass or fail by chance (the integration test once swapped the last character of the signature and was accepted
// about 1 time in 16, because the last base64url character of a 32-byte HMAC has 2 unused bits).
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const key = 'k'.repeat(32);
const now = new Date('2026-11-25T12:00:00Z');
const claims = (n: number): FileLinkClaims => ({ f: `file-${n}`, s: `session-${n}`, p: n % 2 ? 'user' : 'staff', e: now.getTime() + 60_000 + n });

describe('SEC-DAT-04 signed file link spellings', () => {
  it('SEC-DAT-04 the canonical token is accepted', () => {
    const c = claims(1);
    expect(verifyFileLink(key, signFileLink(key, c), now)).toEqual(c);
  });

  it('SEC-DAT-04 changing any one character of the signature, to any other character, is refused', () => {
    const token = signFileLink(key, claims(2));
    const dot = token.indexOf('.');
    for (let i = dot + 1; i < token.length; i++) {
      for (const ch of ALPHABET) {
        if (ch === token[i]) continue;
        expect(verifyFileLink(key, token.slice(0, i) + ch + token.slice(i + 1), now)).toBeNull();
      }
    }
  });

  it('SEC-DAT-04 changing any one character of the claims part is refused', () => {
    const token = signFileLink(key, claims(3));
    const dot = token.indexOf('.');
    for (let i = 0; i < dot; i++) {
      const ch = ALPHABET[(ALPHABET.indexOf(token[i]) + 1) % 64];
      expect(verifyFileLink(key, token.slice(0, i) + ch + token.slice(i + 1), now)).toBeNull();
    }
  });

  it('SEC-DAT-04 the other spellings of the same signature (the last character carries 4 data bits) are refused, for every kind of last character', () => {
    const seen = new Set<string>();
    for (let n = 0; n < 600; n++) {
      const token = signFileLink(key, claims(n));
      const last = token[token.length - 1];
      seen.add(last);
      const group = ALPHABET.indexOf(last) >> 2; // the characters with the same 4 data bits spell the same signature
      for (let v = group * 4; v < group * 4 + 4; v++) {
        if (ALPHABET[v] === last) continue;
        expect(verifyFileLink(key, token.slice(0, -1) + ALPHABET[v], now)).toBeNull();
      }
    }
    expect(seen.size).toBe(16); // a 32-byte signature ends in one of 16 characters (its 2 spare bits are 0); the loop visited all of them
  });

  it('SEC-DAT-04 a token with extra or missing parts is refused', () => {
    const token = signFileLink(key, claims(4));
    expect(verifyFileLink(key, `${token}.x`, now)).toBeNull();
    expect(verifyFileLink(key, token.split('.')[0], now)).toBeNull();
    expect(verifyFileLink(key, `.${token.split('.')[1]}`, now)).toBeNull();
  });
});
