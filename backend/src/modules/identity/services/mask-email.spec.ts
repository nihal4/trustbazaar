import { maskEmail } from './signin.service';

describe('the e-mail address shown at sign-in', () => {
  it('FR-ACC-12 the address is masked: enough to recognise, not to learn', () => {
    expect(maskEmail('rahim@example.com')).toBe('r***m@example.com');
    expect(maskEmail('ab@example.com')).toBe('a@example.com');
    expect(maskEmail('a@example.com')).toBe('a@example.com');
  });
});
