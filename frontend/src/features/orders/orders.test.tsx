// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, configure, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { placeholders } from '../../lib/i18n.js';
import { fakeBackend, json, problem, renderApp, standInMe, type Call } from '../../testing/app';
import type { OrderView } from './OrderPage';
import { away, providerPage, RETURN_WAIT_MS } from './payment';
import en from '../../messages/en/orders.json';
import bn from '../../messages/bn/orders.json';
import libEn from '../../lib/messages/en.json';

// Paying for an order and the return from the provider (IF-UI-04; FR-PAY-01, FR-PAY-02; NFR-CMP-05; section 7.4):
// one total with its lines, the fee disclosure, the window, the provider page followed only when allowed, the
// payment started once, and after the provider only the order's status, checked every 2 s for up to 30 s.

configure({ asyncUtilTimeout: 3000 });
const went: string[] = [];
const go = away.go;
beforeEach(() => {
  went.length = 0;
  away.go = (url) => { went.push(url); };
});
afterEach(() => {
  away.go = go;
  cleanup();
  vi.useRealTimers();
});

const order = (o: Partial<OrderView> = {}): OrderView => ({
  id: 'o-1', kind: 'fixed_price', role: 'buyer', status: 'awaiting_payment',
  listing: { id: 'l-1', title: 'Desk lamp', itemKind: 'physical', photoKey: null }, threadId: null, quantity: 1,
  itemPrice: '150000', deliveryFee: '0', total: '150000', fulfilment: 'self_pickup', fulfilmentOptions: ['self_pickup', 'courier'],
  paymentDueAt: new Date(Date.now() + 15 * 60_000).toISOString(), paidAt: null, fulfilmentDueAt: null, deliveryEventAt: null, closedAt: null,
  escrow: null, ...o,
});
const paid = () => order({
  status: 'paid', paidAt: new Date().toISOString(), fulfilmentDueAt: '2026-11-04T06:00:00Z',
  escrow: { state: 'held', releasePolicy: 'standard', amountCollected: '150000', amountRefunded: '0', autoReleaseAt: null },
});

function backend(o: { order?: OrderView | (() => OrderView); pay?: (c: Call) => Response; fulfil?: (c: Call) => Response; signedIn?: boolean } = {}) {
  return fakeBackend({
    'GET /me': o.signedIn === false ? json(401, { type: '/problems/session-ended' }) : json(200, standInMe),
    'POST /auth/refresh': json(401, {}),
    'GET /notifications/unread-count': json(200, { unread: 0 }),
    'GET /me/notification-preferences': json(200, { language: 'en', emailTransactional: true }),
    'GET /orders/o-1': o.signedIn === false ? json(401, { type: '/problems/session-ended' }) : () => json(200, typeof o.order === 'function' ? o.order() : (o.order ?? order()))(),
    'GET /orders/o-404': problem(404, 'not-found'),
    'POST /orders/o-1/payments': o.pay ?? json(201, { attemptId: 'a-1', provider: 'nagad', amount: '150000', redirectUrl: '/api/v1/mock-provider/a-1?state=s1' }),
    'GET /me/payment-method': json(200, { method: null }),
    'PUT /me/payment-method': json(200, { method: null }),
    'PUT /orders/o-1/fulfilment': o.fulfil ?? json(200, order()),
  });
}

