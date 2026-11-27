// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, configure, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { placeholders } from '../../lib/i18n.js';
import { fakeBackend, json, problem, renderApp, standInMe, type Call } from '../../testing/app';
import { needingAction, type PayoutAccount, type SellerOrder } from './model';
import en from '../../messages/en/seller.json';
import bn from '../../messages/bn/seller.json';

// The seller dashboard and the payout account (docs/design/08_frontend.pdf section 7.8; IF-UI-08; FR-PAY-17,
// FR-PAY-21; U8-09): orders needing action with their deadlines first, listings by state, the payout account and its
// check status, payouts and statements, all figures from the server; the payout account changes after step-up.

configure({ asyncUtilTimeout: 3000 });
afterEach(() => cleanup());

const HOUR = 3_600_000;
const iso = (offset: number) => new Date(Date.now() + offset).toISOString();
const sale = (o: Partial<SellerOrder> = {}): SellerOrder => ({
  id: 'o-1', status: 'paid', listing: { id: 'l-1', title: 'Desk lamp' }, fulfilment: 'self_pickup', fulfilmentDueAt: iso(48 * HOUR), deliveryEventAt: null,
  cancellationRequest: null, escrow: { state: 'held' }, ...o,
});
const account = (a: Partial<PayoutAccount> = {}): PayoutAccount => ({
  id: 'pa-1', kind: 'bkash_wallet', status: 'active', walletMasked: '***678', bankName: null, branchName: null, accountName: null, accountLast4: null,
  effectiveAt: iso(-HOUR), createdAt: iso(-48 * HOUR), ...a,
});

type Answer = (c: Call) => Response | Promise<Response>;
function backend(answers: Record<string, Answer | Answer[]> = {}) {
  return fakeBackend({
    'GET /me': json(200, { ...standInMe, kycStatus: 'verified' }),
    'POST /auth/refresh': json(401, {}),
    'GET /notifications/unread-count': json(200, { unread: 0 }),
    'GET /me/notification-preferences': json(200, { language: 'en', emailTransactional: true }),
    'GET /orders': json(200, { items: [], nextCursor: null }),
    'GET /me/listings': json(200, { items: [], nextCursor: null }),
    'GET /me/payout-account': json(200, { account: null }),
    'GET /me/payouts': json(200, { items: [], nextCursor: null }),
    'GET /me/statements': json(200, { items: [], owed: '0', nextCursor: null }),
    ...answers,
  });
}

