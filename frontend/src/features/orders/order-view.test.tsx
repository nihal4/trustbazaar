// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, configure, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { fakeBackend, json, problem, renderApp, standInMe, type Call } from '../../testing/app';
import { actionsOf } from './Actions';
import { deadlinesOf } from './Deadlines';
import { postmarkOf, stepsOf } from './OrderPage';
import { dhakaInput, spaced } from './Handover';
import type { HandoverView, MeetupPoint, OrderView, SavedAddress, Shipment } from './model';
import libEn from '../../lib/messages/en.json';

// The order view (docs/design/08_frontend.pdf section 7.5; IF-UI-05; U8-06): where the money is, every deadline as a
// time and a countdown, only the actions the state allows (each with its consequence), the meetup handover with the
// hidden buyer code and the seller's entry, the proposals, the shipments, courier delivery with a binding quote, and
// the list of orders.

configure({ asyncUtilTimeout: 3000 });
afterEach(() => cleanup());

const HOUR = 3_600_000;
const iso = (offset: number) => new Date(Date.now() + offset).toISOString();
const order = (o: Partial<OrderView> = {}): OrderView => ({
  id: 'o-1', kind: 'fixed_price', role: 'buyer', status: 'paid',
  listing: { id: 'l-1', title: 'Desk lamp', itemKind: 'physical', photoKey: null }, threadId: null, quantity: 1,
  itemPrice: '150000', deliveryFee: '0', total: '150000', fulfilment: 'self_pickup', fulfilmentOptions: ['self_pickup', 'courier'],
  paymentDueAt: iso(-HOUR), paidAt: iso(-HOUR), fulfilmentDueAt: iso(48 * HOUR), deliveryEventAt: null, closedAt: null, cancellationRequest: null,
  escrow: { state: 'held', releasePolicy: 'standard', amountCollected: '150000', amountRefunded: '0', disputeWindowEndsAt: null, autoReleaseAt: null },
  ...o,
});
const point: MeetupPoint = {
  id: 'p-1', kind: 'police_station', nameEn: 'Dhanmondi Police Station', nameBn: 'ধানমন্ডি থানা', district: 'Dhaka', lat: 23.746, lng: 90.374,
  guidance: 'Meet at the front gate', active: true, mapUrl: 'https://www.openstreetmap.org/?mlat=23.746&mlon=90.374#map=18/23.746/90.374',
};
const handover = (h: Partial<HandoverView> = {}): HandoverView => ({
  orderId: 'o-1', role: 'buyer', status: 'arranging', dueAt: iso(48 * HOUR), proposals: [], agreed: null, suggestions: [point],
  code: '481902', attemptsLeft: null, completedAt: null, lockedAt: null, ...h,
});
const area = { id: 7, district: 'Dhaka', nameEn: 'Dhanmondi', nameBn: 'ধানমন্ডি' };
const shipment = (s: Partial<Shipment> = {}): Shipment => ({
  id: 's-1', direction: 'forward', status: 'booked', simulated: true, provider: 'mock', consignmentId: 'MOCK-1234567890', fee: '9000', cashToCollect: '0',
  pickupDueAt: null, bookedAt: iso(-HOUR), pickedUpAt: null, deliveredAt: null, returnedAt: null, cancelledAt: null, failedAttempts: 0, needsPickupAddress: false,
  myAddress: { line1: 'House 12, Road 5', contactName: 'Rahim', area }, other: { district: 'Khulna' },
  history: [{ from: null, to: 'preparing', at: iso(-2 * HOUR) }, { from: 'preparing', to: 'booked', at: iso(-HOUR) }], ...s,
});
const address = (a: Partial<SavedAddress> = {}): SavedAddress => ({
  id: 'a-1', kind: 'dropoff', label: 'Home', line1: 'House 12, Road 5', contactName: 'Rahim', area, createdAt: iso(-HOUR), ...a,
});

type Answer = (c: Call) => Response | Promise<Response>;
type Answers = Record<string, Answer | Answer[]>;
function backend(answers: Answers = {}, o: { order?: OrderView | (() => OrderView); handover?: HandoverView | (() => HandoverView) } = {}) {
  const value = <T,>(v: T | (() => T)) => (typeof v === 'function' ? (v as () => T)() : v);
  return fakeBackend({
    'GET /me': json(200, standInMe),
    'POST /auth/refresh': json(401, {}),
    'GET /notifications/unread-count': json(200, { unread: 0 }),
    'GET /me/notification-preferences': json(200, { language: 'en', emailTransactional: true }),
    'GET /orders/o-1': () => json(200, value(o.order ?? order()))(),
    'GET /orders/o-1/handover': () => json(200, value(o.handover ?? handover()))(),
    'GET /orders/o-1/shipments': json(200, { items: [] }),
    'GET /me/addresses': json(200, { items: [] }),
    'POST /orders/o-1/terms-acceptances': json(201, { acceptedAt: iso(0) }),
    'GET /delivery/areas': json(200, { items: [area] }),
    ...answers,
  });
}