describe('paying for an order', () => {
  it('FR-PAY-01 one total with its lines, the fee disclosure, the window, and the simulated-payments banner', async () => {
    renderApp('/orders/o-1', backend());
    const panel = (await screen.findByRole('heading', { name: 'Pay for your order' })).closest('section')!;
    expect(screen.getByText(libEn['sim.payment'])).toBeTruthy();
    // what the buyer pays is the left column's breakdown (ruled cells), the window and the pay button are in the panel
    const lines = (await screen.findByRole('heading', { name: 'Order summary' })).closest('section')!;
    expect(within(lines).getByText('Item').nextElementSibling?.textContent).toBe('৳1,500.00');
    expect(within(lines).getByText('Delivery').nextElementSibling?.textContent).toBe('৳0.00');
    expect(within(lines).getByText('Total').nextElementSibling?.textContent).toBe('৳1,500.00');
    expect(within(lines).getByText("TrustBazaar's fee is paid by the seller. You pay only the total shown.")).toBeTruthy();
    expect(within(panel).getByText('Total').nextElementSibling?.textContent).toBe('৳1,500'); // the pay row; the deadline is a cell of the Deadlines grid
    expect(screen.getByText('Pay by').nextElementSibling?.textContent).toMatch(/^Time left(15:00|14:5\d)/);
  });

  const openSheet = async () => {
    fireEvent.click(await screen.findByRole('button', { name: 'Pay ৳1,500' }));
    return await screen.findByRole('dialog');
  };
  const payWallet = (sheet: HTMLElement, method: 'bKash' | 'Nagad') => {
    fireEvent.click(within(sheet).getByRole('button', { name: new RegExp(`^${method}`) }));
    fireEvent.change(within(sheet).getByLabelText(`${method} number`), { target: { value: '01712345678' } });
    fireEvent.change(within(sheet).getByLabelText(`${method} PIN`), { target: { value: '1234' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Pay ৳1,500' }));
  };

  it('FR-PAY-01 the payment sheet offers bKash, Nagad and a card, takes any details, starts the payment once with an Idempotency-Key and says it is complete', async () => {
    let status: 'awaiting_payment' | 'paid' = 'awaiting_payment';
    const be = backend({ order: () => (status === 'paid' ? paid() : order()), pay: () => { status = 'paid'; return json(201, { attemptId: 'a-1', provider: 'nagad', amount: '150000', redirectUrl: '/api/v1/mock-provider/a-1?state=s1' })(); } });
    const fetched: string[] = [];
    // the simulated provider's page is played in the sheet: its "Pay" form is posted (not followed), the server then asks the provider
    vi.stubGlobal('fetch', ((u: string, init?: RequestInit) => { fetched.push(`${init?.method} ${String(u)}`); return Promise.resolve(new Response('', { status: 200 })); }) as typeof fetch);
    renderApp('/orders/o-1', be);
    const sheet = await openSheet();
    expect(within(sheet).getAllByRole('button').map((b) => b.textContent).join('|')).toMatch(/bKash.*Nagad.*Card/);
    payWallet(sheet, 'Nagad');
    expect(await within(sheet).findByText('Payment complete', {}, { timeout: 8000 })).toBeTruthy();
    expect(fetched).toEqual([`POST ${window.location.origin}/api/v1/mock-provider/a-1?state=s1`]);
    const sent = be.called('POST /orders/o-1/payments');
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toEqual({ provider: 'nagad' });
    expect(sent[0].headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
    expect(went).toEqual([]);                                                    // no leaving the site: the simulated provider is played in the sheet
    expect(within(sheet).getByText(/^Do you want to keep Nagad 01/)).toBeTruthy();       // the default-method question, with the number masked
    fireEvent.click(within(sheet).getByRole('button', { name: 'Yes, make it my default' }));
    await waitFor(() => expect(be.called('PUT /me/payment-method')).toHaveLength(1));
    expect(be.called('PUT /me/payment-method')[0].body).toEqual({ kind: 'nagad', brand: null, last4: '5678' });   // a masked label only: never the number or the PIN
    // the page behind now shows the payment as done, in green, and the money on hold
    await waitFor(() => expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toContain('Payment complete (done)'));
    expect(screen.queryByRole('dialog')).toBeNull();
  }, 20_000);

  it('SEC-PAY-02 a provider page on a host that is not configured is not followed, so PINs are typed only on the provider\'s own page', async () => {
    renderApp('/orders/o-1', backend({ pay: json(201, { attemptId: 'a-1', redirectUrl: 'https://checkout.stripe.com.evil.example/pay' }) }));
    payWallet(await openSheet(), 'bKash');
    expect(await screen.findByText('We could not open the payment page safely. Please try again or choose another method.')).toBeTruthy();
    expect(went).toEqual([]);
    expect(providerPage('https://checkout.stripe.com/c/pay/x', ['checkout.stripe.com'], 'https://tb.test')).toBe('https://checkout.stripe.com/c/pay/x');
    expect(providerPage('http://checkout.stripe.com/x', ['checkout.stripe.com'], 'https://tb.test')).toBeNull();
    expect(providerPage('/api/v1/mock-provider/a?state=1', [], 'https://tb.test')).toBe('https://tb.test/api/v1/mock-provider/a?state=1');
  });

  it('FR-PAY-01 a method that is not available, and a provider that cannot be reached, are explained', async () => {
    renderApp('/orders/o-1', backend({ pay: problem(409, 'feature-off', { errors: [{ field: 'provider', reason: 'not-available-in-this-mode' }] }) }));
    payWallet(await openSheet(), 'bKash');
    expect(await screen.findByText('This payment method is not available right now. Please choose another.')).toBeTruthy();
    cleanup();
    renderApp('/orders/o-1', backend({ pay: problem(503, 'provider-unavailable', {}, { 'Retry-After': '30' }) }));
    payWallet(await openSheet(), 'bKash');
    expect(await screen.findByText('The payment service cannot be reached right now. Please try again shortly.')).toBeTruthy();
  });

  it('FR-AUC-14 FR-DLV-02 an auction win chooses self pickup first; a courier-only item offers courier delivery only', async () => {
    let current = order({ kind: 'auction', fulfilment: null });
    const be = backend({ order: () => current, fulfil: () => { current = order({ kind: 'auction' }); return json(200, current)(); } });
    renderApp('/orders/o-1', be);
    expect(await screen.findByRole('button', { name: /Meet the seller/ })).toBeTruthy();
    expect((screen.queryByRole('button', { name: /^Pay / }) as HTMLButtonElement | null)?.disabled ?? true).toBe(true); // nothing can be paid yet: no Pay button, or a disabled one
    fireEvent.click(screen.getByRole('button', { name: /Meet the seller/ }));
    expect(await screen.findByRole('button', { name: 'Pay ৳1,500' })).toBeTruthy();
    expect(be.called('PUT /orders/o-1/fulfilment')[0].body).toEqual({ fulfilment: 'self_pickup' });
    cleanup();
    renderApp('/orders/o-1', backend({ order: order({ kind: 'auction', fulfilment: null, fulfilmentOptions: ['courier'] }) }));
    expect(await screen.findByRole('button', { name: /Courier to my address/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Meet the seller/ })).toBeNull();
  });

  it('FR-PAY-01 after the window has passed nothing can be paid', async () => {
    renderApp('/orders/o-1', backend({ order: order({ paymentDueAt: new Date(Date.now() - 1000).toISOString() }) }));
    expect(await screen.findByText('The time to pay has ended.')).toBeTruthy();
    expect((screen.queryByRole('button', { name: /^Pay / }) as HTMLButtonElement | null)?.disabled ?? true).toBe(true); // nothing can be paid yet: no Pay button, or a disabled one
  });
});

describe('the return from the provider', () => {
  it('FR-PAY-02 the return proves nothing: the status is checked until the order is paid', async () => {
    let n = 0;
    renderApp('/orders/o-1?payment=a-1&result=succeeded', backend({ order: () => (++n >= 3 ? paid() : order()) }));
    expect(await screen.findByText('Checking your payment with the provider…')).toBeTruthy();
    expect(await screen.findByText('Payment received. Your money is held by TrustBazaar until you have the item.', {}, { timeout: 8000 })).toBeTruthy();
    expect(screen.getByText(libEn['sim.payment'])).toBeTruthy();
    expect(screen.getByText(/^Held by TrustBazaar\. If the seller misses the deadline/)).toBeTruthy();
  }, 15_000);

  it('FR-PAY-02 a failed payment says nothing was charged and offers to pay again', async () => {
    renderApp('/orders/o-1?payment=a-1&result=failed', backend());
    expect(await screen.findByText('The payment did not go through. Nothing was charged. You can try again.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pay ৳1,500' })).toBeTruthy();
  });

  it('NFR-USE-07 coming back to the return address after the order has closed shows no "money is held" notice', async () => {
    renderApp('/orders/o-1?payment=a-1&result=paid', backend({ order: order({ ...paid(), status: 'closed', closedAt: new Date().toISOString(), escrow: { ...paid().escrow!, state: 'released' } }) }));
    expect(await screen.findByText('Completed')).toBeTruthy();
    expect(screen.queryByText('Payment received. Your money is held by TrustBazaar until you have the item.')).toBeNull();
  });

  it('NFR-PERF-06 after 30 s without an answer the page says it is still waiting', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], shouldAdvanceTime: true });
    renderApp('/orders/o-1?payment=a-1', backend());
    expect(await screen.findByText('Checking your payment with the provider…')).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(RETURN_WAIT_MS + 1); });
    expect(await screen.findByText('We are still waiting for the payment provider. We will notify you.')).toBeTruthy();
  });
});

