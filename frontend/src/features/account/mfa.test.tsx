// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, configure, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { fakeBackend, json, noContent, problem, renderApp, standInMe, type Call } from '../../testing/app';

// MFA settings on the security page (FR-ACC-06, SEC-AUTH-01, SEC-AUTH-08; Unit 1 section 6.5 and the
// U1-12 decisions).

configure({ asyncUtilTimeout: 3000 });   // the first lazy load of the page and the QR module
afterEach(cleanup);

const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const URI = `otpauth://totp/TrustBazaar:rahim%40example.com?secret=${SECRET}&issuer=TrustBazaar`;
const CODES = Array.from({ length: 10 }, (_, i) => `ABCDE-${String(i).padStart(5, 'F')}`);

const type = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));

/** A backend whose MFA state follows the calls made to it. */
function mfaBackend(extra: Record<string, ((c: Call) => Response | Promise<Response>) | ((c: Call) => Response)[]> = {}, startOn = false) {
  const state = { on: startOn };
  const be = fakeBackend({
    'GET /me': () => json(200, { ...standInMe, mfaEnabled: state.on })(),
    'GET /auth/sessions': json(200, []),
    'POST /me/mfa/totp': json(201, { otpauthUri: URI, secret: SECRET }),
    'POST /me/mfa/totp/confirm': [problem(400, 'otp-failed'), () => { state.on = true; return json(200, { recoveryCodes: CODES })(); }],
    'POST /auth/step-up/start': json(200, { method: 'totp' }),
    'POST /auth/step-up/verify': json(200, { grant: 'grant-1', expiresInSeconds: 300 }),
    ...extra,
  });
  return { be, state };
}

