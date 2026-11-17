// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, configure, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { fakeBackend, json, problem, renderApp, standInMe, type Call } from '../../testing/app';
import type { DisputeSummary, DisputeView } from './Disputes';
import type { OrderView } from './model';
import type { OrderRatings, RatingView } from './Ratings';
import libEn from '../../lib/messages/en.json';

// Disputes and ratings on the order view (docs/design/08_frontend.pdf section 7.7; Unit 7; U8-09): only the types
// allowed now, a description of at least 20 characters, up to 10 images, confirm.open_dispute; the dispute's status,
// deadlines as countdowns, statements, evidence and outcome; withdrawal with confirm.withdraw_dispute; the rating
// form with its window, the edit period and the one public reply.

configure({ asyncUtilTimeout: 3000 });
afterEach(() => cleanup());

const HOUR = 3_600_000;
const iso = (offset: number) => new Date(Date.now() + offset).toISOString();
const order = (o: Partial<OrderView> = {}): OrderView => ({
  id: 'o-1', kind: 'fixed_price', role: 'buyer', status: 'paid',
  listing: { id: 'l-1', title: 'Desk lamp', itemKind: 'physical', photoKey: null }, threadId: null, quantity: 1,
  itemPrice: '150000', deliveryFee: '0', total: '150000', fulfilment: 'self_pickup', fulfilmentOptions: ['self_pickup'],
  paymentDueAt: iso(-2 * HOUR), paidAt: iso(-2 * HOUR), fulfilmentDueAt: iso(-HOUR), deliveryEventAt: iso(-HOUR), closedAt: null, cancellationRequest: null,
  escrow: { state: 'held', releasePolicy: 'standard', amountCollected: '150000', amountRefunded: '0', disputeWindowEndsAt: iso(47 * HOUR), autoReleaseAt: iso(48 * HOUR) },
  ...o,
});
const dispute = (d: Partial<DisputeView> = {}): DisputeView => ({
  id: 'd-1', orderId: 'o-1', role: 'buyer', type: 'damaged', status: 'open', description: 'The shade is cracked and the switch does not work.',
  openedAt: iso(-HOUR), sellerDueAt: iso(47 * HOUR), infoDueAt: null, reviewStartedAt: null, decisionTargetAt: null, outcome: null, withdrawnAt: null,
  statements: [], evidence: [], ...d,
});
const summary = (d: DisputeView): DisputeSummary => ({ id: d.id, type: d.type, status: d.status, openedAt: d.openedAt, outcome: d.outcome?.kind ?? null, decidedAt: null, withdrawnAt: null });
const rating = (r: Partial<RatingView> = {}): RatingView => ({
  id: 'r-1', orderId: 'o-1', stars: 4, text: 'Good lamp', createdAt: iso(-HOUR), editableUntil: iso(23 * HOUR), editedAt: null, reply: null, ...r,
});
const closed = (o: Partial<OrderView> = {}) => order({ status: 'closed', closedAt: iso(-HOUR), escrow: { ...order().escrow!, state: 'released' }, ...o });

type Answer = (c: Call) => Response | Promise<Response>;
function backend(answers: Record<string, Answer | Answer[]> = {}, o: { order?: OrderView; disputes?: () => DisputeSummary[]; ratings?: () => OrderRatings } = {}) {
  return fakeBackend({
    'GET /me': json(200, standInMe),
    'POST /auth/refresh': json(401, {}),
    'GET /notifications/unread-count': json(200, { unread: 0 }),
    'GET /me/notification-preferences': json(200, { language: 'en', emailTransactional: true }),
    'GET /orders/o-1': json(200, o.order ?? order()),
    'GET /orders/o-1/handover': json(200, { orderId: 'o-1', role: 'buyer', status: 'completed', dueAt: iso(0), proposals: [], agreed: null, suggestions: [], code: null, attemptsLeft: null, completedAt: iso(-HOUR), lockedAt: null }),
    'GET /orders/o-1/disputes': () => json(200, { items: o.disputes?.() ?? [] })(),
    'GET /orders/o-1/dispute-types': json(200, { types: ['not_as_described', 'damaged', 'other'], openDisputeId: null }),
    'GET /orders/o-1/ratings': () => json(200, o.ratings?.() ?? { canRate: false, rateUntil: null, mine: null, received: null })(),
    ...answers,
  });
}
const image = (name: string, type = 'image/jpeg', size = 1000) => new File([new Uint8Array(size)], name, { type });

