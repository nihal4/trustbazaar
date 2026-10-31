import { generateLinkToken, generateOtp, hashLinkToken, hashOtp, otpMatches } from './otp';
import { checkPassword, commonPasswords } from './password-policy';

describe('password policy', () => {
  it('SEC-AUTH-01 at least 15 characters without MFA, 8 with MFA', () => {
    expect(checkPassword('a quiet morning', { mfa: false })).toBeNull(); // 15
    expect(checkPassword('a quiet mornin', { mfa: false })).toBe('too-short');
    expect(checkPassword('blue kettle', { mfa: true })).toBeNull();
    expect(checkPassword('kettle7', { mfa: true })).toBe('too-short');
  });

  it('SEC-AUTH-01 a 15-character Bangla passphrase counts its letters, and spaces and symbols are accepted', () => {
    const bangla = 'আমার সোনার বাংলা আমি'; // 20 code points
    expect([...bangla].length).toBeGreaterThanOrEqual(15);
    expect(checkPassword(bangla, { mfa: false })).toBeNull();
    expect(checkPassword('   spaces & ✓ symbols !  ', { mfa: false })).toBeNull();
  });

  it('SEC-AUTH-01 at least 64 characters are accepted, and DV-8 caps the length at 256', () => {
    expect(checkPassword('long walk to the river '.repeat(3), { mfa: false })).toBeNull(); // 69
    expect(checkPassword('x'.repeat(240) + ' tail of a phrase', { mfa: false })).toBe('too-long');
  });

  it('SEC-AUTH-02 common and breached passwords are refused, ignoring letter case', () => {
    expect(commonPasswords().size).toBeGreaterThan(40_000);
    expect(checkPassword('password', { mfa: true })).toBe('common');
    expect(checkPassword('PassWord123', { mfa: true })).toBe('common');
    expect(checkPassword('123456789012345', { mfa: false })).toBe('common');
  });

  it('SEC-AUTH-02 the site name and the person’s own name, number and e-mail name are refused', () => {
    const context = { displayName: 'Rahim Uddin', phoneE164: '+8801712345678', email: 'rahim.dev@example.com' };
    expect(checkPassword('my Trust Bazaar account', { mfa: false })).toBe('context');
    expect(checkPassword('rahim loves mangoes', { mfa: false, context })).toBe('context');
    expect(checkPassword('call me on 01712345678', { mfa: false, context })).toBe('context');
    expect(checkPassword('rahim.dev is my handle', { mfa: false, context })).toBe('context');
    expect(checkPassword('green tea at dawn by the river', { mfa: false, context })).toBeNull();
  });
});

describe('one-time codes', () => {
  const pepper = 'p'.repeat(32);

  it('SEC-AUTH-09 an OTP is 6 random digits, stored only as an HMAC under the pepper', () => {
    const codes = new Set(Array.from({ length: 200 }, generateOtp));
    for (const c of codes) expect(c).toMatch(/^\d{6}$/);
    expect(codes.size).toBeGreaterThan(190);
    const h = hashOtp(pepper, '123456');
    expect(h).toHaveLength(32);
    expect(h.equals(hashOtp('q'.repeat(32), '123456'))).toBe(false);
    expect(otpMatches(pepper, '123456', h)).toBe(true);
    expect(otpMatches(pepper, '123457', h)).toBe(false);
    expect(otpMatches(pepper, '12345', h)).toBe(false);
  });

  it('SEC-AUTH-10 a link token carries 256 random bits; only its SHA-256 is stored', () => {
    const t = generateLinkToken();
    expect(Buffer.from(t, 'base64url')).toHaveLength(32);
    expect(t).not.toBe(generateLinkToken());
    expect(hashLinkToken(t)).toHaveLength(32);
  });
});
