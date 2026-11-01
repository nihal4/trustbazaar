import { describe, expect, it } from 'vitest';
import { ApiError } from '../lib/api.js';
import { translator } from './language/catalogue';
import { errorText } from './errors';

// docs/design/08_frontend.pdf, section 4.2, "Errors and messages".
describe('error messages', () => {
  const en = translator('en');
  const bn = translator('bn');

  it.each([
    [new ApiError(0, { title: 'network' }), /could not reach TrustBazaar/],
    [new ApiError(403, { type: '/problems/step-up-required' }), /enter the code we sent/],
    [new ApiError(403, { type: '/problems/forbidden' }), /not allowed/],
    [new ApiError(404, {}), /no longer exists/],
    [new ApiError(409, {}), /changed while you were looking/],
  ])('SEC-INP-06 a problem document is shown as a generic message (%#)', (error, text) => {
    expect(errorText(error, en, 'en')).toMatch(text);
  });

  it('SEC-INP-06 a server error quotes the correlation id, and nothing of the problem detail', () => {
    const e = new ApiError(500, { title: 'database exploded at line 12', correlationId: 'c0ffee12' });
    const text = errorText(e, en, 'en');
    expect(text).toContain('c0ffee12');
    expect(text).not.toContain('database');
  });

  it('NFR-USE-04 the wait after 429 is given in the page digits', () => {
    const e = new ApiError(429, { retryAfter: 45 });
    expect(errorText(e, en, 'en')).toContain('45 seconds');
    expect(errorText(e, bn, 'bn')).toContain('৪৫');
  });

  it('SEC-INP-06 an error that is not from the API gets the page message', () => {
    expect(errorText(new TypeError('x is undefined'), en, 'en')).toBe(en('shell.error.unexpected'));
  });
});
