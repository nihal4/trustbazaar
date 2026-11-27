// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, configure, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { placeholders } from '../../lib/i18n.js';
import { fakeBackend, json, noContent, problem, renderApp, standInMe, type Call } from '../../testing/app';
import en from '../../messages/en/privacy.json';
import bn from '../../messages/bn/privacy.json';

// The privacy screens (FR-PRV-03, FR-ACC-11, DV-49; U8-09): a copy of one's data after step-up, once in 7 days, its
// download behind a signed link while it lasts; closing the account after step-up, refused with the reasons while
// something is open.

configure({ asyncUtilTimeout: 3000 });
afterEach(() => cleanup());

const HOUR = 3_600_000;
const iso = (offset: number) => new Date(Date.now() + offset).toISOString();
type Answer = (c: Call) => Response | Promise<Response>;
function backend(answers: Record<string, Answer | Answer[]> = {}) {
  return fakeBackend({
    'GET /me': json(200, standInMe),
    'POST /auth/refresh': json(401, {}),
    'GET /notifications/unread-count': json(200, { unread: 0 }),
    'GET /me/notification-preferences': json(200, { language: 'en', emailTransactional: true }),
    'GET /me/data-export': noContent(),
    'POST /auth/step-up/start': json(200, { method: 'totp' }),
    'POST /auth/step-up/verify': json(200, { grant: 'grant-1', expiresInSeconds: 300 }),
    ...answers,
  });
}
async function stepUp() {
  const dialog = await screen.findByRole('dialog', { name: 'Confirm it is you' });
  fireEvent.change(within(dialog).getByLabelText('Code'), { target: { value: '123456' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
}

describe("a copy of one's data", () => {
  it('FR-PRV-03 SEC-AUTH-08 asking needs step-up; the copy is prepared, then downloaded behind a signed link until it is deleted', async () => {
    const ready = {
      id: 'x-1',
      status: 'ready',
      requestedAt: iso(-HOUR),
      readyAt: iso(-HOUR),
      expiresAt: iso(7 * 24 * HOUR),
      download: { url: '/api/v1/files/v/abc', expiresAt: iso(HOUR) },
    };
    let asked = false;
    const be = backend({
      'GET /me/data-export': () =>
        (asked ? json(200, { id: 'x-1', status: 'preparing', requestedAt: iso(0), readyAt: null, expiresAt: null, download: null }) : noContent())(),
      'POST /me/data-export': () => {
        asked = true;
        return json(202, { id: 'x-1', status: 'preparing', requestedAt: iso(0), readyAt: null, expiresAt: null, download: null })();
      },
    });
    renderApp('/account/privacy', be);
    fireEvent.click(await screen.findByRole('button', { name: 'Ask for a copy' }));
    await stepUp();
    expect(await screen.findByText(/^Your copy is being prepared/)).toBeTruthy();
    expect(be.called('POST /me/data-export')[0].headers.get('X-Step-Up')).toBe('grant-1');
    expect(screen.queryByRole('button', { name: /Ask for/ })).toBeNull();
    cleanup();
    renderApp('/account/privacy', backend({ 'GET /me/data-export': json(200, ready) }));
    const link = await screen.findByRole('link', { name: 'Download your data (ZIP)' });
    expect(link.getAttribute('href')).toBe('/api/v1/files/v/abc');
    expect(screen.getByText(/^The file is deleted on /)).toBeTruthy();
  });

  it('DV-49 once in 7 days: a refusal says from when a new copy can be asked', async () => {
    renderApp(
      '/account/privacy',
      backend({
        'GET /me/data-export': json(200, {
          id: 'x-1',
          status: 'expired',
          requestedAt: iso(-24 * HOUR),
          readyAt: iso(-24 * HOUR),
          expiresAt: iso(-HOUR),
          download: null,
        }),
        'POST /me/data-export': problem(429, 'rate-limited', {}, { 'Retry-After': String(6 * 24 * 3600) }),
      }),
    );
    expect(await screen.findByText('Your last copy has been deleted.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ask for a new copy' }));
    await stepUp();
    expect(await screen.findByText(/^You can ask for a copy once every 7 days\. You can ask again from .+\.$/)).toBeTruthy();
  });
});

describe('closing the account', () => {
  it('FR-ACC-11 closing states its consequence, needs step-up, and is refused with the reasons while something is open', async () => {
    const be = backend({
      'POST /me/close': [
        problem(409, 'account-not-closable', {
          errors: [
            { field: 'account', reason: 'open-order' },
            { field: 'account', reason: 'balance-owed' },
          ],
        }),
        noContent(),
      ],
    });
    renderApp('/account/privacy', be);
    fireEvent.click(await screen.findByRole('button', { name: 'Close my account' }));
    const dialog = await screen.findByRole('dialog', { name: 'Close your account' });
    expect(within(dialog).getByText('Your account will be closed now and you will be signed out. This cannot be undone.')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close my account now' }));
    await stepUp();
    expect(await screen.findByText('Your account cannot be closed yet:')).toBeTruthy();
    expect(screen.getByText('an order is still open;')).toBeTruthy();
    expect(screen.getByText('TrustBazaar still owes you money;')).toBeTruthy();

    const close = screen.getByRole('button', { name: 'Close my account' }) as HTMLButtonElement;
    await waitFor(() => expect(close.disabled).toBe(false));
    fireEvent.click(close);
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Close your account' })).getByRole('button', { name: 'Close my account now' }));
    await stepUp();
    expect(await screen.findByText(/^Your account is closed and you are signed out\./)).toBeTruthy();
    expect(be.called('POST /me/close')).toHaveLength(2);
    expect(be.called('POST /me/close')[1].headers.get('X-Step-Up')).toBe('grant-1');
  });

  it('FR-ACC-11 keeping the account sends nothing; every refusal reason has words in both languages', async () => {
    const be = backend();
    renderApp('/account/privacy', be);
    fireEvent.click(await screen.findByRole('button', { name: 'Close my account' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Keep my account' }));
    expect(be.called('POST /me/close')).toEqual([]);
    for (const r of [
      'open-order',
      'auction-with-bids',
      'leading-bid',
      'offer-open',
      'open-dispute',
      'balance-owed',
      'payout-pending',
      'refund-pending',
      'kyc-under-review',
    ]) {
      expect(en[`close.reason.${r}` as keyof typeof en]).toBeTruthy();
    }
    expect(Object.keys(bn).sort()).toEqual(Object.keys(en).sort());
    for (const k of Object.keys(en) as (keyof typeof en)[]) expect(placeholders(bn[k])).toEqual(placeholders(en[k]));
  });
});
