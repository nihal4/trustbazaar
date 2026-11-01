// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { fakeBackend, json, noContent, problem, renderApp, standInMe } from '../../testing/app';

// The account and sign-in screens (IF-UI-01; docs/design/08_frontend.pdf, section 5.1; Unit 1
// sections 4.2 and 6.1 to 6.5).

afterEach(cleanup);

const type = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const tick = (cb: () => void) => act(async () => { cb(); await Promise.resolve(); });

describe('register', () => {
  const fillDetails = () => {
    type('Display name', 'Rahim');
    type('Mobile number', '০১৭১২-৩৪৫৬৭৮');
    type('E-mail address', 'rahim@example.com');
    type('Password', 'correct horse battery staple');
  };

  it('FR-PRV-01 the privacy notice is shown before any detail is sent: purposes, data, retention, recipients, location, choices', async () => {
    renderApp('/register', fakeBackend({}));
    const notice = await screen.findByRole('region', { name: 'How we use your information' });
    for (const heading of ['Why we use it', 'What we collect', 'How long we keep it', 'Who receives it', 'Where it is stored', 'Your choices']) {
      expect(within(notice).getByText(heading)).toBeTruthy();
    }
    expect(within(notice).getByText(/Payment records: 6 years/)).toBeTruthy();
  });

  it('FR-ACC-04 without the age confirmation and the acceptance nothing is sent, and the errors are listed', async () => {
    const be = fakeBackend({});
    renderApp('/register', be);
    await screen.findByRole('heading', { name: 'Create your account' });
    fillDetails();
    click('Create account');
    const summary = await screen.findByRole('alert');
    expect(summary.textContent).toContain('You must be 18 or older');
    expect(summary.textContent).toContain('Accept the terms of use');
    expect(document.activeElement).toBe(summary);
    expect(be.called('POST /auth/register')).toEqual([]);
  });

  it('FR-ACC-04 the account is created with the current terms and privacy versions, the age confirmation and the number in Unit 1 form', async () => {
    const be = fakeBackend({
      'POST /auth/register': json(202, { registrationId: 'r-1', resendAt: new Date(Date.now() + 60_000).toISOString() }),
      'POST /auth/register/verify': noContent(),
      'GET /me': [json(404, {}), json(200, standInMe)],
    });
    const doc = renderApp('/register?next=%2Forders%2F9', be);
    await screen.findByRole('heading', { name: 'Create your account' });
    fillDetails();
    fireEvent.click(screen.getByLabelText('I am 18 years old or older.'));
    fireEvent.click(screen.getByLabelText(/accept the terms of use/));
    click('Create account');

    await screen.findByRole('heading', { name: 'Enter the code' });
    expect(be.called('POST /auth/register')[0].body).toEqual({
      phone: '+8801712345678', email: 'rahim@example.com', displayName: 'Rahim', password: 'correct horse battery staple',
      termsVersion: '2026-11-01', privacyVersion: '2026-11-01', adultConfirmed: true,
    });
    expect(screen.getByRole('button', { name: /New code in \d+ s/ }).hasAttribute('disabled')).toBe(true);

    type('Code', '১২৩৪৫৬');
    click('Confirm');
    await waitFor(() => expect(doc.router.state.location.pathname).toBe('/orders/9'));
    expect(be.called('POST /auth/register/verify')[0].body).toEqual({ registrationId: 'r-1', code: '123456' });
  });

  it('FR-ACC-01 a password Unit 1 refuses is explained next to the field', async () => {
    const be = fakeBackend({
      'POST /auth/register': problem(422, 'password-rejected', { errors: [{ field: 'password', reason: 'common' }] }),
    });
    renderApp('/register', be);
    await screen.findByRole('heading', { name: 'Create your account' });
    fillDetails();
    fireEvent.click(screen.getByLabelText('I am 18 years old or older.'));
    fireEvent.click(screen.getByLabelText(/accept the terms of use/));
    click('Create account');
    await waitFor(() => expect(screen.getByLabelText('Password').getAttribute('aria-invalid')).toBe('true'));
    const described = screen.getByLabelText('Password').getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(described.split(' ').find((id) => id.endsWith('-error'))!)?.textContent).toMatch(/too common/);
  });
});

describe('sign in', () => {
  it('SEC-AUTH-05 every refusal reads the same, so the page never tells which accounts exist', async () => {
    const be = fakeBackend({
      'POST /auth/signin': [problem(401, 'signin-failed'), problem(400, 'validation-failed', { errors: ['login must be shorter'] })],
    });
    renderApp('/signin', be);
    await screen.findByRole('heading', { name: 'Sign in' });
    type('Mobile number or e-mail', 'nobody@example.com');
    type('Password', 'whatever');
    click('Sign in');
    const first = (await screen.findByRole('alert')).textContent;
    click('Sign in');
    await waitFor(() => expect(be.called('POST /auth/signin')).toHaveLength(2));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(first));
    expect(first).toBe('The number, e-mail or password is not correct.');
  });

  it('SEC-AUTH-04 the growing delay is a countdown on the button', async () => {
    const be = fakeBackend({ 'POST /auth/signin': problem(429, 'rate-limited', {}, { 'Retry-After': '42' }) });
    renderApp('/signin', be, 'bn');
    await screen.findByRole('heading', { name: 'সাইন ইন' });
    type('মোবাইল নম্বর বা ই-মেইল', '01712345678');
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
    type('Mobile number or e-mail', '+880 1712-345678');
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
    type('Mobile number or e-mail', 'rahim@example.com');
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
    expect((await screen.findByRole('status')).textContent).toMatch(/^If an account has this verified e-mail address/);
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
});