describe('the order view: money, deadlines and actions', () => {
  it('NFR-USE-07 NFR-USE-08 IF-UI-05 the money sentence, then each deadline as a Dhaka time and a countdown', async () => {
    const meet = iso(26 * HOUR);
    renderApp('/orders/o-1', backend({}, { handover: handover({ status: 'agreed', agreed: { point, place: null, meetAt: meet } }) }));
    expect(await screen.findByText(/You are the buyer/)).toBeTruthy();
    const deadlines = (await screen.findByRole('heading', { name: 'Deadlines' })).closest('section')!;
    await waitFor(() => expect(within(deadlines).getByText('Meetup')).toBeTruthy());
    const rows = within(deadlines).getAllByRole('definition').map((d) => d.textContent);
    expect(rows).toHaveLength(2); // the meetup comes before the fulfilment deadline
    expect(rows[0]).toMatch(/^Time left1 day [12] h/); // the time left as cells, then the date it falls on
    expect(rows[1]).toMatch(/^Time left(2 days 0|1 day 23) h/);
    expect(within(deadlines).getAllByRole('term').map((d) => d.textContent)).toEqual(['Meetup', 'The seller must hand over or send the item by']);
  });

  it('IF-UI-05 only the actions the state allows: before the delivery event the buyer may ask to cancel, after it confirm receipt', () => {
    expect(actionsOf(order())).toEqual(['request']);
    expect(actionsOf(order({ cancellationRequest: { id: 'r-1', status: 'pending', reason: 'x', createdAt: iso(0) } }))).toEqual([]);
    expect(actionsOf(order({ deliveryEventAt: iso(-HOUR) }))).toEqual(['confirm']);
    expect(actionsOf(order({ deliveryEventAt: iso(-HOUR), escrow: { ...order().escrow!, releasePolicy: 'game_protection' } }))).toEqual([]);
    expect(actionsOf(order({ role: 'seller' }))).toEqual(['cancel']);
    expect(actionsOf(order({ role: 'seller', cancellationRequest: { id: 'r-1', status: 'pending', reason: 'x', createdAt: iso(0) } }))).toEqual(['accept', 'decline', 'cancel']);
    expect(actionsOf(order({ role: 'seller', deliveryEventAt: iso(-HOUR) }))).toEqual([]);
    expect(actionsOf(order({ status: 'awaiting_payment', escrow: null }))).toEqual([]);
    expect(actionsOf(order({ escrow: { ...order().escrow!, state: 'frozen_disputed' } }))).toEqual([]);
  });

  it('NFR-USE-08 the deadlines that apply: payment while unpaid; dispute window and auto-release after the delivery event', () => {
    const unpaid = order({ status: 'awaiting_payment', escrow: null, paymentDueAt: iso(HOUR) });
    expect(deadlinesOf(unpaid, null).map((d) => d.key)).toEqual(['deadline.payment']);
    const delivered = order({ deliveryEventAt: iso(-HOUR), escrow: { ...order().escrow!, disputeWindowEndsAt: iso(47 * HOUR), autoReleaseAt: iso(48 * HOUR) } });
    expect(deadlinesOf(delivered, null).map((d) => d.key)).toEqual(['deadline.dispute_window', 'deadline.auto_release']);
    const game = order({ deliveryEventAt: iso(-HOUR), escrow: { ...order().escrow!, releasePolicy: 'game_protection', autoReleaseAt: iso(72 * HOUR) } });
    expect(deadlinesOf(game, null).map((d) => d.key)).toEqual(['deadline.protection']);
    expect(deadlinesOf(order({ status: 'closed', escrow: { ...order().escrow!, state: 'released' } }), null)).toEqual([]);
  });

  it('FR-PAY-07 confirming receipt states its consequence with the amount, and is sent once', async () => {
    let current = order({ deliveryEventAt: iso(-HOUR) });
    const be = backend({
      'POST /orders/o-1/confirm-receipt': () => { current = order({ status: 'closed', deliveryEventAt: iso(-HOUR), escrow: { ...order().escrow!, state: 'released' } }); return json(200, current)(); },
    }, { order: () => current });
    renderApp('/orders/o-1', be);
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm you received the item' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(libEn['confirm.confirm_receipt'].replace('{amount}', '৳1,500'))).toBeTruthy();
    const release = within(dialog).getByRole('button', { name: 'Release ৳1,500 to the seller' });
    fireEvent.click(release);
    fireEvent.click(release);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(be.called('POST /orders/o-1/confirm-receipt')).toHaveLength(1);
    expect(await screen.findByText('Completed')).toBeTruthy();
  });

  it('FR-PAY-09 the buyer asks to cancel with a reason; the request and its state are shown', async () => {
    let current = order();
    const be = backend({
      'POST /orders/o-1/cancellation-requests': (c) => {
        current = order({ cancellationRequest: { id: 'r-1', status: 'pending', reason: (c.body as { reason: string }).reason, createdAt: iso(0) } });
        return json(201, current)();
      },
    }, { order: () => current });
    renderApp('/orders/o-1', be);
    fireEvent.click(await screen.findByRole('button', { name: 'Ask the seller to cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send the request' }));
    expect(await screen.findByText('Please give a reason.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: '  Bought the wrong size  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send the request' }));
    expect(await screen.findByText('You asked the seller to cancel. Waiting for their answer.')).toBeTruthy();
    expect(screen.getByText('Reason given: Bought the wrong size')).toBeTruthy();
    expect(be.called('POST /orders/o-1/cancellation-requests')[0].body).toEqual({ reason: 'Bought the wrong size' });
    expect(screen.queryByRole('button', { name: 'Ask the seller to cancel' })).toBeNull();
  });

  it('FR-PAY-09 FR-TNS-04 the seller answers a request, or cancels: a full refund and a strike, stated first', async () => {
    const pending = { id: 'r-1', status: 'pending' as const, reason: 'Wrong size', createdAt: iso(0) };
    const be = backend({
      'POST /orders/o-1/cancellation-requests/r-1/decision': json(200, order({ role: 'seller', status: 'cancelled', escrow: { ...order().escrow!, state: 'refunded' } })),
      'POST /orders/o-1/cancel': json(200, order({ role: 'seller', status: 'cancelled', escrow: { ...order().escrow!, state: 'refunded' } })),
    }, { order: order({ role: 'seller', cancellationRequest: pending }), handover: handover({ role: 'seller', code: null, attemptsLeft: 5 }) });
    renderApp('/orders/o-1', be);
    expect(await screen.findByText('The buyer asked you to cancel this order.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Accept the cancellation' }));
    const accept = await screen.findByRole('dialog');
    expect(within(accept).getByText('Accepting cancels the order and refunds the buyer ৳1,500 in full.')).toBeTruthy();
    fireEvent.click(within(accept).getByRole('button', { name: 'Back' }));

    fireEvent.click(screen.getByRole('button', { name: 'Cancel this order' }));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'The item broke' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(libEn['confirm.seller_cancel'].replace('{amount}', '৳1,500'))).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel and refund ৳1,500' }));
    await waitFor(() => expect(be.called('POST /orders/o-1/cancel')).toHaveLength(1));
    expect(be.called('POST /orders/o-1/cancel')[0].body).toEqual({ reason: 'The item broke' });
    expect(be.called('POST /orders/o-1/cancellation-requests/r-1/decision')).toHaveLength(0);
  });

  it('IF-UI-05 an action the server refuses as the state changed refreshes the order and says so', async () => {
    const be = backend({ 'POST /orders/o-1/confirm-receipt': problem(409, 'order-state') }, { order: order({ deliveryEventAt: iso(-HOUR) }) });
    renderApp('/orders/o-1', be);
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm you received the item' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Release ৳1,500 to the seller' }));
    expect(await screen.findByText('This order has changed. Its latest state is shown.')).toBeTruthy();
    await waitFor(() => expect(be.called('GET /orders/o-1').length).toBeGreaterThanOrEqual(2));
  });
});

