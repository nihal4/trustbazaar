// @vitest-environment jsdom
import { createHash } from 'crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { fakeBackend, json, noContent, problem, renderApp, standInMe } from '../../testing/app';

// The account and sign-in screens (IF-UI-01; docs/design/08_frontend.pdf, section 5.1; Unit 1
// sections 4.2 and 6.1 to 6.5).

afterEach(cleanup);

const type = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
/** sign-in is two steps: the number or e-mail first, then (after Continue or Enter) the password */
const enterLogin = async (value: string, label: string | RegExp = 'Mobile number or e-mail', cont = 'Continue', password: string | RegExp = 'Password') => {
  type(label, value);
  fireEvent.click(screen.getByRole('button', { name: cont }));
  await screen.findByLabelText(password);
};
const tick = (cb: () => void) => act(async () => { cb(); await Promise.resolve(); });

describe('register', () => {
  const started = json(202, { registrationId: 'r-1', resendAt: new Date(Date.now() + 60_000).toISOString() });
  /** registration is six steps, one question each: the name, the e-mail address, the password twice, the e-mail code, the number, the terms */
  const next = (name = 'Continue') => click(name);
  const toEmail = async () => { await screen.findByRole('heading', { name: 'Create your account' }); type('Full name', 'Rahim Uddin'); next(); await screen.findByLabelText('E-mail address'); };
  const toPassword = async () => { await toEmail(); type('E-mail address', 'rahim@example.com'); next(); await screen.findByLabelText('Password'); };
  const toCode = async () => {
    await toPassword();
    type('Password', 'correct horse battery staple');
    type('Confirm password', 'correct horse battery staple');
    next();
    await screen.findByRole('heading', { name: 'Enter the code' });
  };
  const toNumber = async () => { await toCode(); type('Code', '১২৩৪৫৬'); next('Confirm'); await screen.findByLabelText('Mobile number'); };
  const toTerms = async () => { await toNumber(); type('Mobile number', '০১৭১২-৩৪৫৬৭৮'); next(); await screen.findByLabelText('I am 18 years old or older.'); };

  it('FR-ACC-01 the page asks one thing at a time, in order, and nothing is sent before the password step is done', async () => {
    const be = fakeBackend({ 'POST /auth/register': started });
    renderApp('/register', be);
    await toPassword();
    expect(screen.queryByLabelText('Mobile number')).toBeNull();
    expect(be.called('POST /auth/register')).toEqual([]);
    type('Password', 'correct horse battery staple');
    type('Confirm password', 'correct horse battery staple');
    next();
    await screen.findByRole('heading', { name: 'Enter the code' });
    expect(be.called('POST /auth/register')[0].body).toEqual({ email: 'rahim@example.com', displayName: 'Rahim Uddin', password: 'correct horse battery staple' });
    expect(screen.getByText(/We sent a 6-digit code to rahim@example.com/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Send again in \d+ s/ }).getAttribute('aria-disabled')).toBe('true');
  });

  it('FR-ACC-01 a short name, a malformed e-mail address and two different passwords are turned back on the page', async () => {
    const be = fakeBackend({ 'POST /auth/register': started });
    renderApp('/register', be);
    await screen.findByRole('heading', { name: 'Create your account' });
    type('Full name', 'R');
    next();
    expect((await screen.findByRole('alert')).textContent).toMatch(/display name of 2 to 40/);
    type('Full name', 'Rahim Uddin');
    next();
    await screen.findByLabelText('E-mail address');
    type('E-mail address', 'rahim@');
    next();
    expect((await screen.findByRole('alert')).textContent).toMatch(/Enter an e-mail address/);
    type('E-mail address', 'rahim@example.com');
    next();
    await screen.findByLabelText('Password');
    type('Password', 'correct horse battery staple');
    type('Confirm password', 'correct horse battery stapl');
    next();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/two passwords are not the same/));
    expect(screen.getByLabelText('Confirm password').getAttribute('aria-invalid')).toBe('true');
    expect(be.called('POST /auth/register')).toEqual([]);
  });

  it('FR-ACC-13 an e-mail address whose domain cannot receive mail is turned back, and nothing about accounts is asked', async () => {
    const be = fakeBackend({ 'POST /auth/login-check': json(200, { ok: false, reason: 'domain' }) });
    renderApp('/register', be);
    await toEmail();
    type('E-mail address', 'nihal@examle.com');
    next();
    expect((await screen.findByRole('alert')).textContent).toMatch(/Nothing can be delivered to examle.com/);
    expect(screen.queryByLabelText('Password')).toBeNull();
    expect(be.called('POST /auth/register')).toEqual([]);
  });

  it('FR-ACC-04 without the age confirmation and the acceptance nothing is sent, and each is named', async () => {
    const be = fakeBackend({ 'POST /auth/register': started, 'POST /auth/register/verify': noContent() });
    renderApp('/register', be);
    await toTerms();
    next('Create account');
    expect((await screen.findByRole('alert')).textContent).toContain('You must be 18 or older');
    fireEvent.click(screen.getByLabelText('I am 18 years old or older.'));
    next('Create account');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Accept the terms of use'));
    expect(be.called('POST /auth/register/complete')).toEqual([]);
  });

  it('FR-ACC-04 the account is made with the number, the age confirmation and the current terms and privacy versions, and the person goes to sign-in with the e-mail filled in', async () => {
    const be = fakeBackend({ 'POST /auth/register': started, 'POST /auth/register/verify': noContent(), 'POST /auth/register/complete': noContent() });
    const doc = renderApp('/register?next=%2Forders%2F9', be);
    await toTerms();
    fireEvent.click(screen.getByLabelText('I am 18 years old or older.'));
    fireEvent.click(screen.getByRole('checkbox', { name: /I accept the/ }));
    next('Create account');
    await waitFor(() => expect(doc.router.state.location.pathname).toBe('/signin'));
    expect(be.called('POST /auth/register/verify')[0].body).toEqual({ registrationId: 'r-1', code: '123456' });
    expect(be.called('POST /auth/register/complete')[0].body).toEqual({
      registrationId: 'r-1', phone: '+8801712345678', password: 'correct horse battery staple', adultConfirmed: true,
      termsVersion: '2026-11-27', privacyVersion: '2026-11-01',
    });
    expect(((await screen.findByLabelText('Mobile number or e-mail')) as HTMLInputElement).value).toBe('rahim@example.com');
    expect(screen.getByRole('status').textContent).toBe('Your account is ready. Sign in to continue.');
    expect(doc.router.state.location.search).toBe('?next=%2Forders%2F9');
  });

  it('SEC-AUTH-02 a password Unit 1 refuses is explained on the step that sent it', async () => {
    const be = fakeBackend({ 'POST /auth/register': problem(422, 'password-rejected', { errors: [{ field: 'password', reason: 'common' }] }) });
    renderApp('/register', be);
    await toPassword();
    type('Password', 'correct horse battery staple');
    type('Confirm password', 'correct horse battery staple');
    next();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/too common/));
    expect(screen.getByLabelText('Password').getAttribute('aria-invalid')).toBe('true');
    expect(screen.queryByRole('heading', { name: 'Enter the code' })).toBeNull();
  });

  it('SEC-AUTH-09 a wrong or an expired code is said on the code step; a new code can be asked for', async () => {
    const be = fakeBackend({
      'POST /auth/register': started,
      'POST /auth/register/verify': [problem(400, 'otp-failed', {}), problem(410, 'otp-expired', {})],
      'POST /auth/register/resend': started,
    });
    renderApp('/register', be);
    await toCode();
    type('Code', '111111');
    next('Confirm');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/not correct/));
    next('Confirm');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/expired or was tried too many times/));
    type('Code', '12');
    next('Confirm');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/6-digit code from the e-mail/));
  });

  it('FR-ACC-04 the terms and conditions open in a dialog with the whole text in a region that scrolls; Escape closes it and the focus returns to the link', async () => {
    renderApp('/register', fakeBackend({ 'POST /auth/register': started, 'POST /auth/register/verify': noContent() }));
    await toTerms();
    const link = screen.getByRole('button', { name: 'Terms and Conditions' });
    link.focus();
    fireEvent.click(link);
    const dialog = await screen.findByRole('dialog', { name: 'Terms and Conditions' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const body = within(dialog).getByRole('region', { name: 'Terms and Conditions' });
    expect(body.getAttribute('tabindex')).toBe('0');
    expect(within(body).getAllByRole('heading', { level: 3 }).length).toBeGreaterThanOrEqual(15);
    expect(within(body).getByText(/The commission and the delivery margin are shown/)).toBeTruthy();
    expect(within(dialog).getByText('Version 2026-11-27')).toBeTruthy();
    expect(document.activeElement).toBe(body);
    // the box is not ticked by reading
    expect((screen.getByRole('checkbox', { name: /I accept the/ }) as HTMLInputElement).checked).toBe(false);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(link);
    // the privacy notice opens the same way
    fireEvent.click(screen.getByRole('button', { name: 'Privacy Notice' }));
    expect(within(await screen.findByRole('dialog', { name: 'How we use your information' })).getByText(/Payment records: 6 years/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('FR-ACC-03 a refused sign-up (the number or the e-mail has an account) says so generically and starts again at the name', async () => {
    const be = fakeBackend({
      'POST /auth/register': started, 'POST /auth/register/verify': noContent(),
      'POST /auth/register/complete': problem(409, 'registration-refused', {}),
    });
    renderApp('/register', be);
    await toTerms();
    fireEvent.click(screen.getByLabelText('I am 18 years old or older.'));
    fireEvent.click(screen.getByRole('checkbox', { name: /I accept the/ }));
    next('Create account');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/could not create an account with these details/));
    expect(screen.getByLabelText('Full name')).toBeTruthy();
  });

  it.each([[422], [400]])('FR-ACC-04 a %s naming termsVersion or privacyVersion as not current asks for a reload, not a generic error', async (status) => {
    const be = fakeBackend({
      'POST /auth/register': started, 'POST /auth/register/verify': noContent(),
      'POST /auth/register/complete': problem(status, 'validation-failed',
        { errors: [{ field: 'termsVersion', reason: 'not-current' }, { field: 'privacyVersion', reason: 'not-current' }] }),
    });
    renderApp('/register', be);
    await toTerms();
    fireEvent.click(screen.getByLabelText('I am 18 years old or older.'));
    fireEvent.click(screen.getByRole('checkbox', { name: /I accept the/ }));
    next('Create account');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/terms or privacy notice have just changed/));
    expect(screen.getByRole('alert').textContent).not.toMatch(/Something went wrong|not valid/);
  });
});

