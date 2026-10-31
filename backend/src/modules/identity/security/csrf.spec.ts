import { Secret } from '../../../kernel/config/config';
import { csrfMatches, csrfToken } from './csrf';

const key = new Secret('CSRF_KEY', 'c'.repeat(32));
const sid = '22222222-2222-4222-8222-222222222222';
const other = '33333333-3333-4333-8333-333333333333';

describe('CSRF token', () => {
  it('SEC-SES-04 header and cookie carrying this session\'s HMAC pass', () => {
    const t = csrfToken(key, sid);
    expect(csrfMatches(key, sid, t, t)).toBe(true);
  });

  it('SEC-SES-04 a token of another session is refused, even when header and cookie agree', () => {
    const t = csrfToken(key, other);
    expect(csrfMatches(key, sid, t, t)).toBe(false);
  });

  it.each([
    ['the header is missing', undefined, 'cookie'],
    ['the cookie is missing', 'header', undefined],
    ['both are empty', '', ''],
  ])('SEC-SES-04 refused when %s', (_case, header, cookie) => {
    expect(csrfMatches(key, sid, header, cookie)).toBe(false);
  });

  it('SEC-SES-04 a header that differs from the cookie is refused', () => {
    expect(csrfMatches(key, sid, csrfToken(key, sid), `${csrfToken(key, sid)}x`)).toBe(false);
  });

  it('SEC-SES-04 a token made with another key is refused', () => {
    const forged = csrfToken(new Secret('CSRF_KEY', 'z'.repeat(32)), sid);
    expect(csrfMatches(key, sid, forged, forged)).toBe(false);
  });
});
