// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, configure, fireEvent, screen, waitFor } from '@testing-library/react';
import { placeholders } from '../../lib/i18n.js';
import { fakeBackend, json, problem, renderApp, standInMe, type Call } from '../../testing/app';
import en from '../../messages/en/checkout.json';
import bn from '../../messages/bn/checkout.json';
import libEn from '../../lib/messages/en.json';

// Checkout of a fixed-price item (IF-UI-04; FR-FIX-01, FR-FIX-05; section 7.4): the order is created once with an
// Idempotency-Key and the order page takes the payment; refusals in words; a guest is sent to sign in.

configure({ asyncUtilTimeout: 3000 });
afterEach(cleanup);

const ID = '7e1c2a3e-1111-4a5b-8c9d-000000000001';
const listing = (o: Record<string, unknown> = {}) => ({
  id: ID, itemKind: 'physical', saleFormat: 'fixed_price', status: 'active', title: 'Desk lamp', price: '150000',
  fulfilmentOptions: 'pickup_or_courier', quantity: { total: 3, available: 2 }, seller: { id: 'seller-1' }, ...o,
});

function backend(o: { l?: Record<string, unknown>; signedIn?: boolean; create?: (c: Call) => Response } = {}) {
  return fakeBackend({
    'GET /me': o.signedIn === false ? json(401, { type: '/problems/session-ended' }) : json(200, standInMe),
    'POST /auth/refresh': json(401, {}),
    'GET /notifications/unread-count': json(200, { unread: 0 }),
    'GET /me/notification-preferences': json(200, { language: 'en', emailTransactional: true }),
    [`GET /listings/${ID}`]: json(200, listing(o.l)),
    'POST /orders': o.create ?? json(201, { id: 'o-1' }),
    'GET /orders/o-1': json(200, { id: 'o-1', status: 'awaiting_payment', role: 'buyer', listing: { id: ID, title: 'Desk lamp' } }),
  });
}

describe('checkout', () => {
  it('FR-FIX-01 the quantity and self pickup, the total, then one order with an Idempotency-Key and on to its page', async () => {
    const be = backend();
    const doc = renderApp(`/checkout/${ID}`, be);
    expect(await screen.findByText(libEn['sim.payment'])).toBeTruthy();
    expect(screen.getByText('Price for one: ৳1,500')).toBeTruthy();
    expect(screen.getByText('Courier delivery cannot be booked yet; you can pick the item up from the seller.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '২' } });
    expect(screen.getByText('Total to pay: ৳3,000')).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Continue to payment' });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(doc.router.state.location.pathname).toBe('/orders/o-1'));
    const sent = be.called('POST /orders');
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toEqual({ listingId: ID, quantity: 2, fulfilment: 'self_pickup' });
    expect(sent[0].headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('FR-FIX-05 a quantity above what is left is explained before sending; a sold-out item is refused in words', async () => {
    const be = backend({ create: problem(409, 'not-available') });
    renderApp(`/checkout/${ID}`, be);
    fireEvent.change(await screen.findByLabelText('Quantity'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue to payment' }));
    expect(await screen.findByText('Enter a quantity from 1 to 2.')).toBeTruthy();
    expect(be.called('POST /orders')).toHaveLength(0);
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue to payment' }));
    expect(await screen.findByText('This item is no longer available in that quantity.')).toBeTruthy();
  });

  it('FR-TNS-07 an order over the account\'s limit, and an unverified buyer, are told why', async () => {
    renderApp(`/checkout/${ID}`, backend({ l: { quantity: { total: 1, available: 1 } }, create: problem(409, 'order-limit') }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue to payment' }));
    expect(await screen.findByText('This order is above the amount your account can buy right now.')).toBeTruthy();
    cleanup();
    renderApp(`/checkout/${ID}`, backend({ l: { quantity: { total: 1, available: 1 } }, create: problem(403, 'transaction-not-allowed') }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue to payment' }));
    expect(await screen.findByText('Only members with a verified identity and e-mail can buy.')).toBeTruthy();
  });

  it('FR-DLV-02 a courier-only item, a game account, an auction and one\'s own listing cannot be checked out yet, and say why', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ fulfilmentOptions: 'courier_only' }, 'Courier delivery cannot be booked yet. This item can only be sent by courier, so it cannot be bought for now.'],
      [{ itemKind: 'game_account', fulfilmentOptions: null }, 'Game accounts cannot be bought yet. This will be possible soon.'],
      [{ saleFormat: 'auction', price: null }, 'This item cannot be bought now.'],
      [{ seller: { id: standInMe.id } }, 'This is your own listing.'],
    ];
    for (const [l, text] of cases) {
      renderApp(`/checkout/${ID}`, backend({ l }));
      expect(await screen.findByText(text)).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Continue to payment' })).toBeNull();
      cleanup();
    }
  });

  it('SEC-ACC-01 a guest who opens checkout is sent to sign in, returning here', async () => {
    const doc = renderApp(`/checkout/${ID}`, backend({ signedIn: false }));
    await waitFor(() => expect(doc.router.state.location.pathname).toBe('/signin'));
    expect(doc.router.state.location.search).toBe(`?next=${encodeURIComponent(`/checkout/${ID}`)}`);
  });

  it('NFR-USE-04 checkout in Bangla; both languages have the same keys and placeholders', async () => {
    renderApp(`/checkout/${ID}`, backend(), 'bn');
    expect(await screen.findByText('একটির দাম: ৳১,৫০০')).toBeTruthy();
    expect(Object.keys(bn).sort()).toEqual(Object.keys(en).sort());
    for (const k of Object.keys(en) as (keyof typeof en)[]) expect(placeholders(bn[k])).toEqual(placeholders(en[k]));
  });
});