describe('help pages', () => {
  it('FR-PRV-01 the privacy notice and the terms and conditions are real pages, one linking to the other', async () => {
    const doc = renderApp('/help/privacy', fakeBackend({}));
    expect(await screen.findByRole('heading', { level: 1, name: 'How we use your information' })).toBeTruthy();
    expect(screen.getByText('Version 2026-11-01')).toBeTruthy();
    expect(screen.getByText(/Payment records: 6 years/)).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'Terms and Conditions' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Terms and Conditions' })).toBeTruthy();
    expect(doc.router.state.location.pathname).toBe('/help/terms');
    expect(screen.getByText('Version 2026-11-27')).toBeTruthy();
    expect(screen.getByText(/publisher may prohibit the transfer of an account/)).toBeTruthy();
  });

  it('NFR-USE-04 the terms page is in Bangla too', async () => {
    renderApp('/help/terms', fakeBackend({}), 'bn');
    expect(await screen.findByRole('heading', { level: 1, name: 'শর্তাবলি' })).toBeTruthy();
    expect(screen.getByText('সংস্করণ ২০২৬-১১-২৭')).toBeTruthy();
    expect(screen.getByText(/গেমের প্রকাশক অ্যাকাউন্ট হস্তান্তর নিষেধ করতে পারে/)).toBeTruthy();
  });
});

