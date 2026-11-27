import { cookiesFor, STAFF_COOKIES, USER_COOKIES } from './cookies';

// I-51 and SEC-SES-04: staff sessions use their own cookies, also at the staff sign-in, which is a public route: a member who is signed in
// in the same browser must not have the member's session or CSRF token read there (it made the staff sign-in answer "not allowed").
describe('the cookies of a route', () => {
  it('I-51 a staff route uses the staff cookies, a member route the member\'s', () => {
    expect(cookiesFor({ kind: 'staff' } as never, '/api/v1/staff/me')).toBe(STAFF_COOKIES);
    expect(cookiesFor({ kind: 'user' } as never, '/api/v1/me')).toBe(USER_COOKIES);
  });

  it('I-51 SEC-SES-04 the public staff sign-in uses the staff cookies, so a member session in the same browser is not read there', () => {
    expect(cookiesFor({ kind: 'public' } as never, '/api/v1/staff/auth/signin')).toBe(STAFF_COOKIES);
    expect(cookiesFor({ kind: 'public' } as never, '/api/v1/auth/signin')).toBe(USER_COOKIES);
  });
});