describe('the meetup handover (Unit 4)', () => {
  it('FR-DLV-06 the buyer\'s code is hidden behind "Show code", with its instruction, digit by digit', async () => {
    renderApp('/orders/o-1', backend());
    expect(await screen.findByText(libEn['confirm.share_handover_code'])).toBeTruthy();
    expect(screen.queryByText('4 8 1 9 0 2')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show code' }));
    // the terms come first; the code is not shown until the buyer agrees
    expect(screen.getByText(/You alone are responsible for checking the item/)).toBeTruthy();
    expect(screen.queryByText('4 8 1 9 0 2')).toBeNull();
    expect((screen.getByRole('button', { name: 'I agree, show the code' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'I agree, show the code' }));
    expect(await screen.findByText('4 8 1 9 0 2')).toBeTruthy(); // after the acceptance is kept
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByText('4 8 1 9 0 2')).toBeNull();
    expect(spaced('481902', 'bn')).toBe('৪ ৮ ১ ৯ ০ ২');
  });

  it('FR-DLV-06 U10-23 an item with a device identifier: after the terms the buyer types the device\'s number; a wrong one is refused with the tries left; the right one shows the code', async () => {
    let h = handover({ code: null, deviceCheck: { required: true, matched: false, last4: '1481', attemptsLeft: 5 } } as never);
    const be = backend({
      'POST /orders/o-1/device-check': [json(200, { matched: false, attemptsLeft: 4 }), () => { h = handover({ deviceCheck: { required: true, matched: true, last4: '1481', attemptsLeft: 4 } } as never); return json(200, { matched: true, attemptsLeft: 4 })(); }],
    }, { handover: () => h });
    renderApp('/orders/o-1', be);
    fireEvent.click(await screen.findByRole('button', { name: 'Show code' }));
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'I agree, show the code' }));
    const box = await screen.findByLabelText(/IMEI or serial number shown on the device/);
    expect(screen.getByText('•••• 1481')).toBeTruthy();
    fireEvent.change(box, { target: { value: '352099001761480' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByText(/does not match the listing\. Do not accept this device\. Tries left: 4/)).toBeTruthy();
    fireEvent.change(box, { target: { value: '352099001761481' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByText('4 8 1 9 0 2')).toBeTruthy(); // the code, once the device matched
    expect(be.called('POST /orders/o-1/device-check').map((c) => c.body)).toEqual([{ value: '352099001761480' }, { value: '352099001761481' }]);
  });

  it('FR-DLV-06 U10-23 the seller adds a photo of the item before entering the code; other files are refused before upload', async () => {
    const be = backend({ 'POST /orders/o-1/handover-photos': json(201, { count: 1 }) }, { order: order({ role: 'seller' }), handover: handover({ role: 'seller', code: null, photoCount: 0, attemptsLeft: 5 } as never) });
    renderApp('/orders/o-1', be);
    fireEvent.click(await screen.findByRole('button', { name: 'Start the handover' }));
    const input = await screen.findByLabelText('Add a photo of the item (before you enter the code)');
    fireEvent.change(input, { target: { files: [new File([new Uint8Array(10)], 'x.pdf', { type: 'application/pdf' })] } });
    expect(await screen.findByText(/x\.pdf cannot be used/)).toBeTruthy();
    fireEvent.change(input, { target: { files: [new File([new Uint8Array(10)], 'item.jpg', { type: 'image/jpeg' })] } });
    await waitFor(() => expect(be.called('POST /orders/o-1/handover-photos')).toHaveLength(1));
  });

  it('FR-DLV-06 the seller enters the code only after the handover, sees the attempts left, and a wrong code says how many remain', async () => {
    const be = backend({
      'POST /orders/o-1/handover-code': [
        problem(409, 'delivery-refused', { errors: [{ field: 'code', reason: 'wrong_code', attemptsLeft: 4 }] }),
        json(200, { status: 'completed', completedAt: iso(0) }),
      ],
    }, { order: order({ role: 'seller' }), handover: handover({ role: 'seller', code: null, attemptsLeft: 5 }) });
    renderApp('/orders/o-1', be);
    expect(await screen.findByText('Hand over the item only after the buyer gives you the code.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Show code' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Start the handover' }));          // step 1 is the photo; the code is step 2
    expect(await screen.findByText('Step 1 of 2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Step 2 of 2')).toBeTruthy();
    expect(screen.getByText('Wrong codes allowed before the lock: 5')).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Buyer's code"), { target: { value: '12 34 56' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm the handover' }));
    expect(await screen.findByText('That code is not right. Wrong codes allowed before the lock: 4')).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Buyer's code"), { target: { value: '৪৮১৯০২' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm the handover' }));
    await waitFor(() => expect(be.called('POST /orders/o-1/handover-code')).toHaveLength(2));
    expect(be.called('POST /orders/o-1/handover-code').map((c) => c.body)).toEqual([{ code: '123456' }, { code: '481902' }]);
  });

  it('FR-DLV-03 FR-DLV-04 a suggested point has a map link; a place of the parties\' own has a safety notice and none', async () => {
    const theirs = { id: 'q-1', byMe: false, meetAt: iso(24 * HOUR), note: 'Near the gate', point: null, place: { name: 'Bashundhara City food court', lat: 23.75, lng: 90.39, mapUrl: 'https://www.openstreetmap.org/x' }, status: 'proposed' as const, createdAt: iso(0) };
    let h = handover({ proposals: [theirs] });
    const be = backend({
      'POST /orders/o-1/meetup-proposals/q-1/accept': () => {
        h = handover({ status: 'agreed', proposals: [{ ...theirs, status: 'accepted' }], agreed: { point: null, place: theirs.place, meetAt: theirs.meetAt } });
        return json(200, h)();
      },
    }, { handover: () => h });
    renderApp('/orders/o-1', be);
    const proposal = (await screen.findByRole('heading', { name: 'The other party proposes' })).parentElement!;
    expect(within(proposal).getByText('Bashundhara City food court')).toBeTruthy();
    expect(within(proposal).getByText('Meet in a busy public place, in daylight.')).toBeTruthy();
    expect(within(proposal).queryByRole('link')).toBeNull(); // never a map link for a user's own place
    expect(within(proposal).getByText('Note: Near the gate')).toBeTruthy();
    fireEvent.click(within(proposal).getByRole('button', { name: 'Accept' }));
    expect(await screen.findByText('Place', { selector: 'dt' })).toBeTruthy(); // the agreed place and time are ruled cells
    expect(screen.getByText('Agreed', { selector: 'dd' })).toBeTruthy();
    expect(be.called('POST /orders/o-1/meetup-proposals/q-1/accept')).toHaveLength(1);

    cleanup();
    renderApp('/orders/o-1', backend());
    fireEvent.click(await screen.findByRole('button', { name: 'Propose a place and time' }));
    const link = screen.getByRole('link', { name: 'Open in map' });
    expect(link.getAttribute('href')).toBe(point.mapUrl);
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('FR-DLV-04 a proposal is a point or a named place and a time in Dhaka time; a proposal of one\'s own can be withdrawn', async () => {
    const mine = { id: 'q-2', byMe: true, meetAt: iso(24 * HOUR), note: null, point, place: null, status: 'proposed' as const, createdAt: iso(0) };
    let h = handover();
    const be = backend({
      'POST /orders/o-1/meetup-proposals': () => { h = handover({ proposals: [mine] }); return json(201, h)(); },
      'POST /orders/o-1/meetup-proposals/q-2/withdraw': () => { h = handover({ proposals: [{ ...mine, status: 'withdrawn' }] }); return json(200, h)(); },
    }, { handover: () => h });
    renderApp('/orders/o-1', be);
    fireEvent.click(await screen.findByRole('button', { name: 'Propose a place and time' }));
    fireEvent.click(screen.getByLabelText('Another public place'));
    expect(screen.getByText('Meet in a busy public place, in daylight.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Send the proposal' }));
    expect(await screen.findByText('Choose a date and time.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Date and time (Dhaka time)'), { target: { value: '2026-11-20T16:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send the proposal' }));
    expect(await screen.findByText('Enter the name of the place (at least 3 characters).')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Dhanmondi Police Station, Dhaka'));
    fireEvent.change(screen.getByLabelText('Note (optional)'), { target: { value: ' Blue shirt ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send the proposal' }));
    const withdraw = await screen.findByRole('button', { name: 'Withdraw' });
    expect(be.called('POST /orders/o-1/meetup-proposals')[0].body).toEqual({ meetAt: '2026-11-20T10:30:00.000Z', pointId: 'p-1', note: 'Blue shirt' });
    fireEvent.click(withdraw);
    await waitFor(() => expect(be.called('POST /orders/o-1/meetup-proposals/q-2/withdraw')).toHaveLength(1));
    expect(await screen.findByText(/Earlier proposals \(1\)/)).toBeTruthy();
  });

  it('FR-DLV-04 a place of the parties\' own may carry a pin from the device\'s position, asked for only by the button', async () => {
    const asked: number[] = [];
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: (ok: (p: { coords: { latitude: number; longitude: number } }) => void) => { asked.push(1); ok({ coords: { latitude: 23.7512345, longitude: 90.3912345 } }); } },
    });
    const be = backend({ 'POST /orders/o-1/meetup-proposals': json(201, handover()) });
    renderApp('/orders/o-1', be);
    fireEvent.click(await screen.findByRole('button', { name: 'Propose a place and time' }));
    fireEvent.click(screen.getByLabelText('Another public place'));
    expect(asked).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Add my current location as the pin (optional)' }));
    expect(await screen.findByText('Your current location is added as the pin.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Name of the place'), { target: { value: 'Bashundhara City food court' } });
    fireEvent.change(screen.getByLabelText('Date and time (Dhaka time)'), { target: { value: '2026-11-20T16:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send the proposal' }));
    await waitFor(() => expect(be.called('POST /orders/o-1/meetup-proposals')).toHaveLength(1));
    expect(be.called('POST /orders/o-1/meetup-proposals')[0].body).toEqual({ meetAt: '2026-11-20T10:30:00.000Z', placeName: 'Bashundhara City food court', placeLat: 23.75123, placeLng: 90.39123 });
  });

  it('FR-DLV-06 a locked or completed handover offers no code and no proposals', async () => {
    renderApp('/orders/o-1', backend({}, { handover: handover({ status: 'locked', code: null, lockedAt: iso(0) }) }));
    expect(await screen.findByText(/Too many wrong codes were entered/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Show code' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Propose a place and time' })).toBeNull();
  });

  it('FR-DLV-06 right after payment the handover may not exist yet: the page asks again instead of showing an error', async () => {
    const be = backend({ 'GET /orders/o-1/handover': [problem(404, 'not-found'), problem(404, 'not-found'), json(200, handover())] });
    renderApp('/orders/o-1', be);
    expect(await screen.findByRole('button', { name: 'Show code' }, { timeout: 6000 })).toBeTruthy();
    expect(be.called('GET /orders/o-1/handover')).toHaveLength(3);
    expect(screen.queryByText('This page or item no longer exists.')).toBeNull();
  });

  it('FR-DLV-04 a time typed as Dhaka time is that instant, whatever the device\'s zone', () => {
    expect(dhakaInput('2026-11-20T00:15')).toBe('2026-11-19T18:15:00.000Z');
    expect(dhakaInput('')).toBeNull();
    expect(dhakaInput('2026-11-20')).toBeNull();
  });
});