describe('sign in', () => {
  it('SEC-AUTH-05 every refusal reads the same, so the page never tells which accounts exist', async () => {
    const be = fakeBackend({
      'POST /auth/signin': [problem(401, 'signin-failed'), problem(400, 'validation-failed', { errors: ['login must be shorter'] })],
    });
    renderApp('/signin', be);
    await screen.findByRole('heading', { name: 'Sign in' });
    await enterLogin('nobody@example.com');
    type('Password', 'whatever');
    click('Sign in');
    const first = (await screen.findByRole('alert')).textContent;
    click('Sign in');
    await waitFor(() => expect(be.called('POST /auth/signin')).toHaveLength(2));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(first));
    expect(first).toBe('The number, e-mail or password is not correct.');
  });

  it('SEC-ABU-02 when the server asks for the human check, the page answers it and the sign-in goes on', async () => {
    const challenge = { id: 'c-1', algorithm: 'sha256', prefix: '5e1f', difficulty: 8, expiresAt: '2026-11-23T00:05:00Z' };
    const be = fakeBackend({
      'POST /auth/signin': [problem(428, 'human-verification-required', { challenge }), json(200, { mfaRequired: true })],
    });
    renderApp('/signin', be);
    await screen.findByRole('heading', { name: 'Sign in' });
    await enterLogin('rahim@example.com');
    type('Password', 'correct horse');
    click('Sign in');
    await waitFor(() => expect(be.called('POST /auth/signin')).toHaveLength(2));
    const [first, second] = be.called('POST /auth/signin');
    expect(first.headers.get('X-Human-Proof')).toBeNull();
    expect(second.body).toEqual(first.body);
    const [id, nonce] = second.headers.get('X-Human-Proof')!.split(':');
    expect(id).toBe('c-1');
    expect(createHash('sha256').update(`5e1f:${nonce}`).digest()[0]).toBe(0);
    expect(screen.queryByText(/not correct|too long|wrong/i)).toBeNull();                      // no refusal is shown (the alert region itself is always there)
  });

  it('SEC-AUTH-04 the growing delay is a countdown on the button', async () => {
    const be = fakeBackend({ 'POST /auth/signin': problem(429, 'rate-limited', {}, { 'Retry-After': '42' }) });
    renderApp('/signin', be, 'bn');
    await screen.findByRole('heading', { name: 'সাইন ইন' });
    await enterLogin('01712345678', 'মোবাইল নম্বর বা ই-মেইল', 'এগিয়ে যান', 'পাসওয়ার্ড');
    type('পাসওয়ার্ড', 'whatever');
    fireEvent.click(screen.getByRole('button', { name: 'সাইন ইন' }));
    const button = await screen.findByRole('button', { name: /৪২ সেকেন্ড পরে/ });
    expect(button.hasAttribute('disabled')).toBe(true);
  });

  it('FR-ACC-06 with MFA on, a second step takes the authenticator or recovery code; then the user goes where they were going', async () => {
    const be = fakeBackend({
      'POST /auth/signin': json(200, { mfaRequired: true }),
      'POST /auth/signin/mfa': [problem(401, 'mfa-failed'), noContent()],
    });
    const doc = renderApp('/signin?next=%2Faccount%2Fsecurity', be);
    await screen.findByRole('heading', { name: 'Sign in' });
    await enterLogin('+880 1712-345678');
    type('Password', 'correct horse battery staple');
    click('Sign in');
    await screen.findByRole('heading', { name: 'Enter your second code' });
    expect(be.called('POST /auth/signin')[0].body).toEqual({ login: '+8801712345678', password: 'correct horse battery staple' });

    type('Code', 'abcd-efgh-ijkl');
    click('Sign in');
    expect((await screen.findByRole('alert')).textContent).toBe('The code is not correct.');
    click('Sign in');
    await waitFor(() => expect(doc.router.state.location.pathname).toBe('/account/security'));
  });

  it('SEC-WEB-03 the return path after sign-in stays on this site', async () => {
    const be = fakeBackend({ 'POST /auth/signin': noContent() });
    const doc = renderApp(`/signin?next=${encodeURIComponent('//evil.example/phish')}`, be);
    await screen.findByRole('heading', { name: 'Sign in' });
    await enterLogin('rahim@example.com');
    type('Password', 'x');
    click('Sign in');
    await waitFor(() => expect(doc.router.state.location.pathname).toBe('/account'));
  });
});