describe('the seller dashboard', () => {
  it('IF-UI-08 orders needing the seller come first by deadline: a cancellation request, then hand-overs and shipments', () => {
    const list = needingAction([
      sale({ id: 'late', fulfilmentDueAt: iso(72 * HOUR) }),
      sale({ id: 'ship', fulfilment: 'courier', fulfilmentDueAt: iso(24 * HOUR) }),
      sale({ id: 'ask', cancellationRequest: { id: 'r', status: 'pending' }, fulfilmentDueAt: iso(96 * HOUR) }),
      sale({ id: 'done', deliveryEventAt: iso(-HOUR) }),
      sale({ id: 'unpaid', status: 'awaiting_payment', escrow: null }),
      sale({ id: 'disputed', escrow: { state: 'frozen_disputed' } }),
    ]);
    expect(list.map((x) => [x.order.id, x.why])).toEqual([['ask', 'cancel_request'], ['ship', 'ship'], ['late', 'hand_over']]);
  });

  it('IF-UI-08 FR-PAY-21 the dashboard: orders needing action with deadlines, listings by state, the payout account, payouts and statements', async () => {
    const be = backend({
      'GET /orders': json(200, { items: [sale(), sale({ id: 'o-2', listing: { id: 'l-2', title: 'Radio' }, deliveryEventAt: iso(-HOUR) })], nextCursor: null }),
      'GET /me/listings': (c) => json(200, {
        items: c.query.get('status') === 'sold'
          ? [{ id: 'l-9', title: 'Old fan', status: 'sold', saleFormat: 'auction', price: null, quantity: { total: 1, available: 0 }, createdAt: iso(-HOUR), publishedAt: iso(-HOUR) }]
          : [{ id: 'l-1', title: 'Desk lamp', status: 'active', saleFormat: 'fixed_price', price: '150000', quantity: { total: 3, available: 2 }, createdAt: iso(-HOUR), publishedAt: iso(-HOUR) }],
        nextCursor: null,
      })(),
      'GET /me/payout-account': json(200, { account: account({ status: 'cooling_off', effectiveAt: iso(20 * HOUR) }) }),
      'GET /me/payouts': json(200, { items: [{ id: 'p-1', orderId: 'o-7', amount: '142500', status: 'waiting_cooling_off', simulated: true, createdAt: iso(-HOUR), sentAt: null }], nextCursor: null }),
      'GET /me/statements': json(200, {
        items: [{ orderId: 'o-7', title: 'Book shelf', settledAt: iso(-HOUR), amountCollected: '150000', itemPrice: '150000', deliveryFee: '0', commission: '7500', courierPayout: '0', sellerPayout: '142500', refundTotal: '0', payout: { id: 'p-1', amount: '142500', status: 'waiting_cooling_off', simulated: true } }],
        owed: '142500', nextCursor: null,
      }),
    });
    renderApp('/seller', be);
    const action = (await screen.findByRole('heading', { name: 'Orders that need you' })).closest('section')!;
    expect(await within(action).findByRole('link', { name: 'Desk lamp' })).toBeTruthy();
    expect(within(action).queryByRole('link', { name: 'Radio' })).toBeNull(); // handed over: nothing to do
    expect(within(action).getByText('Hand over the item by')).toBeTruthy();
    expect(within(action).getByText(/^in (2 days 0 h|1 day 23 h)$/)).toBeTruthy();   // the deadline: its date and time above, what is left in vermilion

    const listings = screen.getByRole('heading', { name: 'Your listings' }).closest('section')!;
    expect(await within(listings).findByText('Fixed price · ৳1,500 · 2 of 3 left')).toBeTruthy();
    fireEvent.change(within(listings).getByLabelText('Show listings that are'), { target: { value: 'sold' } });
    expect(await within(listings).findByRole('link', { name: 'Old fan' })).toBeTruthy();
    expect([...new Set(be.called('GET /me/listings').map((c) => c.query.get('status')))]).toEqual(['active', 'sold']);

    const payouts = screen.getByRole('heading', { name: 'Payouts' }).closest('section')!;
    expect(await within(payouts).findByText(/^Usable for payouts from /)).toBeTruthy();
    expect(within(payouts).getByText(/bKash wallet \*\*\*678/)).toBeTruthy();
    expect(within(payouts).getByText(/waiting for the new account to become usable/)).toBeTruthy();
    expect(within(payouts).getByRole('link', { name: 'Change the payout account' }).getAttribute('href')).toBe('/account/payout');

    const statements = screen.getByRole('heading', { name: 'Statements' }).closest('section')!;
    expect(await within(statements).findByText('TrustBazaar still owes you ৳1,425.')).toBeTruthy();
    expect(within(statements).getByText("TrustBazaar's commission").nextElementSibling?.textContent).toBe('−৳75.00');
    expect(within(statements).getByText('Your payout').nextElementSibling?.textContent).toBe('৳1,425.00');
  });

  it('NFR-USE-07 a statement is a ruled line: the order, the payout as the one figure, the breakdown, and the day the payout was sent as plain text (AC-SEL-2)', async () => {
    const sentAt = '2026-11-20T20:00:00Z';                           // 21 November in Dhaka
    renderApp('/seller', backend({
      'GET /me/payouts': json(200, { items: [{ id: 'p-1', orderId: 'o-7', amount: '142500', status: 'sent', simulated: false, createdAt: iso(-HOUR), sentAt }], nextCursor: null }),
      'GET /me/statements': json(200, {
        items: [{ orderId: 'o-7', title: 'Book shelf', settledAt: iso(-HOUR), amountCollected: '150000', itemPrice: '150000', deliveryFee: '0', commission: '7500', courierPayout: '0', sellerPayout: '142500', refundTotal: '0', payout: { id: 'p-1', amount: '142500', status: 'sent', simulated: false } }],
        owed: '0', nextCursor: null,
      }),
    }));
    const statement = await screen.findByRole('article', { name: 'Book shelf' });
    expect(within(statement).getByText('Your payout').nextElementSibling?.textContent).toBe('৳1,425.00');
    expect(within(statement).getByRole('heading', { name: 'Book shelf' })).toBeTruthy();
    expect(await within(statement).findByText(/21 Nov 2026/)).toBeTruthy();
  });

  it('FR-KYC-07 a member who is not verified is told why the seller screens are refused', async () => {
    renderApp('/seller', backend({
      'GET /me/listings': problem(403, 'forbidden'), 'GET /me/payout-account': problem(403, 'forbidden'),
      'GET /me/payouts': problem(403, 'forbidden'), 'GET /me/statements': problem(403, 'forbidden'),
    }));
    expect((await screen.findAllByText('Only members with a verified identity and e-mail can sell and be paid.')).length).toBeGreaterThanOrEqual(2);
  });
});

