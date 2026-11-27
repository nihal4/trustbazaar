// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, configure, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { placeholders } from '../../lib/i18n.js';
import { fakeBackend, json, renderApp, standInMe, type Call } from '../../testing/app';
import type { GameView } from './Game';
import type { OrderView } from './model';
import en from '../../messages/en/orders.json';
import bn from '../../messages/bn/orders.json';

// The game-account part of the order view (section 7.6; Unit 5; U8-07): before payment the publisher-risk disclosure
// is acknowledged by its version and the key is created on secure.html, and only then is payment offered; after
// payment the handover's state, its deadlines, the links to the credential screens (full page loads) and early release.

configure({ asyncUtilTimeout: 3000 });
beforeEach(() => vi.stubGlobal('indexedDB', { open: () => ({}) }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const HOUR = 3_600_000;
const iso = (offset: number) => new Date(Date.now() + offset).toISOString();
const order = (o: Partial<OrderView> = {}): OrderView => ({
  id: 'o-1',
  kind: 'fixed_price',
  role: 'buyer',
  status: 'awaiting_payment',
  listing: { id: 'l-1', title: 'PUBG level 70', itemKind: 'game_account', photoKey: null },
  threadId: null,
  quantity: 1,
  itemPrice: '500000',
  deliveryFee: '0',
  total: '500000',
  fulfilment: 'game_account',
  fulfilmentOptions: ['game_account'],
  paymentDueAt: iso(HOUR),
  paidAt: null,
  fulfilmentDueAt: null,
  deliveryEventAt: null,
  closedAt: null,
  cancellationRequest: null,
  escrow: null,
  ...o,
});
const game = (g: Partial<GameView> = {}): GameView => ({
  orderId: 'o-1',
  role: 'buyer',
  disclosure: { currentVersion: 1, acknowledgedVersion: null, acknowledgedAt: null },
  status: 'preparing',
  keyVersion: 0,
  rekeysUsed: 0,
  credentialsDueAt: null,
  firstDeliveredAt: null,
  deliveredAt: null,
  takeoverDueAt: null,
  rekeyDueAt: null,
  takenOverAt: null,
  takeoverSource: null,
  steps: { password: null, recovery_email: null, recovery_phone: null, social_logins: null, two_step: null },
  protectionEndsAt: null,
  ...g,
});
const held = (o: Partial<NonNullable<OrderView['escrow']>> = {}): OrderView['escrow'] => ({
  state: 'held',
  releasePolicy: 'game_protection',
  amountCollected: '500000',
  amountRefunded: '0',
  disputeWindowEndsAt: null,
  autoReleaseAt: iso(72 * HOUR),
  ...o,
});

type Answer = (c: Call) => Response | Promise<Response>;
function backend(answers: Record<string, Answer | Answer[]> = {}, o: { order?: () => OrderView; game?: () => GameView } = {}) {
  return fakeBackend({
    'GET /me': json(200, standInMe),
    'POST /auth/refresh': json(401, {}),
    'GET /notifications/unread-count': json(200, { unread: 0 }),
    'GET /me/notification-preferences': json(200, { language: 'en', emailTransactional: true }),
    'GET /orders/o-1': () => json(200, (o.order ?? (() => order()))())(),
    'GET /orders/o-1/game': () => json(200, (o.game ?? (() => game()))())(),
    'GET /orders/o-1/disputes': json(200, { items: [] }),
    'GET /orders/o-1/ratings': json(200, { items: [] }),
    'POST /auth/step-up/start': json(200, { method: 'totp' }),
    'POST /auth/step-up/verify': json(200, { grant: 'grant-1', expiresInSeconds: 300 }),
    ...answers,
  });
}

describe('before payment', () => {
  it('FR-GAM-05 FR-GAM-07 the disclosure is acknowledged by its version, then the key is created on secure.html; payment waits for both', async () => {
    let current = game();
    const be = backend(
      {
        'POST /orders/o-1/game/acknowledge': () => {
          current = game({ disclosure: { currentVersion: 1, acknowledgedVersion: 1, acknowledgedAt: iso(0) } });
          return json(200, current)();
        },
      },
      { game: () => current },
    );
    renderApp('/orders/o-1', be);
    expect(await screen.findByText(/^The game's publisher may forbid transferring accounts/)).toBeTruthy();
    expect(screen.getByText(/^It does not cover any action by the publisher\./)).toBeTruthy();
    expect((screen.queryByRole('button', { name: /^Pay ৳/ }) as HTMLButtonElement | null)?.disabled ?? true).toBe(true); // nothing can be paid yet: no Pay button, or a disabled one
    const confirm = screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/^I have read this/));
    fireEvent.click(confirm);
    const link = await screen.findByRole('link', { name: 'Create the key in this browser' });
    expect(link.getAttribute('href')).toBe('/secure/orders/o-1/key');
    expect(be.called('POST /orders/o-1/game/acknowledge')[0].body).toEqual({ version: 1 });
    expect(screen.getByText(/^Use this same browser on this device/)).toBeTruthy();
    expect((screen.queryByRole('button', { name: /^Pay ৳/ }) as HTMLButtonElement | null)?.disabled ?? true).toBe(true); // nothing can be paid yet: no Pay button, or a disabled one
    cleanup();

    renderApp(
      '/orders/o-1',
      backend({}, { game: () => game({ disclosure: { currentVersion: 1, acknowledgedVersion: 1, acknowledgedAt: iso(0) }, keyVersion: 1 }) }),
    );
    expect(await screen.findByText('Your key is ready in this browser. You can pay now.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Pay ৳/ })).toBeTruthy();
  });

  it('FR-GAM-07 a browser without IndexedDB is told so and offered no payment; an unknown disclosure version asks for a reload', async () => {
    vi.stubGlobal('indexedDB', undefined);
    renderApp('/orders/o-1', backend());
    expect(await screen.findByText(/^This browser cannot keep the key a game-account purchase needs/)).toBeTruthy();
    expect((screen.queryByRole('button', { name: /^Pay ৳/ }) as HTMLButtonElement | null)?.disabled ?? true).toBe(true); // nothing can be paid yet: no Pay button, or a disabled one
    cleanup();
    vi.stubGlobal('indexedDB', { open: () => ({}) });
    renderApp('/orders/o-1', backend({}, { game: () => game({ disclosure: { currentVersion: 2, acknowledgedVersion: null, acknowledgedAt: null } }) }));
    expect(await screen.findByText('This notice has been updated. Please reload the page.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
  });
});

describe('after payment', () => {
  it('FR-GAM-10 FR-GAM-13 the seller is sent to seal the credentials before the deadline; the buyer opens them in the same browser', async () => {
    renderApp(
      '/orders/o-1',
      backend(
        {},
        {
          order: () => order({ role: 'seller', status: 'paid', paidAt: iso(-HOUR), escrow: held() }),
          game: () => game({ role: 'seller', status: 'awaiting_credentials', keyVersion: 1, credentialsDueAt: iso(5 * HOUR) }),
        },
      ),
    );
    expect(await screen.findByText('Send the login details to the buyer, sealed in your browser.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Send the login details' }).getAttribute('href')).toBe('/secure/orders/o-1/deliver');
    const section = screen.getByRole('heading', { name: 'Game account handover' }).closest('section')!;
    expect(within(section).getByText('The seller must send the login details by')).toBeTruthy();
    expect(within(section).getByRole('definition').textContent).toMatch(/\(in (5|4) h/);
    cleanup();

    renderApp(
      '/orders/o-1',
      backend(
        {},
        {
          order: () => order({ status: 'paid', paidAt: iso(-HOUR), escrow: held() }),
          game: () => game({ status: 'delivered', keyVersion: 1, deliveredAt: iso(-HOUR), takeoverDueAt: iso(23 * HOUR) }),
        },
      ),
    );
    expect(await screen.findByRole('link', { name: 'Open the login details' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open the login details' }).getAttribute('href')).toBe('/secure/orders/o-1/credentials');
    expect(screen.getByText('Take over the account by')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Release the payment early' })).toBeNull();
  });

  it('FR-GAM-10 right after payment the handover may still be preparing: the page asks again until the seller is asked for the details', async () => {
    let n = 0;
    const be = backend(
      {},
      {
        order: () => order({ role: 'seller', status: 'paid', paidAt: iso(0), escrow: held() }),
        game: () =>
          ++n < 3
            ? game({ role: 'seller', keyVersion: 1, disclosure: { currentVersion: 1, acknowledgedVersion: 1, acknowledgedAt: iso(0) } })
            : game({ role: 'seller', status: 'awaiting_credentials', keyVersion: 1, credentialsDueAt: iso(24 * HOUR) }),
      },
    );
    renderApp('/orders/o-1', be);
    expect(await screen.findByRole('link', { name: 'Send the login details' }, { timeout: 7000 })).toBeTruthy();
    expect(be.called('GET /orders/o-1/game').length).toBeGreaterThanOrEqual(3);
  }, 10_000);

  it('FR-GAM-17 after the takeover the buyer may release the payment early, with its consequence and step-up', async () => {
    let current = order({ status: 'paid', paidAt: iso(-HOUR), deliveryEventAt: iso(-HOUR), escrow: held() });
    const be = backend(
      {
        'POST /orders/o-1/release-early': () => {
          current = order({ status: 'closed', paidAt: iso(-HOUR), escrow: held({ state: 'released' }) });
          return json(200, current)();
        },
      },
      {
        order: () => current,
        game: () => game({ status: 'taken_over', keyVersion: 1, takenOverAt: iso(-HOUR), protectionEndsAt: iso(72 * HOUR) }),
      },
    );
    renderApp('/orders/o-1', be);
    fireEvent.click(await screen.findByRole('button', { name: 'Release the payment early' }));
    const dialog = await screen.findByRole('dialog', { name: 'Release the payment early' });
    fireEvent.click(within(dialog).getByRole('button', { name: /৳5,000/ }));
    const stepUp = await screen.findByRole('dialog', { name: 'Confirm it is you' });
    fireEvent.change(within(stepUp).getByLabelText('Code'), { target: { value: '123456' } });
    fireEvent.click(within(stepUp).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(be.called('POST /orders/o-1/release-early')).toHaveLength(1));
    expect(be.called('POST /orders/o-1/release-early')[0].headers.get('X-Step-Up')).toBe('grant-1');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Release the payment early' })).toBeNull());
  });

  it('NFR-USE-04 every handover state has words for both roles, in both languages with the same placeholders', () => {
    for (const s of ['preparing', 'awaiting_credentials', 'delivered', 'rekey_requested', 'disputed', 'taken_over', 'cancelled', 'closed']) {
      for (const r of ['buyer', 'seller']) expect(en[`game.status.${s}.${r}` as keyof typeof en]).toBeTruthy();
    }
    expect(Object.keys(bn).sort()).toEqual(Object.keys(en).sort());
    for (const k of Object.keys(en) as (keyof typeof en)[]) expect(placeholders(bn[k])).toEqual(placeholders(en[k]));
  });
});