describe('password reset', () => {
  it('FR-ACC-07 the answer is the same for every login; an e-mail gets a link', async () => {
    const be = fakeBackend({ 'POST /auth/password/forgot': json(202) });
    renderApp('/reset', be);
    await screen.findByRole('heading', { name: 'Reset your password' });
    type('Mobile number or e-mail', 'someone@example.com');
    click('Send');
    expect((await screen.findByText(/^If an account has this verified e-mail address/)).getAttribute('role')).toBe('status');
    expect(screen.queryByLabelText('Code')).toBeNull();
  });

  it('SEC-AUTH-10 a code reset asks for the second factor when MFA is on, and spends nothing until it is given', async () => {
    const be = fakeBackend({
      'POST /auth/password/forgot': json(202),
      'POST /auth/password/reset': [problem(403, 'mfa-required'), noContent()],
    });
    renderApp('/reset', be);
    await screen.findByRole('heading', { name: 'Reset your password' });
    type('Mobile number or e-mail', '01712345678');
    click('Send');
    await screen.findByLabelText('Code');
    type('Code', '123456');
    type('New password', 'a new long passphrase');
    click('Save new password');
    await screen.findByLabelText('Authenticator or recovery code');
    type('Authenticator or recovery code', '654321');
    click('Save new password');
    expect(await screen.findByText(/Your password has been changed/)).toBeTruthy();
    const [first, second] = be.called('POST /auth/password/reset').map((c) => c.body);
    expect(first).toEqual({ phone: '+8801712345678', code: '123456', newPassword: 'a new long passphrase' });
    expect(second).toEqual({ phone: '+8801712345678', code: '123456', newPassword: 'a new long passphrase', mfaCode: '654321' });
  });

  it('FR-ACC-07 the reset link: the token is taken from the fragment, removed from the address, and sent once', async () => {
    const token = 'A'.repeat(43);
    const be = fakeBackend({ 'POST /auth/password/reset': noContent() });
    const doc = renderApp(`/reset-password#token=${token}`, be);
    await screen.findByRole('heading', { name: 'Reset your password' });
    await waitFor(() => expect(doc.router.state.location.hash).toBe(''));
    type('New password', 'a new long passphrase');
    click('Save new password');
    await screen.findByText(/Your password has been changed/);
    expect(be.called('POST /auth/password/reset').map((c) => c.body)).toEqual([{ token, newPassword: 'a new long passphrase' }]);
  });

  it('FR-ACC-07 a malformed or spent link says so and offers a new one', async () => {
    renderApp('/reset-password#token=short', fakeBackend({}));
    expect(await screen.findByText('This link is not valid or has expired.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ask for a new link or code' }).getAttribute('href')).toBe('/reset');
  });
});

