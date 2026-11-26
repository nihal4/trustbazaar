// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, configure, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { placeholders } from '../../lib/i18n.js';
import { fakeBackend, json, problem, renderApp, standInMe, type Call } from '../../testing/app';
import en from '../../messages/en/checkout.json';
import bn from '../../messages/bn/checkout.json';
import libEn from '../../lib/messages/en.json';

// Checkout of a fixed-price item (IF-UI-04; FR-FIX-01, FR-FIX-05; section 7.4): the order is created once with an
// Idempotency-Key and the order page takes the payment; refusals in words; a guest is sent to sign in.

configure({ asyncUtilTimeout: 3000 });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

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
    'GET /orders/o-1': json(200, { id: 'o-1', status: 'awaiting_payment', role: 'buyer', total: '300000', listing: { id: ID, title: 'Desk lamp' } }),
  });
}

describe('checkout', () => {
  it('FR-FIX-01 the summary beside the choices holds the total, the button and the payment promise (Daylight design)', async () => {
    renderApp(`/checkout/${ID}`, backend());
    const summary = await screen.findByRole('complementary', { name: 'Summary' });
    expect(within(summary).getByText('৳1,500')).toBeTruthy();            // the total, named once
    expect(within(summary).getByRole('button', { name: 'Continue to payment' }).getAttribute('form')).toBe('checkout-form');
    expect(within(summary).getByText('Your money waits with us')).toBeTruthy();
  });

  it('NFR-USE-07 the summary is a ruled column: the total once, how the money moves in order (none of it has happened yet), the button (AC-ORD-1)', async () => {
    renderApp(`/checkout/${ID}`, backend(), 'bn');
    const summary = await screen.findByRole('complementary', { name: 'সারসংক্ষেপ' });
    expect(within(summary).getAllByText('৳১,৫০০').length).toBeGreaterThan(0);
    const steps = within(summary).getAllByRole('listitem');
    expect(steps).toHaveLength(3);
    expect(steps.some((li) => li.getAttribute('aria-current') === 'step')).toBe(false);   // nothing is paid or held at checkout: no step is marked
    expect(screen.queryByText('The seller is paid only after you confirm you have the item.')).toBeNull();
  });

  it('FR-FIX-01 the quantity and self pickup, the total, then one order with an Idempotency-Key and on to its page', async () => {
    const be = backend();
    const doc = renderApp(`/checkout/${ID}`, be);
    expect(await screen.findByText(libEn['sim.payment'])).toBeTruthy();
    expect(screen.getByText('Price for one: ৳1,500')).toBeTruthy();
    expect((screen.getByLabelText('Pick it up from the seller (no delivery fee)') as HTMLInputElement).checked).toBe(true);
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '২' } });
    expect(screen.getByText('৳3,000')).toBeTruthy();                      // two units: the total changes
    const button = screen.getByRole('button', { name: 'Continue to payment' });
    fireEvent.click(button);
    fireEvent.click(button);
    // a pickup order is paid right here: the payment sheet rises over the checkout, with the order's own total
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByRole('heading', { name: 'Pay ৳3,000' })).toBeTruthy();
    expect(doc.router.state.location.pathname).toBe(`/checkout/${ID}`);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));          // leaving the sheet goes on to the order's page, still unpaid
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

  it('FR-DLV-02 courier delivery is chosen here; the order is created without a method and the order page takes the address and the fee', async () => {
    const be = backend({ l: { fulfilmentOptions: 'courier_only', quantity: { total: 1, available: 1 } } });
    const doc = renderApp(`/checkout/${ID}`, be);
    expect((await screen.findByLabelText('Courier delivery') as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByLabelText('Pick it up from the seller (no delivery fee)')).toBeNull();
    expect(screen.getByText('You give the delivery address and see the delivery fee on the next page, before you pay.')).toBeTruthy();
    expect(screen.getByText('Item total: ৳1,500, plus the delivery fee')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continue to payment' }));
    await waitFor(() => expect(doc.router.state.location.pathname).toBe('/orders/o-1'));
    expect(be.called('POST /orders')[0].body).toEqual({ listingId: ID, quantity: 1 });
  });

  it('FR-DLV-02 an auction and one\'s own listing cannot be checked out, and say why', async () => {
    const cases: [Record<string, unknown>, string][] = [
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

  it('FR-GAM-05 NFR-USE-03 a game account: refused in words in a browser without Web Crypto and IndexedDB; else one order with no delivery, after the same-browser warning', async () => {
    const game = { itemKind: 'game_account', fulfilmentOptions: null, quantity: { total: 1, available: 1 } };
    vi.stubGlobal('indexedDB', undefined);
    renderApp(`/checkout/${ID}`, backend({ l: game }));
    expect(await screen.findByText(/^Buying a game account needs a browser that supports Web Crypto and IndexedDB/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Continue to payment' })).toBeNull();
    cleanup();
    vi.stubGlobal('indexedDB', { open: () => ({}) });
    const be = backend({ l: game });
    const doc = renderApp(`/checkout/${ID}`, be);
    expect(await screen.findByText(/^Use this same browser on this device to open the credentials\./)).toBeTruthy();
    expect(screen.queryByLabelText('Pick it up from the seller (no delivery fee)')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Continue to payment' }));
    await waitFor(() => expect(doc.router.state.location.pathname).toBe('/orders/o-1'));
    expect(be.called('POST /orders')[0].body).toEqual({ listingId: ID, quantity: 1 });
    vi.unstubAllGlobals();
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