describe('courier delivery and shipments (Unit 4)', () => {
  const courierOrder = (o: Partial<OrderView> = {}) => order({ fulfilment: 'courier', deliveryFee: '9000', total: '159000', ...o });

  it('FR-DLV-10 FR-DLV-14 NFR-CMP-05 a shipment shows its status, history, "simulated", no cash to collect, one\'s own address and the other\'s district only', async () => {
    renderApp('/orders/o-1', backend({ 'GET /orders/o-1/shipments': json(200, { items: [shipment()] }) }, { order: courierOrder() }));
    const panel = (await screen.findByRole('heading', { name: 'Delivery' })).closest('section')!;
    expect(within(panel).getByText(libEn['sim.courier'])).toBeTruthy();
    expect(within(panel).getByText('To the buyer: Booked with the courier')).toBeTruthy(); // for assistive technology; the strip shows it as a cell
    expect(within(panel).getByText('To the buyer', { selector: 'dt' }).nextElementSibling?.textContent).toBe('Booked with the courier');
    expect(within(panel).getByText('Rahim, House 12, Road 5, Dhanmondi, Dhaka')).toBeTruthy();
    expect(within(panel).getByText("Seller's district").nextElementSibling?.textContent).toBe('Khulna');
    // the status history opens in a popup
    fireEvent.click(screen.getByRole('button', { name: 'Status history' })); // a cell in the rail
    expect(within(await screen.findByRole('dialog')).getAllByRole('listitem').map((l) => l.textContent)).toEqual([expect.stringMatching(/^Preparing/), expect.stringMatching(/^Booked with the courier/)]);
    expect(screen.queryByRole('heading', { name: 'Meetup handover' })).toBeNull();
  });

  it('FR-DLV-07 the seller gives a saved pickup address while the shipment is preparing, or adds one', async () => {
    const be = backend({
      'GET /orders/o-1/shipments': json(200, { items: [shipment({ status: 'preparing', needsPickupAddress: true, myAddress: null, other: { district: 'Dhaka' } })] }),
      'GET /me/addresses': json(200, { items: [address({ id: 'a-9', kind: 'pickup', label: 'Shop' }), address()] }),
      'PUT /orders/o-1/shipment/pickup-address': json(200, {}),
      'POST /me/addresses': json(201, address({ id: 'a-10', kind: 'pickup', label: 'Store' })),
    }, { order: courierOrder({ role: 'seller' }) });
    renderApp('/orders/o-1', be);
    expect(await screen.findByText('Choose where the courier collects the item. The buyer sees only your district.')).toBeTruthy();
    expect(await screen.findByLabelText('Shop: House 12, Road 5, Dhanmondi, Dhaka')).toBeTruthy();
    expect(screen.queryByLabelText('Home: House 12, Road 5, Dhanmondi, Dhaka')).toBeNull(); // drop-off addresses are not offered
    fireEvent.click(screen.getByRole('button', { name: 'Use this address' }));
    await waitFor(() => expect(be.called('PUT /orders/o-1/shipment/pickup-address')[0]?.body).toEqual({ addressId: 'a-9' }));

    fireEvent.click(screen.getByRole('button', { name: 'Add an address' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save the address' }));
    expect(await screen.findByText('Fill in the name, area, house and road, and contact name.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Name for this address (for example Home)'), { target: { value: 'Store' } });
    fireEvent.change(await screen.findByLabelText('Area'), { target: { value: '7' } });
    fireEvent.change(screen.getByLabelText('House, road'), { target: { value: 'Shop 4, Market Road' } });
    fireEvent.change(screen.getByLabelText('Contact name'), { target: { value: 'Karim' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save the address' }));
    await waitFor(() => expect(be.called('POST /me/addresses')[0]?.body).toEqual({ kind: 'pickup', label: 'Store', areaId: 7, line1: 'Shop 4, Market Road', contactName: 'Karim' }));
  });

  it('FR-DSP-06 the seller confirms that a returned item has arrived, once', async () => {
    const be = backend({
      'GET /orders/o-1/shipments': json(200, { items: [shipment({ status: 'delivered' }), shipment({ id: 's-2', direction: 'return', status: 'in_transit' })] }),
      'POST /orders/o-1/return/received': json(200, { status: 'received', at: iso(0) }),
    }, { order: courierOrder({ role: 'seller', deliveryEventAt: iso(-HOUR) }) });
    renderApp('/orders/o-1', be);
    fireEvent.click(await screen.findByRole('button', { name: 'Return received' }));
    expect(await screen.findByText('Thank you. The return is recorded.')).toBeTruthy();
    expect(be.called('POST /orders/o-1/return/received')).toHaveLength(1);
    expect(screen.getAllByText("Buyer's district")).toHaveLength(2);
  });

  it('FR-DLV-02 DV-23 courier before payment: a saved address, a binding quote with its expiry, then courier with that quote', async () => {
    let current = order({ status: 'awaiting_payment', escrow: null, paidAt: null, paymentDueAt: iso(HOUR), fulfilment: null, fulfilmentOptions: ['courier'] });
    const be = backend({
      'GET /me/addresses': json(200, { items: [address()] }),
      'POST /delivery/quotes': [
        problem(503, 'courier-unavailable'),
        json(201, { id: 'qt-1', listingId: 'l-1', quantity: 1, addressId: 'a-1', fee: '9000', expiresAt: iso(10 * 60_000), distanceKm: 4 }),
      ],
      'PUT /orders/o-1/fulfilment': () => { current = { ...current, fulfilment: 'courier', deliveryFee: '9000', total: '159000' }; return json(200, current)(); },
    }, { order: () => current });
    renderApp('/orders/o-1', be);
    fireEvent.click(await screen.findByRole('button', { name: /Courier to my address/ })); // the courier details open in a popup
    expect(await screen.findByRole('dialog')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Get the delivery fee' }));
    expect(await screen.findByText('Courier delivery is unavailable right now. Please try again shortly, or pick the item up.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Get the delivery fee' }));
    expect(await screen.findByText('Delivery fee')).toBeTruthy();
    expect(screen.getByText('Delivery fee').nextElementSibling?.textContent).toBe('৳90');
    expect(screen.getByText('Valid for').nextElementSibling?.textContent).toMatch(/^(10:00|9:5\d)/);
    expect(be.called('POST /delivery/quotes')[1].body).toEqual({ listingId: 'l-1', quantity: 1, addressId: 'a-1' });
    fireEvent.click(screen.getByRole('button', { name: 'Use courier delivery (৳90)' }));
    // the courier terms come first; courier is not chosen until the buyer accepts them
    expect(be.called('PUT /orders/o-1/fulfilment')).toHaveLength(0);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'I agree, use courier delivery' }));
    expect(await screen.findByRole('button', { name: 'Pay ৳1,590' })).toBeTruthy();
    expect(be.called('PUT /orders/o-1/fulfilment')[0].body).toEqual({ fulfilment: 'courier', quoteId: 'qt-1' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()); // the courier popup and the terms close once courier is chosen
    expect(screen.getByText('Courier')).toBeTruthy();
  });
});

describe('the list of orders', () => {
  it('NFR-USE-07 IF-UI-05 the list is a ruled grid with the item, status, seller and money, and a receipt for a paid order; the tab is asked of the server', async () => {
    const photo = { ...order().listing, photoKey: 'ph-1' };
    const be = backend({
      'GET /orders': json(200, { items: [
        order({ id: 'o-2', listing: photo, counterparty: { id: 's-1', displayName: 'Rahim Traders' } }),
        order({ id: 'o-5', status: 'awaiting_payment', escrow: null, paidAt: null, listing: { ...photo, title: 'Unpaid lamp' } }),
      ], nextCursor: null }),
    });
    renderApp('/orders', be);
    await screen.findByRole('link', { name: 'Desk lamp' });
    expect(be.calls.some((c) => c.path === '/orders' && c.query.get('stage') === 'orders' && c.query.get('role') === 'buyer')).toBe(true);
    const list = screen.getByRole('region', { name: 'Orders' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(list).getByText('Rahim Traders')).toBeTruthy();                       // the seller, in a column of their own
    expect(list.querySelector('img')?.getAttribute('src')).toBe('/api/v1/listing-photos/ph-1?size=thumb');
    expect(within(list).getAllByRole('button', { name: /^Download the receipt for/ })).toHaveLength(1);   // only the paid order has one
  });

  it('IF-UI-05 the stage tabs are Orders, On the way and Completed; a cancelled order is marked in Completed', async () => {
    const be = backend({
      'GET /orders': (c) => json(200, { items: c.query.get('stage') === 'completed'
        ? [order({ id: 'o-6', status: 'cancelled', escrow: null, paidAt: null, cancelledAt: '2026-11-02T10:00:00Z', listing: { ...order().listing, title: 'Gone phone' } })] : [], nextCursor: null })(),
    });
    renderApp('/orders', be);
    expect(await screen.findByText('No orders waiting.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /On the way/ }));
    expect(await screen.findByText('Nothing on the way.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Completed/ }));
    expect(await screen.findByRole('link', { name: 'Gone phone' })).toBeTruthy();
    expect(screen.getByText('Cancelled')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /receipt/ })).toBeNull();
  });

  it('IF-UI-05 bought and sold orders, each with its status, total and where the money is, more on request', async () => {
    const be = backend({
      'GET /orders': (c) => {
        const role = c.query.get('role');
        if (role === 'seller') return json(200, { items: [], nextCursor: null })();
        if (c.query.get('cursor') === 'next') return json(200, { items: [order({ id: 'o-3', listing: { ...order().listing, title: 'Old radio' }, status: 'closed', escrow: { ...order().escrow!, state: 'released' } })], nextCursor: null })();
        return json(200, { items: [order({ id: 'o-2' })], nextCursor: 'next' })();
      },
    });
    renderApp('/orders', be);
    const link = await screen.findByRole('link', { name: 'Desk lamp' });
    expect(link.getAttribute('href')).toBe('/orders/o-2');
    expect(screen.getByText(/^Paid/)).toBeTruthy();                    // the status and the day, with the amount in its own column
    expect(screen.getByText('৳1,500')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(await screen.findByRole('link', { name: 'Old radio' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sold' }));
    expect(await screen.findByText('No orders waiting.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sold' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('IF-UI-05 the order view in Bangla: the handover and the deadlines in Bangla with Bangla digits', async () => {
    renderApp('/orders/o-1', backend(), 'bn');
    expect(await screen.findByRole('heading', { name: 'সাক্ষাতে হস্তান্তর' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'কোড দেখুন' }));
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'আমি রাজি, কোড দেখান' }));
    expect(await screen.findByText('৪ ৮ ১ ৯ ০ ২')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'সময়সীমা' })).toBeTruthy();
  });
});

describe('the order\'s counterfoil (money-order world, U10-14)', () => {
  it('NFR-USE-07 the steps follow the order: payment, the handover, the end; a cancelled order has none', () => {
    const states = (o: OrderView) => stepsOf(o).map((x) => x.state).join(' ');
    expect(states(order({ status: 'awaiting_payment' }))).toBe('current next next');
    expect(states(order({ status: 'paid', deliveryEventAt: null }))).toBe('done current next');
    expect(states(order({ status: 'paid', deliveryEventAt: '2026-11-02T10:00:00Z' }))).toBe('done done current');
    expect(states(order({ status: 'closed' }))).toBe('done done done');
    expect(stepsOf(order({ status: 'cancelled' }))).toEqual([]);
  });

  it('NFR-USE-07 the order page shows the steps with the current one marked, in words too', async () => {
    renderApp('/orders/o-1', backend({}));
    const steps = await screen.findByRole('list', { name: 'Order progress' });
    const items = within(steps).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual(['Payment complete (done)', 'Money on hold (now)', 'Seller paid (still to come)']);
    expect(items[1].getAttribute('aria-current')).toBe('step');
  });

  it('NFR-USE-07 where the money is, the total once, and the steps stand on one ruled panel (AC-ORD-2)', async () => {
    renderApp('/orders/o-1', backend({}));
    const money = await screen.findByRole('region', { name: 'Money for this order' });
    expect(within(money).getByRole('list', { name: 'Order progress' })).toBeTruthy();
    expect(within(money).getAllByText('৳1,500')).toHaveLength(1);     // the total is named once, not on a stub and again on a form
  });

  it('NFR-USE-07 the postmark carries the day only once the money has left TrustBazaar (AC-ORD-2)', () => {
    const closedAt = '2026-11-20T20:00:00Z';                         // 21 November in Dhaka
    expect(postmarkOf(order({ status: 'paid' }), 'en')).toBeUndefined();
    expect(postmarkOf(order({ status: 'closed', closedAt, escrow: { ...order().escrow!, state: 'released' } }), 'en')).toBe('21 Nov 2026');
    expect(postmarkOf(order({ status: 'closed', closedAt, escrow: { ...order().escrow!, state: 'refunded' } }), 'bn')).toMatch(/^২১/);
    expect(postmarkOf(order({ status: 'cancelled', closedAt, escrow: null }), 'en')).toBeUndefined();
  });
});