describe('e-mail verification link', () => {
  it('FR-ACC-02 the token is sent once, even though development mode runs effects twice', async () => {
    const token = 'b'.repeat(43);
    const be = fakeBackend({ 'POST /auth/email/verify': noContent() });
    renderApp(`/verify-email#token=${token}`, be);
    expect(await screen.findByText('Your e-mail address is verified.')).toBeTruthy();
    expect(be.called('POST /auth/email/verify').map((c) => c.body)).toEqual([{ token }]);
  });
});

describe('account and security', () => {
  it('IF-UI-01 the account page reads GET /me: masked number, verified e-mail, the identity check', async () => {
    const be = fakeBackend({ 'GET /me': json(200, standInMe) });
    renderApp('/account', be);
    expect(await screen.findByRole('heading', { name: 'Your account' })).toBeTruthy();
    expect(screen.getByText('***678')).toBeTruthy();
    expect(screen.getByText(/rahim@example.com \(verified\)/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Verify your identity' }).getAttribute('href')).toBe('/account/kyc');
    expect(screen.getByRole('link', { name: 'Account' })).toBeTruthy();
  });

  it('FR-REV-04 the profile shows the rating, the completed deals and the month the member joined, with the initial in the photo place', async () => {
    const be = fakeBackend({
      'GET /me': json(200, { ...standInMe, kycStatus: 'verified', memberSince: '2026-11-10T08:00:00Z' }),
      [`GET /users/${standInMe.id}/trust`]: json(200, { userId: standInMe.id, averageRating: 4.5, ratingCount: 12, completedTransactions: 7, badges: { verified: true, pro: false } }),
    });
    renderApp('/account', be);
    expect(await screen.findByText('4.5 out of 5 (12)')).toBeTruthy();
    expect(screen.getByText('7')).toBeTruthy();
    expect(screen.getByText('November 2026')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Rahim Verified' })).toBeTruthy();   // the verified badge follows the name
    expect(screen.getByText('Identity check: Verified')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Personal information' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Verification' })).toBeTruthy();
  });

  it('IF-UI-01 without a session the account page asks the user to sign in, returning to it', async () => {
    renderApp('/account', fakeBackend({ 'GET /me': problem(401, 'session-ended'), 'POST /auth/refresh': problem(401, 'session-ended') }));
    expect(await screen.findByRole('heading', { name: 'Sign in to continue' })).toBeTruthy();
    const links = screen.getAllByRole('link', { name: /^Sign in/ }).map((a) => a.getAttribute('href'));
    expect(links).toContain(`/signin?next=${encodeURIComponent('/account')}`);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('FR-ACC-08 sessions show device and last use in Dhaka time, mark this device, and others can be ended', async () => {
    const be = fakeBackend({
      'GET /auth/sessions': json(200, [
        { id: 's-1', current: true, device: 'Chrome on Android', approxLocation: null, createdAt: '2026-10-20T04:00:00Z', lastSeenAt: '2026-11-01T12:00:00Z' },
        { id: 's-2', current: false, device: 'Firefox on Windows', approxLocation: null, createdAt: '2026-10-01T04:00:00Z', lastSeenAt: '2026-10-31T18:30:00Z' },
      ]),
      'POST /auth/sessions/end-others': json(200, { ended: 1 }),
    });
    renderApp('/account/security', be);
    await screen.findByRole('heading', { name: 'Where you are signed in' });
    expect(screen.getByText('Chrome on Android').textContent).toContain('this device');
    expect(screen.getByText(/Last used Sun 1 Nov 2026, 6:00 pm/)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Sign out this device' })).toHaveLength(1);
    click('Sign out every other device');
    expect(await screen.findByText('1 other sessions have been ended.')).toBeTruthy();
    expect(be.called('POST /auth/sessions/end-others')[0].headers.get('X-CSRF-Token')).toBe('csrf-1');
  });

  it('FR-ACC-12 the security page shows whether the code by e-mail is on; turning it on again needs no step-up, turning it off asks for it first', async () => {
    let on = false;
    const be = fakeBackend({
      'GET /auth/sessions': json(200, []),
      'GET /me': () => json(200, { ...standInMe, emailVerified: true, emailTwoStep: on })(),
      'POST /me/security/email-code/enable': () => { on = true; return json(200, { emailTwoStep: true })(); },
      'POST /auth/step-up/start': json(200, { method: 'sms', resendAt: new Date(Date.now() + 60_000).toISOString() }),
    });
    renderApp('/account/security', be);
    const section = (await screen.findByRole('heading', { name: 'Code by e-mail at sign-in' })).closest('section') as HTMLElement;
    expect(await within(section).findByText(/^Off\. You sign in with your password alone/)).toBeTruthy();
    fireEvent.click(within(section).getByRole('button', { name: 'Turn on the e-mail code' }));
    expect(await within(section).findByText('The code by e-mail is on.')).toBeTruthy();
    expect(be.called('POST /auth/step-up/start')).toHaveLength(0);                             // turning on asks for nothing more
    expect(await within(section).findByText(/^On\. After your password/)).toBeTruthy();
    fireEvent.click(within(section).getByRole('button', { name: 'Turn off the e-mail code' }));
    await screen.findByRole('dialog', { name: 'Confirm it is you' });                         // turning off is behind step-up
    expect(be.called('POST /auth/signin')).toHaveLength(0);
  });

  it('SEC-AUTH-08 a password change asks for the step-up code first and sends the grant once', async () => {
    const be = fakeBackend({
      'GET /auth/sessions': json(200, []),
      'POST /auth/step-up/start': json(200, { method: 'sms', resendAt: new Date(Date.now() + 60_000).toISOString() }),
      'POST /auth/step-up/verify': [problem(400, 'otp-failed'), json(200, { grant: 'grant-1', expiresInSeconds: 300 })],
      'POST /auth/password/change': noContent(),
    });
    renderApp('/account/security', be);
    await screen.findByRole('heading', { name: 'Change your password' });
    type('Current password', 'old one');
    type('New password', 'a new long passphrase');
    click('Change password');

    const dialog = await screen.findByRole('dialog', { name: 'Confirm it is you' });
    await within(dialog).findByText(/We sent a 6-digit code/);
    fireEvent.change(within(dialog).getByLabelText('Code'), { target: { value: '000000' } });
    await tick(() => fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' })));
    expect(await within(dialog).findByText('The code is not correct. Check it and try again.')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('Code'), { target: { value: '123456' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText(/Your password has been changed/)).toBeTruthy();
    const change = be.called('POST /auth/password/change');
    expect(change).toHaveLength(1);
    expect(change[0].headers.get('X-Step-Up')).toBe('grant-1');
    expect(be.called('POST /auth/step-up/verify')[1].body).toEqual({ action: 'password.change', code: '123456' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('SEC-AUTH-08 cancelling the step-up sends nothing and shows no error', async () => {
    const be = fakeBackend({
      'GET /auth/sessions': json(200, []),
      'POST /auth/step-up/start': json(200, { method: 'totp' }),
    });
    renderApp('/account/security', be);
    await screen.findByRole('heading', { name: 'Change your e-mail address' });
    type('New e-mail address', 'new@example.com');
    click('Send a link');
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText(/authenticator app/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(be.called('POST /me/email/change')).toEqual([]);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('IF-UI-01 the account sections share one row of tabs, the current one marked (docs/design/10_visual.md, AC-ACC-3)', async () => {
    const be = fakeBackend({ 'GET /me': json(200, standInMe), 'GET /auth/sessions': json(200, []) });
    renderApp('/account/security', be);
    const tabs = await screen.findByRole('navigation', { name: 'Your account' });
    const links = within(tabs).getAllByRole('link');
    expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Profile', '/account'], ['Security', '/account/security'], ['Notifications', '/notifications'],
      ['Messages', '/messages'], ['Your data', '/account/privacy'],
    ]);
    expect(links.filter((a) => a.getAttribute('aria-current') === 'page').map((a) => a.textContent)).toEqual(['Security']);
  });
});

describe('sign-in and registration layout', () => {
  it('FR-ACC-05 sign-in carries no notice about its human check, and the way to an account is in the foot of the card, after the form (AC-ACC-2, as changed 2026-11-27)', async () => {
    renderApp('/signin?next=%2Forders', fakeBackend({}));
    const button = await screen.findByRole('button', { name: 'Continue' });
    expect(screen.queryByText('Protected by a short check in your browser. No puzzles.')).toBeNull();
    const link = screen.getByRole('link', { name: 'Create an account' });
    expect(link.getAttribute('href')).toBe(`/register?next=${encodeURIComponent('/orders')}`);
    expect(button.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();   // after the button, not above the field
    expect(screen.getByText(/^New to TrustBazaar\?/)).toBeTruthy();                                      // not 'welcome back' and 'new' in one breath
    expect(screen.queryByText('Your money waits with us')).toBeNull();                              // no advertising on the sign-in page
  });

  it('FR-ACC-12 with the default second step a code is asked after the password, sent to the e-mail (masked); the box remembers the device; a new code can be asked for after the wait', async () => {
    const be = fakeBackend({
      'POST /auth/signin': json(200, { mfaRequired: true, method: 'email', emailHint: 'r***m@example.com', resendAfter: 60 }),
      'POST /auth/signin/mfa/resend': json(200, { resendAfter: 60 }),
      'POST /auth/signin/mfa': noContent(),
    });
    const doc = renderApp('/signin', be);
    await screen.findByRole('heading', { name: 'Sign in' });
    await enterLogin('rahim@example.com');
    type('Password', 'correct horse battery staple');
    click('Sign in');
    expect(await screen.findByRole('heading', { name: 'Check your e-mail' })).toBeTruthy();
    expect(screen.getByText('We sent a 6-digit code to r***m@example.com. It is valid for 10 minutes.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Send again in \d+ s$/ }).getAttribute('aria-disabled')).toBe('true'); // 60 seconds first
    const remember = screen.getByLabelText('Remember this device for 30 days') as HTMLInputElement;
    expect(remember.checked).toBe(false);                                                   // never ticked for the user
    type('Code', '482 913'.replace(' ', ''));
    fireEvent.click(remember);
    click('Sign in');
    await waitFor(() => expect(doc.router.state.location.pathname).toBe('/account'));
    expect(be.called('POST /auth/signin/mfa')[0].body).toEqual({ code: '482913', remember: true });
  });

  it('FR-ACC-12 the authenticator code has the same box; an ended sign-in goes back to the start', async () => {
    const be = fakeBackend({
      'POST /auth/signin': json(200, { mfaRequired: true }),
      'POST /auth/signin/mfa': problem(401, 'session-ended'),
    });
    renderApp('/signin', be);
    await screen.findByRole('heading', { name: 'Sign in' });
    await enterLogin('rahim@example.com');
    type('Password', 'x');
    click('Sign in');
    await screen.findByRole('heading', { name: 'Enter your second code' });
    expect(screen.getByLabelText('Remember this device for 30 days')).toBeTruthy();
    type('Code', '123456');
    click('Sign in');
    expect(await screen.findByText('This sign-in took too long. Enter your password again.')).toBeTruthy();
    expect(await screen.findByLabelText('Mobile number or e-mail')).toBeTruthy();
  });

  it('FR-ACC-05 sign-in is one fresh page: no header, search, notices, footer or logo; the language switch only', async () => {
    renderApp('/signin', fakeBackend({}));
    await screen.findByRole('heading', { name: 'Sign in' });
    expect(screen.queryByRole('contentinfo')).toBeNull();
    expect(screen.queryByRole('search')).toBeNull();
    expect(screen.queryByRole('textbox', { name: /Search/ })).toBeNull();
    expect(screen.queryByText('Sell an item')).toBeNull();
  });

  it('FR-ACC-13 an entry that is not a mobile number or an e-mail of a valid form is turned back on the page: nothing is sent; an e-mail whose domain cannot receive mail is turned back after the check, with no sign-in tried', async () => {
    const be = fakeBackend({
      'POST /auth/login-check': (c) => json(200, (c.body as { login: string }).login.endsWith('@examle.com') ? { ok: false, reason: 'domain' } : { ok: true })(),
    });
    renderApp('/signin', be);
    await screen.findByRole('heading', { name: 'Sign in' });
    for (const bad of ['c', 'nihal', 'nihal@', 'nihal@gmail', 'a b@c.com', '1234', 'nihal@@gmail.com', '.nihal@gmail.com', 'nihal@-gmail.com']) {
      type('Mobile number or e-mail', bad);
      click('Continue');
      expect((await screen.findByRole('alert')).textContent).toBe('Enter a valid mobile number or e-mail address.');
      expect(screen.queryByLabelText('Password')).toBeNull();                                // it did not move on
    }
    expect(be.called('POST /auth/login-check')).toHaveLength(0);                             // and nothing was sent
    type('Mobile number or e-mail', 'nihal@examle.com');
    click('Continue');
    expect((await screen.findByRole('alert')).textContent).toBe('Nothing can be delivered to examle.com. Check the part after the @.');
    expect(screen.queryByLabelText('Password')).toBeNull();
    expect(be.called('POST /auth/signin')).toHaveLength(0);                                  // the sign-in was never tried
    type('Mobile number or e-mail', 'nihal@gmail.com');
    click('Continue');
    expect(await screen.findByLabelText('Password')).toBeTruthy();
    type('Password', 'x');
  });

  it('FR-ACC-05 each step is a history entry: Back goes from the password to the number; a message is tied to its field (invalid, described by the heading and the message) and said in an alert region that is always there; the tab names the step', async () => {
    const be = fakeBackend({ 'POST /auth/login-check': json(200, { ok: true }), 'POST /auth/signin': problem(401, 'signin-failed') });
    const doc = renderApp('/signin', be);
    await screen.findByRole('heading', { name: 'Sign in' });
    expect(document.title).toBe('Sign in – TrustBazaar');
    expect(document.querySelectorAll('[role="alert"]').length).toBeGreaterThan(0);               // there before any message
    type('Mobile number or e-mail', 'c');
    click('Continue');
    const field = screen.getByLabelText('Mobile number or e-mail');
    await screen.findByText('Enter a valid mobile number or e-mail address.');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(field.getAttribute('aria-describedby')).toBe('signin-head signin-message');
    await enterLogin('rahim@example.com');
    type('Password', 'wrong');
    click('Sign in');
    await screen.findByText('The number, e-mail or password is not correct.');
    expect(screen.getByLabelText('Password').getAttribute('aria-invalid')).toBe('true');
    doc.router.navigate(-1);                                                                      // the browser's Back
    expect(await screen.findByLabelText('Mobile number or e-mail')).toBeTruthy();
    expect(screen.queryByLabelText('Password')).toBeNull();
  });

  it('FR-ACC-05 the password asks for itself after the number or e-mail; Change goes back; the eye shows and hides what was typed', async () => {
    renderApp('/signin', fakeBackend({}));
    await screen.findByRole('heading', { name: 'Sign in' });
    expect(screen.queryByLabelText('Password')).toBeNull();                       // not before the first step
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Enter a valid mobile number or e-mail address.');
    await enterLogin('rahim@example.com');
    expect(screen.getByText('rahim@example.com')).toBeTruthy();
    const field = screen.getByLabelText('Password') as HTMLInputElement;
    expect(field.type).toBe('password');
    type('Password', 'correct horse');
    const eye = screen.getByRole('button', { name: 'Show password' });
    expect(eye.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(eye);
    expect(field.type).toBe('text');
    expect(field.value).toBe('correct horse');
    expect(screen.getByRole('button', { name: 'Hide password' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    expect(((await screen.findByLabelText('Mobile number or e-mail')) as HTMLInputElement).value).toBe('rahim@example.com');
    expect(screen.queryByLabelText('Password')).toBeNull();                        // the password is asked again, not kept
  });

  it('SEC-ABU-02 registration has no notice about its human check either, and a refusal stands under its field and is tied to it (AC-ACC-2)', async () => {
    renderApp('/register', fakeBackend({}));
    await screen.findByRole('heading', { name: 'Create your account' });
    expect(screen.queryByText('Protected by a short check in your browser. No puzzles.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    const alert = await screen.findByRole('alert');
    const input = screen.getByLabelText('Full name');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toContain(alert.querySelector('p')!.id);
    expect(input.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