describe('disputes', () => {
  it('FR-DSP-01 CP-33 the buyer opens a dispute of an allowed type, after its consequence, then the photos follow one by one', async () => {
    let list: DisputeSummary[] = [];
    const be = backend({
      'POST /orders/o-1/disputes': () => { list = [summary(dispute())]; return json(201, { disputeId: 'd-1' })(); },
      'POST /disputes/d-1/evidence': [json(201, { evidenceId: 'e-1' }), problem(400, 'validation-failed'), json(201, { evidenceId: 'e-3' })],
      'GET /disputes/d-1': json(200, dispute()),
    }, { disputes: () => list });
    renderApp('/orders/o-1', be);
    fireEvent.click(await screen.findByRole('button', { name: 'Open a dispute' }));
    expect(screen.getAllByRole('radio').map((r) => (r.nextElementSibling as HTMLElement).textContent))
      .toEqual(['The item is not as described', 'The item arrived damaged', 'Something else']); // only what the server allows now
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Choose what went wrong.')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('The item arrived damaged'));
    fireEvent.change(screen.getByLabelText('Describe the problem'), { target: { value: 'Cracked shade' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Describe the problem in at least 20 characters.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Describe the problem'), { target: { value: '  The shade is cracked and the switch does not work.  ' } });
    const files = screen.getByLabelText(/^Photos \(optional, up to 10/);
    fireEvent.change(files, { target: { files: [image('a.pdf', 'application/pdf')] } });
    expect(await screen.findByText('a.pdf cannot be used. Choose a JPEG, PNG or WebP image of at most 10 MB.')).toBeTruthy();
    fireEvent.change(files, { target: { files: [image('1.jpg'), image('2.png', 'image/png'), image('3.webp', 'image/webp')] } });
    expect(screen.getByText('Photos chosen: 3')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(libEn['confirm.open_dispute'])).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Open the dispute' }));
    expect(await screen.findByRole('heading', { name: 'Dispute: The item arrived damaged' })).toBeTruthy();
    expect(await screen.findByText('The dispute is open, but these photos could not be added: 2.png. You can add them below.')).toBeTruthy();
    const opened = be.called('POST /orders/o-1/disputes');
    expect(opened).toHaveLength(1);
    expect(opened[0].body).toEqual({ type: 'damaged', description: 'The shade is cracked and the switch does not work.' });
    expect(opened[0].headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
    expect(be.called('POST /disputes/d-1/evidence').map((c) => ((c.body as FormData).get('file') as File).name)).toEqual(['1.jpg', '2.png', '3.webp']);
    expect(screen.queryByRole('button', { name: 'Open a dispute' })).toBeNull();
  });

  it('FR-DSP-11 I-56 no dispute can be opened when the server allows no type, nor by the seller', async () => {
    renderApp('/orders/o-1', backend({ 'GET /orders/o-1/dispute-types': json(200, { types: [], openDisputeId: null }) }));
    expect(await screen.findByText(/You are the buyer/)).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Open a dispute' })).toBeNull());
    cleanup();
    const be = backend({}, { order: order({ role: 'seller' }) });
    renderApp('/orders/o-1', be);
    expect(await screen.findByText(/You are the seller/)).toBeTruthy();
    expect(be.called('GET /orders/o-1/dispute-types')).toHaveLength(0);
  });

  it('FR-DSP-04 the seller finds the dispute on the order, sees the response deadline as a countdown, and responds', async () => {
    let d = dispute({ role: 'seller' });
    const be = backend({
      'GET /disputes/d-1': () => json(200, d)(),
      'POST /disputes/d-1/statements': (c) => {
        d = dispute({ role: 'seller', status: 'under_review', decisionTargetAt: iso(72 * HOUR), statements: [{ party: 'seller', text: (c.body as { text: string }).text, at: iso(0) }] });
        return json(201, { status: 'under_review' })();
      },
    }, { order: order({ role: 'seller', escrow: { ...order().escrow!, state: 'frozen_disputed' } }), disputes: () => [summary(d)] });
    renderApp('/orders/o-1', be);
    const panel = (await screen.findByRole('heading', { name: 'Dispute: The item arrived damaged' })).closest('section')!;
    expect(within(panel).getByText('The buyer opened a dispute. Please respond before the deadline.')).toBeTruthy();
    expect(within(panel).getByText('The seller must respond by').nextElementSibling?.textContent).toMatch(/\(in 1 day 2[23] h\)$/);
    expect(within(panel).getByText('Your first statement is your response. TrustBazaar then reviews the dispute.')).toBeTruthy();
    fireEvent.change(within(panel).getByLabelText('Your response'), { target: { value: ' It was packed well; see my photos. ' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Send the response' }));
    expect(await screen.findByText('TrustBazaar is reviewing the dispute.')).toBeTruthy();
    expect(be.called('POST /disputes/d-1/statements')[0].body).toEqual({ text: 'It was packed well; see my photos.' });
    expect(screen.getByText('TrustBazaar aims to decide by')).toBeTruthy();
    expect(screen.getByText('You')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Withdraw the dispute' })).toBeNull(); // the buyer's only
  });

  it('FR-DSP-07 after the decision both see the outcome and its reason; the photos are behind signed links', async () => {
    const d = dispute({
      status: 'decided', outcome: { kind: 'partial_refund', itemRefund: '50000', reason: 'The shade was cracked; the lamp works.', decidedAt: iso(-HOUR) },
      evidence: [{ id: 'e-1', mime: 'image/jpeg', size: 1000, at: iso(-2 * HOUR), link: { url: 'https://tb.test/api/v1/files/v/abc', expiresAt: iso(HOUR) } }, { id: 'e-2', mime: 'image/jpeg', size: 1, at: iso(-2 * HOUR), link: null }],
      statements: [{ party: 'seller', text: null, at: iso(-2 * HOUR) }],
    });
    renderApp('/orders/o-1', backend({ 'GET /disputes/d-1': json(200, d) }, { order: closed({ escrow: { ...order().escrow!, state: 'partially_refunded' } }), disputes: () => [summary(d)] }));
    expect(await screen.findByText('The buyer is refunded ৳500 of the item price; the rest goes to the seller.')).toBeTruthy();
    expect(screen.getByText('Reason: The shade was cracked; the lamp works.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Photo 1' }).getAttribute('href')).toBe('https://tb.test/api/v1/files/v/abc');
    expect(screen.getByText('Photo 2 (removed)')).toBeTruthy();
    expect(screen.getByText('(removed after the retention period)')).toBeTruthy();
    expect(screen.queryByLabelText('Add a statement')).toBeNull();
  });

  it('FR-DSP-10 withdrawing states that the seller is then paid automatically on the release time', async () => {
    let d = dispute();
    const be = backend({
      'GET /disputes/d-1': () => json(200, d)(),
      'POST /disputes/d-1/withdraw': () => { d = dispute({ status: 'withdrawn', withdrawnAt: iso(0) }); return json(200, { status: 'withdrawn' })(); },
    }, { disputes: () => [summary(d)] });
    renderApp('/orders/o-1', be);
    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw the dispute' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/^Withdrawing ends this dispute for good\. The seller is then paid automatically on .+ unless you open a different kind of dispute\.$/)).toBeTruthy();
    expect(within(dialog).queryByText(/\{at\}/)).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Withdraw' }));
    expect(await screen.findByText('You withdrew this dispute.')).toBeTruthy();
    expect(be.called('POST /disputes/d-1/withdraw')).toHaveLength(1);
  });

  it('CP-33 a party adds a photo to a live dispute; other files are refused before upload', async () => {
    const be = backend({ 'GET /disputes/d-1': json(200, dispute()), 'POST /disputes/d-1/evidence': json(201, { evidenceId: 'e-9' }) }, { disputes: () => [summary(dispute())] });
    renderApp('/orders/o-1', be);
    const input = await screen.findByLabelText('Add a photo (up to 10 more)');
    fireEvent.change(input, { target: { files: [image('big.jpg', 'image/jpeg', 10_485_761)] } });
    expect(await screen.findByText('big.jpg cannot be used. Choose a JPEG, PNG or WebP image of at most 10 MB.')).toBeTruthy();
    fireEvent.change(input, { target: { files: [image('seal.jpg')] } });
    await waitFor(() => expect(be.called('POST /disputes/d-1/evidence')).toHaveLength(1));
  });

  it('FR-DSP-07 /disputes/:id shows one dispute with a link to its order', async () => {
    renderApp('/disputes/d-1', backend({ 'GET /disputes/d-1': json(200, dispute()), 'GET /disputes/d-404': problem(404, 'not-found') }));
    expect(await screen.findByRole('heading', { name: 'Dispute: The item arrived damaged' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to the order' }).getAttribute('href')).toBe('/orders/o-1');
    cleanup();
    renderApp('/disputes/d-404', backend({ 'GET /disputes/d-404': problem(404, 'not-found') }));
    expect(await screen.findByRole('heading', { name: 'This dispute was not found.' })).toBeTruthy();
  });
});

describe('ratings', () => {
  it('FR-REV-01 FR-REV-02 after the order closes the buyer rates the seller, 1 to 5 stars, within the window', async () => {
    let r: OrderRatings = { canRate: true, rateUntil: iso(14 * 24 * HOUR), mine: null, received: null };
    const be = backend({
      'POST /orders/o-1/rating': (c) => { r = { ...r, canRate: false, mine: rating({ ...(c.body as object) }) }; return json(201, r.mine)(); },
    }, { order: closed(), ratings: () => r });
    renderApp('/orders/o-1', be);
    const form = await screen.findByRole('form', { name: 'Rate the seller' });
    expect(screen.getByText(/^You can rate until .+ \(in 14 days 0 h\)\.$|^You can rate until .+ \(in 13 days 23 h\)\.$/)).toBeTruthy();
    fireEvent.click(within(form).getByRole('button', { name: 'Send the rating' }));
    expect(await screen.findByText('Choose 1 to 5 stars.')).toBeTruthy();
    fireEvent.click(within(form).getByLabelText('5 of 5 stars'));
    fireEvent.change(within(form).getByLabelText('What would you tell others? (optional)'), { target: { value: '  Exactly as described.  ' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Send the rating' }));
    expect(await screen.findByRole('heading', { name: 'Your rating' })).toBeTruthy();
    expect(be.called('POST /orders/o-1/rating')[0].body).toEqual({ stars: 5, text: 'Exactly as described.' });
    expect(screen.queryByRole('form', { name: 'Rate the seller' })).toBeNull();
  });

  it('FR-REV-03 one\'s own rating can be edited until its edit period ends, and not after', async () => {
    let r: OrderRatings = { canRate: false, rateUntil: iso(10 * 24 * HOUR), mine: rating(), received: null };
    const be = backend({
      'PATCH /ratings/r-1': (c) => { r = { ...r, mine: rating({ ...(c.body as object), editedAt: iso(0) }) }; return json(200, r.mine)(); },
    }, { order: closed(), ratings: () => r });
    renderApp('/orders/o-1', be);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit your rating' }));
    const form = screen.getByRole('form', { name: 'Edit your rating' });
    expect((within(form).getByLabelText('4 of 5 stars') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(form).getByLabelText('3 of 5 stars'));
    fireEvent.change(within(form).getByLabelText('What would you tell others? (optional)'), { target: { value: '' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save the change' }));
    expect(await screen.findByText(/· edited$/)).toBeTruthy();
    expect(screen.getByText('3 of 5 stars')).toBeTruthy();
    expect(be.called('PATCH /ratings/r-1')[0].body).toEqual({ stars: 3, text: null });
    cleanup();
    renderApp('/orders/o-1', backend({}, { order: closed(), ratings: () => ({ canRate: false, rateUntil: iso(-HOUR), mine: rating({ editableUntil: iso(-HOUR) }), received: null }) }));
    expect(await screen.findByRole('heading', { name: 'Your rating' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit your rating' })).toBeNull();
  });

  it('FR-REV-06 the rated party replies once, publicly', async () => {
    let r: OrderRatings = { canRate: false, rateUntil: iso(-HOUR), mine: null, received: rating() };
    const be = backend({
      'POST /ratings/r-1/reply': (c) => { r = { ...r, received: rating({ reply: { text: (c.body as { text: string }).text, at: iso(0) } }) }; return json(200, r.received)(); },
    }, { order: closed({ role: 'seller' }), ratings: () => r });
    renderApp('/orders/o-1', be);
    expect(await screen.findByRole('heading', { name: "The buyer's rating of you" })).toBeTruthy();
    expect(screen.getByText('Your reply is shown under the rating and cannot be changed.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Reply publicly (once)'), { target: { value: ' Thank you! ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send the reply' }));
    expect(await screen.findByText('Reply: Thank you!')).toBeTruthy();
    expect(screen.queryByLabelText('Reply publicly (once)')).toBeNull();
  });

  it('FR-REV-01 nothing is asked before the escrow is terminal, and the ratings show in Bangla', async () => {
    const be = backend();
    renderApp('/orders/o-1', be);
    expect(await screen.findByText(/You are the buyer/)).toBeTruthy();
    expect(be.called('GET /orders/o-1/ratings')).toHaveLength(0);
    cleanup();
    renderApp('/orders/o-1', backend({}, { order: closed(), ratings: () => ({ canRate: true, rateUntil: iso(HOUR * 30), mine: null, received: null }) }), 'bn');
    expect(await screen.findByRole('heading', { name: 'বিক্রেতাকে রেটিং দিন' })).toBeTruthy();
    expect(screen.getByLabelText('৫টির মধ্যে ৫টি তারা')).toBeTruthy();
  });
});