async function stepUp(code = '123456') {
  const dialog = await screen.findByRole('dialog', { name: 'Confirm it is you' });
  await within(dialog).findByText(/authenticator app/);
  fireEvent.change(within(dialog).getByLabelText('Code'), { target: { value: code } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
}

describe('turning the authenticator app on', () => {
  it('FR-ACC-06 the QR code is drawn in the page as SVG shapes, named without the secret; the key and the link are shown too', async () => {
    const { be } = mfaBackend();
    renderApp('/account/security', be);
    fireEvent.click(await screen.findByRole('button', { name: 'Turn on the authenticator app' }));

    const qr = await screen.findByRole('img', { name: 'QR code to add TrustBazaar to your authenticator app' });
    expect(qr.tagName.toLowerCase()).toBe('svg');
    expect(qr.getAttribute('aria-label')).not.toContain(SECRET);
    expect(qr.querySelector('path')?.getAttribute('d')).toMatch(/^M\d+ \d+h1v1h-1z/);
    expect(qr.outerHTML).not.toMatch(/data:|https?:|<image|href/);
    expect(document.querySelector('img, canvas')).toBeNull();

    expect(screen.getByText('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open in the authenticator app' }).getAttribute('href')).toBe(URI);
    expect(screen.getByRole('button', { name: 'Copy the key' })).toBeTruthy();
  });

  it('FR-ACC-06 a wrong first code is explained on the field, without signing out; the right one turns MFA on and shows the ten codes once', async () => {
    const { be } = mfaBackend();
    const doc = renderApp('/account/security', be);
    fireEvent.click(await screen.findByRole('button', { name: 'Turn on the authenticator app' }));
    await screen.findByRole('img', { name: /QR code/ });

    type('Code from the app', '000000');
    click('Turn on');
    expect(await screen.findByText(/The code is not correct. Check that the app shows TrustBazaar/)).toBeTruthy();
    expect(screen.queryByText(/You have been signed out/)).toBeNull();
    expect(doc.router.state.location.pathname).toBe('/account/security');

    type('Code from the app', '১২৩৪৫৬');
    click('Turn on');
    const list = await screen.findByRole('list', { name: 'Recovery codes' });
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual(CODES);
    expect(be.called('POST /me/mfa/totp/confirm')[1].body).toEqual({ code: '123456' });

    const done = screen.getByRole('button', { name: 'Done' });
    expect(done.hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByLabelText('I have saved these codes somewhere safe.'));
    fireEvent.click(done);
    expect(await screen.findByText('The authenticator app is on.')).toBeTruthy();
    expect(screen.queryByText(CODES[0])).toBeNull();                         // shown once
    expect(await screen.findByRole('button', { name: 'Make new recovery codes' })).toBeTruthy();
  });

  it('FR-ACC-06 the secret and the codes are kept only in the page: not in browser storage, not in the query cache', async () => {
    const { be } = mfaBackend();
    const doc = renderApp('/account/security', be);
    fireEvent.click(await screen.findByRole('button', { name: 'Turn on the authenticator app' }));
    await screen.findByRole('img', { name: /QR code/ });
    type('Code from the app', '000000');
    click('Turn on');
    await screen.findByText(/The code is not correct/);
    type('Code from the app', '123456');
    click('Turn on');
    await screen.findByRole('list', { name: 'Recovery codes' });

    // eslint-disable-next-line no-restricted-globals
    expect([localStorage.length, sessionStorage.length]).toEqual([0, 0]);
    const cached = JSON.stringify(doc.queryClient.getQueryCache().getAll().map((q) => q.state.data));
    expect(cached).not.toContain(SECRET);
    expect(cached).not.toContain(CODES[0]);
  });
});

describe('with the authenticator app on', () => {
  it('SEC-AUTH-08 new recovery codes need step-up, and replace the old ones', async () => {
    const { be } = mfaBackend({ 'POST /me/mfa/recovery-codes': json(200, { recoveryCodes: CODES }) }, true);
    renderApp('/account/security', be);
    expect(await screen.findByText(/The old ones stop working at once/)).toBeTruthy();
    click('Make new recovery codes');
    await stepUp();
    expect(await screen.findByText(/Here are your new recovery codes. The old ones no longer work/)).toBeTruthy();
    const [call] = be.called('POST /me/mfa/recovery-codes');
    expect(call.headers.get('X-Step-Up')).toBe('grant-1');
    expect(be.called('POST /auth/step-up/start')[0].body).toEqual({ action: 'recovery.regenerate' });
  });

  it('SEC-AUTH-01 turning it off asks for a new password when the current one is too short, then turns it off', async () => {
    const { be, state } = mfaBackend({
      'DELETE /me/mfa/totp': [
        problem(422, 'password-rejected', { errors: [{ field: 'newPassword', reason: 'required-without-mfa' }] }),
        () => { state.on = false; return noContent()(); },
      ],
    }, true);
    renderApp('/account/security', be);
    await screen.findByRole('heading', { name: 'Turn off the authenticator app' });
    type('Code from the app', '123456');
    click('Turn off');
    await stepUp();
    expect(await screen.findByText(/too short to use without the authenticator app. Choose a new one of at least 15/)).toBeTruthy();

    type('Code from the app', '234567');
    type('New password (if needed)', 'a much longer passphrase');
    click('Turn off');
    await stepUp('345678');
    expect(await screen.findByText(/The authenticator app is off and your password has been changed/)).toBeTruthy();

    const calls = be.called('DELETE /me/mfa/totp');
    expect(calls.map((c) => c.body)).toEqual([{ code: '123456' }, { code: '234567', newPassword: 'a much longer passphrase' }]);
    expect(calls.every((c) => c.headers.get('X-Step-Up') === 'grant-1')).toBe(true);
    expect(be.called('POST /auth/step-up/start').map((c) => c.body)).toEqual([{ action: 'mfa.disable' }, { action: 'mfa.disable' }]);
    expect(await screen.findByRole('button', { name: 'Turn on the authenticator app' })).toBeTruthy();
  });

  it('SEC-AUTH-01 turning it off takes a current app code only: a wrong one is explained on the field', async () => {
    const { be } = mfaBackend({ 'DELETE /me/mfa/totp': problem(400, 'otp-failed') }, true);
    renderApp('/account/security', be);
    await screen.findByRole('heading', { name: 'Turn off the authenticator app' });
    type('Code from the app', '999999');
    click('Turn off');
    await stepUp();
    expect(await screen.findByText(/recovery codes are not accepted here/)).toBeTruthy();
    expect(screen.queryByText(/You have been signed out/)).toBeNull();
  });

  it('FR-ACC-06 a state changed elsewhere (mfa-state) shows the current state again', async () => {
    const { be, state } = mfaBackend({
      'POST /me/mfa/recovery-codes': () => { state.on = false; return problem(409, 'mfa-state', { errors: [{ field: 'mfa', reason: 'already-off' }] })(); },
    }, true);
    renderApp('/account/security', be);
    fireEvent.click(await screen.findByRole('button', { name: 'Make new recovery codes' }));
    await stepUp();
    expect(await screen.findByText('This setting changed elsewhere. The page now shows the current state.')).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Turn on the authenticator app' })).toBeTruthy();
  });
});