describe('the order page', () => {
  it('NFR-USE-07 a paid order says where the money is; the seller is never offered to pay', async () => {
    renderApp('/orders/o-1', backend({ order: paid() }));
    expect(await screen.findByText(/^Held by TrustBazaar\. If the seller misses the deadline, you are refunded in full\./)).toBeTruthy();
    expect(screen.queryByText(libEn['sim.payment'])).toBeNull();
    cleanup();
    renderApp('/orders/o-1', backend({ order: order({ role: 'seller' }) }));
    expect(await screen.findByText(/^Waiting for the buyer to pay by/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Pay / })).toBeNull();
  });

  it('SEC-SDL-09 an order that is not the user\'s is not found; a guest is asked to sign in', async () => {
    renderApp('/orders/o-404', backend());
    expect(await screen.findByRole('heading', { name: 'This order was not found.' })).toBeTruthy();
    cleanup();
    renderApp('/orders/o-1', backend({ signedIn: false }));
    expect((await screen.findByRole('link', { name: 'Sign in to see this order.' })).getAttribute('href')).toBe(`/signin?next=${encodeURIComponent('/orders/o-1')}`);
  });

  it('NFR-USE-04 the page in Bangla; both languages have the same keys and placeholders', async () => {
    renderApp('/orders/o-1', backend(), 'bn');
    expect(await screen.findByRole('button', { name: '৳১,৫০০ দিন' })).toBeTruthy();
    expect(Object.keys(bn).sort()).toEqual(Object.keys(en).sort());
    for (const k of Object.keys(en) as (keyof typeof en)[]) expect(placeholders(bn[k])).toEqual(placeholders(en[k]));
  });
});