describe('the payout account', () => {
  it('FR-PAY-17 SEC-AUTH-08 a wallet on the verified number is saved after step-up; a bank account waits for the name check', async () => {
    let current: PayoutAccount | null = null;
    const be = backend({
      'GET /me/payout-account': () => json(200, { account: current })(),
      'POST /auth/step-up/start': json(200, { method: 'totp' }),
      'POST /auth/step-up/verify': json(200, { grant: 'grant-1', expiresInSeconds: 300 }),
      'POST /me/payout-account': [
        problem(400, 'validation-failed', { errors: [{ field: 'walletNumber', reason: 'not-verified-number' }] }),
        (c) => { current = account({ kind: 'bank', status: 'pending_review', bankName: 'Dutch-Bangla Bank', accountLast4: '0123', walletMasked: null, effectiveAt: null }); void c; return json(201, { account: current })(); },
      ],
    });
    renderApp('/account/payout', be);
    expect(await screen.findByText('You have no payout account yet. Payouts wait until you add one.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'bKash wallet' }));                   // each way to be paid opens its form in a popup
    expect(await screen.findByRole('dialog', { name: 'bKash wallet' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save the payout account' }));
    expect(await screen.findByText('Enter the wallet number.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Wallet number'), { target: { value: '০১৭১১০০০০০২' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save the payout account' }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm it is you' });
    fireEvent.change(within(dialog).getByLabelText('Code'), { target: { value: '123456' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('The wallet must be on your verified mobile number.')).toBeTruthy();
    expect(be.called('POST /me/payout-account')[0].body).toEqual({ kind: 'bkash_wallet', walletNumber: '01711000002' });
    expect(be.called('POST /me/payout-account')[0].headers.get('X-Step-Up')).toBe('grant-1');

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bank account' }));
    await screen.findByRole('dialog', { name: 'Bank account' });
    fireEvent.change(screen.getByLabelText('Bank'), { target: { value: 'Dutch-Bangla Bank' } });
    fireEvent.change(screen.getByLabelText('Account name'), { target: { value: 'Rahim Uddin' } });
    fireEvent.change(screen.getByLabelText('Routing number (9 digits)'), { target: { value: '0902712' } });
    fireEvent.change(screen.getByLabelText('Account number'), { target: { value: '1234-5678-90123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save the payout account' }));
    expect(await screen.findByText('The routing number has 9 digits.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Routing number (9 digits)'), { target: { value: '090271234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save the payout account' }));
    const again = await screen.findByRole('dialog', { name: 'Confirm it is you' });
    fireEvent.change(within(again).getByLabelText('Code'), { target: { value: '123456' } });
    fireEvent.click(within(again).getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText("Waiting for TrustBazaar's name check")).toBeTruthy();
    expect(screen.getByText('Dutch-Bangla Bank, account ending 0123')).toBeTruthy();
    expect(be.called('POST /me/payout-account')[1].body).toEqual({ kind: 'bank', bankName: 'Dutch-Bangla Bank', routingNumber: '090271234', accountName: 'Rahim Uddin', accountNumber: '1234567890123' });
    expect(screen.queryByText('1234567890123')).toBeNull(); // the full number is never shown back
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Replace the payout account' })).toBeTruthy());
  });

  it('NFR-USE-04 the seller screens have the same keys and placeholders in both languages', () => {
    expect(Object.keys(bn).sort()).toEqual(Object.keys(en).sort());
    for (const k of Object.keys(en) as (keyof typeof en)[]) expect(placeholders(bn[k])).toEqual(placeholders(en[k]));
  });
});
