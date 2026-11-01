// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, configure, fireEvent, renderHook, screen, waitFor, within } from '@testing-library/react';
import { ApiError } from '../../lib/api.js';
import { placeholders } from '../../lib/i18n.js';
import { serverClock } from '../../shared/clock';
import { FakeSocket, fakeBackend, json, problem, renderApp, standInMe, type Call } from '../../testing/app';
import { useAnnouncer } from './announcer';
import { GUEST_POLL_MS, refusalText } from './AuctionPanel';
import type { AuctionState, ListingView, MyStatus } from './model';
import en from '../../messages/en/listings.json';
import bn from '../../messages/bn/listings.json';
import libEn from '../../lib/messages/en.json';

// The listing page and its auction panel (IF-UI-03; FR-LST-06, FR-AUC-01 to FR-AUC-15, FR-SRC-04; NFR-USE-01;
// section 7.3): text as text, the countdown on the server's clock, bids checked before sending and sent once,
// live updates in order, reconnections, announcements, the close, the winner's order and second-chance offers.

configure({ asyncUtilTimeout: 3000 });
beforeEach(() => {
  serverClock.samples = [];
  serverClock.estimate = 0;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const ID = '7d1c2a3e-1111-4a5b-8c9d-000000000001';
const at = (ms: number) => new Date(Date.now() + ms).toISOString();

function auctionState(o: Partial<AuctionState> = {}): AuctionState {
  return {
    auctionId: ID, status: 'open', startPrice: '100000', price: '100000', bidCount: 1, leaderAlias: 1, endAt: at(3_600_000),
    hasReserve: true, reserveMet: false, minimumBid: '105000', serverTime: at(0), seq: 1, ...o,
  };
}
function listing(o: Partial<ListingView> = {}): ListingView {
  return {
    id: ID, itemKind: 'physical', saleFormat: 'fixed_price', status: 'active',
    category: { id: 1, slug: 'cameras', nameEn: 'Cameras', nameBn: 'ক্যামেরা' },
    title: 'Film camera <script>', description: 'Works well.\n<b>Leather</b> case included.', condition: 'used', noVisibleDefects: true,
    fulfilmentOptions: 'pickup_or_courier', district: 'Dhaka', price: '1500000', quantity: { total: 1, available: 1 }, currentlyReserved: false,
    photos: [
      { id: 'p1', position: 1, url: '/api/v1/listing-photos/k1', thumbUrl: '/api/v1/listing-photos/k1?size=thumb', width: 1600, height: 1200, showsDefects: false },
      { id: 'p2', position: 2, url: '/api/v1/listing-photos/k2', thumbUrl: '/api/v1/listing-photos/k2?size=thumb', width: 1600, height: 1200, showsDefects: true },
    ],
    clarifications: [{ id: 'c1', body: 'The strap is <i>new</i>.', at: '2026-11-01T12:00:00Z' }],
    auction: null, seller: { id: 'seller-1', displayName: 'Karim', verified: true, joinMonth: '2026-10' }, ...o,
  };
}
const auctionListing = (s: Partial<AuctionState> = {}) => listing({ saleFormat: 'auction', price: null, auction: auctionState(s) });
const none: MyStatus = { hasBid: false, yourMaximum: null, leading: false, yourAlias: null, orderId: null, secondChanceOffer: null };

function backend(o: { l?: ListingView; signedIn?: boolean; me?: typeof standInMe; state?: AuctionState | (() => AuctionState); mine?: MyStatus | (() => MyStatus); bid?: (c: Call) => Response; decision?: (c: Call) => Response } = {}) {
  return fakeBackend({
    'GET /me': o.signedIn === false ? json(401, { type: '/problems/session-ended' }) : json(200, o.me ?? standInMe),
    'POST /auth/refresh': json(401, {}),
    'GET /notifications/unread-count': json(200, { unread: 0 }),
    'GET /me/notification-preferences': json(200, { language: 'en', emailTransactional: true }),
    [`GET /listings/${ID}`]: o.l ? json(200, o.l) : problem(404, 'not-found'),
    [`GET /auctions/${ID}/state`]: () => json(200, typeof o.state === 'function' ? o.state() : (o.state ?? o.l?.auction))(),
    [`GET /auctions/${ID}/bids`]: json(200, { items: [
      { id: '2', bidderAlias: 2, amount: '120000', leading: false, at: '2026-11-01T10:00:00Z' },
      { id: '1', bidderAlias: 1, amount: '100000', leading: true, at: '2026-11-01T09:00:00Z' },
    ] }),
    [`GET /auctions/${ID}/my-status`]: () => json(200, typeof o.mine === 'function' ? o.mine() : (o.mine ?? none))(),
    [`POST /auctions/${ID}/bids`]: o.bid ?? json(201, { bidId: '9', outcome: 'leading', yourMaximum: '150000', state: auctionState({ price: '125000', seq: 2, bidCount: 2, leaderAlias: 3 }) }),
    [`POST /auctions/${ID}/second-chance/offer-1/decision`]: o.decision ?? json(200, { offerId: 'offer-1', status: 'accepted', orderId: 'o-10' }),
  });
}

describe('the listing page', () => {
  it('SEC-INP-03 the seller\'s text is shown as text; FR-LST-06 the district only; photos with their alternatives', async () => {
    renderApp(`/listings/${ID}`, backend({ l: listing() }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Film camera <script>' })).toBeTruthy();
    expect(screen.getByText(/<b>Leather<\/b> case included\./)).toBeTruthy();
    expect(document.querySelector('article b, article script, article i')).toBeNull();
    expect(screen.getByText('The strap is <i>new</i>.')).toBeTruthy();
    expect(screen.getByText('Added Sun 1 Nov 2026, 6:00 pm')).toBeTruthy();
    expect(screen.getByText('Dhaka')).toBeTruthy();
    const [first, second] = screen.getAllByRole('img') as HTMLImageElement[];
    expect(first.alt).toBe('Film camera <script>, photo 1 of 2');
    expect(first.getAttribute('srcset')).toBe('/api/v1/listing-photos/k1?size=thumb 400w, /api/v1/listing-photos/k1 1600w');
    expect(first.getAttribute('loading')).toBe('eager');
    expect(second.getAttribute('loading')).toBe('lazy');
    expect(screen.getByText('Shows defects')).toBeTruthy();
    expect(screen.getByText('Identity verified')).toBeTruthy();
    expect(screen.getByText('Member since October 2026')).toBeTruthy();
  });

  it('FR-FIX-01 a fixed-price item links to its checkout; not the seller\'s own, nor a reserved or sold one', async () => {
    renderApp(`/listings/${ID}`, backend({ l: listing() }));
    expect((await screen.findByRole('link', { name: 'Buy now for ৳15,000' })).getAttribute('href')).toBe(`/checkout/${ID}`);
    cleanup();
    renderApp(`/listings/${ID}`, backend({ l: listing({ currentlyReserved: true, quantity: { total: 1, available: 0 } }) }));
    expect(await screen.findByText(/Another buyer is paying for this item now/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Buy now/ })).toBeNull();
    cleanup();
    renderApp(`/listings/${ID}`, backend({ l: listing({ status: 'sold' }) }));
    expect(await screen.findByText('This item has been sold.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Buy now/ })).toBeNull();
    cleanup();
    renderApp(`/listings/${ID}`, backend({ l: listing({ status: 'pending_review' }), me: { ...standInMe, id: 'seller-1' } }));
    expect(await screen.findByText('Only you can see this listing. Status: waiting for review.')).toBeTruthy();
  });

  it('FR-SRC-04 a listing that is not public answers as not available', async () => {
    renderApp(`/listings/${ID}`, backend({}));
    expect(await screen.findByRole('heading', { name: 'This listing is not available. It may have been sold or removed.' })).toBeTruthy();
  });
});

describe('the auction panel', () => {
  it('FR-AUC-01 price, bids, the masked leader, the reserve, and a countdown on the server\'s clock', async () => {
    // the device clock is 10 minutes slow: the countdown still shows the time left on the server's clock
    const l = auctionListing({ serverTime: at(600_000), endAt: at(600_000 + 3_600_000) });
    renderApp(`/listings/${ID}`, backend({ l }));
    expect(await screen.findByText('৳1,000')).toBeTruthy();
    expect(screen.getByText('Bids: 1')).toBeTruthy();
    expect(screen.getByText('Leading: Bidder 1')).toBeTruthy();
    expect(screen.getByText('The reserve price has not been reached yet.')).toBeTruthy();
    expect(screen.getByRole('timer').textContent).toMatch(/^(1 h 00 min|59:\d\d)$/);
    expect(screen.getByRole('timer').getAttribute('aria-live')).toBe('off');
    expect(screen.queryByText(/a bid sent in the last second may arrive too late/)).toBeNull();
    // the rules open in place; the history by alias
    expect(screen.getByText('How bidding works').closest('details')).toBeTruthy();
    const history = screen.getByRole('heading', { name: 'Bid history' }).closest('section')!;
    expect((await within(history).findAllByRole('listitem')).map((li) => li.textContent)).toEqual([
      expect.stringContaining('Bidder 2৳1,200'), expect.stringContaining('Bidder 1৳1,000 (led)'),
    ]);
  });

  it('FR-AUC-02 an amount below the minimum, or not an amount, is explained before anything is sent', async () => {
    const be = backend({ l: auctionListing() });
    renderApp(`/listings/${ID}`, be);
    expect(await screen.findByText('Minimum bid: ৳1,050')).toBeTruthy();
    const input = await screen.findByLabelText('Your maximum bid (taka)');
    fireEvent.change(input, { target: { value: '১,০৪৯' } });
    fireEvent.click(screen.getByRole('button', { name: 'Place bid' }));
    expect(await screen.findByText('Enter at least ৳1,050.')).toBeTruthy();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    fireEvent.change(input, { target: { value: '12.345' } });
    fireEvent.click(screen.getByRole('button', { name: 'Place bid' }));
    expect(await screen.findByText('Use at most two decimal places.')).toBeTruthy();
    expect(be.called(`POST /auctions/${ID}/bids`)).toHaveLength(0);
  });

  it('FR-AUC-06 a bid is confirmed with its consequence, sent once with an idempotency key, and its outcome shown', async () => {
    let answer: (r: Response) => void = () => undefined;
    const be = backend({ l: auctionListing(), bid: () => new Promise<Response>((r) => { answer = r; }) as never });
    renderApp(`/listings/${ID}`, be);
    fireEvent.change(await screen.findByLabelText('Your maximum bid (taka)'), { target: { value: '1,500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Place bid' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(libEn['confirm.place_bid'].replace('{amount}', '৳1,500'))).toBeTruthy();
    expect(within(dialog).getByText(libEn['confirm.proxy_bid'].replace('{amount}', '৳1,500'))).toBeTruthy();
    const confirm = within(dialog).getByRole('button', { name: 'Bid ৳1,500' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(be.called(`POST /auctions/${ID}/bids`)).toHaveLength(1));
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    const sent = be.called(`POST /auctions/${ID}/bids`)[0];
    expect(sent.body).toEqual({ maximum: '150000' });
    expect(sent.headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
    await act(async () => answer(json(201, { bidId: '9', outcome: 'leading', yourMaximum: '150000', state: auctionState({ price: '125000', seq: 2, bidCount: 2, leaderAlias: 3 }) })()));
    expect(await screen.findByText('You are leading at ৳1,250.')).toBeTruthy();
    expect(screen.getByText('Leading: Bidder 3')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('FR-AUC-02 when the price moved meanwhile, the answer is shown with the new minimum and the state fetched again', async () => {
    let state = auctionState();
    const be = backend({ l: auctionListing(), state: () => state, bid: () => {
      state = auctionState({ price: '125000', minimumBid: '130000', seq: 4 });
      return problem(422, 'bid-refused', { errors: [{ field: 'maximum', reason: 'below_minimum', minimum: '130000' }] })();
    } });
    renderApp(`/listings/${ID}`, be);
    fireEvent.change(await screen.findByLabelText('Your maximum bid (taka)'), { target: { value: '1,100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Place bid' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Bid ৳1,100' }));
    expect(await screen.findByText('The price moved while you were deciding. The minimum bid is now ৳1,300.')).toBeTruthy();
    expect(await screen.findByText('Minimum bid: ৳1,300')).toBeTruthy();
  });

  it('FR-AUC-11 live states apply only when newer, in any order; the dialog follows the price while open', async () => {
    const socket = new FakeSocket();
    renderApp(`/listings/${ID}`, backend({ l: auctionListing() }), 'en', socket);
    await screen.findByLabelText('Your maximum bid (taka)');
    await waitFor(() => expect(socket.opened).toBe(1));
    act(() => socket.accept());
    await waitFor(() => expect(socket.rooms()).toEqual([`auction:${ID}`]));
    fireEvent.change(screen.getByLabelText('Your maximum bid (taka)'), { target: { value: '2,000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Place bid' }));
    const dialog = await screen.findByRole('dialog');
    act(() => socket.push('auction.state', { ...auctionState({ price: '140000', seq: 5, bidCount: 3 }) }));
    act(() => socket.push('auction.state', { ...auctionState({ price: '130000', seq: 4, bidCount: 2 }) }));   // late: dropped
    act(() => socket.push('auction.state', { ...auctionState({ price: '999900', seq: 9, auctionId: 'other' }) })); // another auction
    expect(await within(dialog).findByText('The current price is now ৳1,400.')).toBeTruthy();
    expect(screen.getByText('Bids: 3')).toBeTruthy();
  });

  it('IF-COM-02 after a reconnection the state is fetched again before further messages', async () => {
    const socket = new FakeSocket();
    let state = auctionState();
    const be = backend({ l: auctionListing(), state: () => state });
    renderApp(`/listings/${ID}`, be, 'en', socket);
    await screen.findByLabelText('Your maximum bid (taka)');
    await waitFor(() => expect(socket.opened).toBe(1));
    act(() => socket.accept());
    await waitFor(() => expect(be.called(`GET /auctions/${ID}/state`).length).toBeGreaterThan(0));
    const before = be.called(`GET /auctions/${ID}/state`).length;
    state = auctionState({ price: '160000', seq: 7, bidCount: 6 });
    act(() => socket.drop());
    act(() => socket.accept());
    await waitFor(() => expect(be.called(`GET /auctions/${ID}/state`).length).toBe(before + 1));
    expect(await screen.findByText('Bids: 6')).toBeTruthy();
    expect(socket.emitted.filter((e) => e.event === 'join')).toHaveLength(2);
  });

  it('FR-AUC-12 an outbid notice is announced at once and my status fetched again', async () => {
    const socket = new FakeSocket();
    let mine: MyStatus = { ...none, hasBid: true, yourMaximum: '150000', leading: true, yourAlias: 1 };
    const be = backend({ l: auctionListing(), mine: () => mine });
    renderApp(`/listings/${ID}`, be, 'en', socket);
    expect(await screen.findByText(/Your maximum: ৳1,500/)).toBeTruthy();
    expect(screen.getByText(/You are leading\./)).toBeTruthy();
    await waitFor(() => expect(socket.opened).toBe(1));
    act(() => socket.accept());
    mine = { ...mine, leading: false };
    act(() => socket.push('auction.outbid', { auctionId: ID, price: '155000', seq: 3 }));
    expect(await screen.findByText('You have been outbid.', { selector: '[aria-live="polite"]' })).toBeTruthy();
    expect(await screen.findByText(/Your maximum: ৳1,500 You have been outbid\./)).toBeTruthy();
  });

  it('FR-AUC-03 a leader raising their maximum is told when it is not higher, before sending', async () => {
    const be = backend({ l: auctionListing(), mine: { ...none, hasBid: true, yourMaximum: '150000', leading: true, yourAlias: 1 } });
    renderApp(`/listings/${ID}`, be);
    const input = await screen.findByLabelText('Your new maximum (taka)');
    fireEvent.change(input, { target: { value: '1,500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Raise my maximum' }));
    expect(await screen.findByText('Your new maximum must be higher than your current one.')).toBeTruthy();
    expect(be.called(`POST /auctions/${ID}/bids`)).toHaveLength(0);
  });

  it('DV-19 a guest is asked to sign in to bid, told there is no live channel, and the state is polled every 5 s', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const be = backend({ l: auctionListing(), signedIn: false });
    renderApp(`/listings/${ID}`, be);
    expect((await screen.findByRole('link', { name: 'Sign in to bid' })).getAttribute('href')).toBe(`/signin?next=${encodeURIComponent(`/listings/${ID}`)}`);
    expect(screen.getByText(/Sign in for live updates/)).toBeTruthy();
    const before = be.called(`GET /auctions/${ID}/state`).length;
    await act(async () => { vi.advanceTimersByTime(GUEST_POLL_MS); });
    await waitFor(() => expect(be.called(`GET /auctions/${ID}/state`).length).toBe(before + 1));
  });

  it('FR-AUC-01 near the end the late-bid warning is shown, and the last minute is announced once', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    renderApp(`/listings/${ID}`, backend({ l: auctionListing({ endAt: at(62_000) }) }));
    expect(await screen.findByText('The auction ends on the server\'s clock; a bid sent in the last second may arrive too late.')).toBeTruthy();
    await act(async () => { vi.advanceTimersByTime(3_000); });
    expect(await screen.findByText('1 minute left in this auction.', { selector: '[aria-live="polite"]' })).toBeTruthy();
  });

  it('FR-AUC-14 a closed auction says so; the winner is taken to their order', async () => {
    renderApp(`/listings/${ID}`, backend({ l: auctionListing({ status: 'awarded', price: '125000', minimumBid: null }), mine: { ...none, hasBid: true, yourMaximum: '150000', leading: true, orderId: 'o-9' } }));
    expect(await screen.findByText('Sold for ৳1,250.')).toBeTruthy();
    expect((await screen.findByRole('link', { name: 'Go to your order' })).getAttribute('href')).toBe('/orders/o-9');
    expect(screen.queryByLabelText(/Your maximum bid/)).toBeNull();
    cleanup();
    renderApp(`/listings/${ID}`, backend({ l: auctionListing({ status: 'unsold', minimumBid: null }) }));
    expect(await screen.findByText('This auction ended without a sale.')).toBeTruthy();
  });

  it('FR-AUC-14 the close arriving live is shown with the result fetched again', async () => {
    const socket = new FakeSocket();
    let state = auctionState();
    renderApp(`/listings/${ID}`, backend({ l: auctionListing(), state: () => state }), 'en', socket);
    await screen.findByLabelText('Your maximum bid (taka)');
    await waitFor(() => expect(socket.opened).toBe(1));
    act(() => socket.accept());
    state = auctionState({ status: 'awarded', minimumBid: null });   // closing does not change seq
    act(() => socket.push('auction.closed', { auctionId: ID, status: 'sold', finalPrice: '100000' }));
    expect(await screen.findByText('Sold for ৳1,000.')).toBeTruthy();
  });

  it('FR-AUC-15 a second-chance offer: its deadline, the consequence, and accepting goes to the new order', async () => {
    const offer = { id: 'offer-1', price: '120000', expiresAt: at(86_400_000) };
    const be = backend({ l: auctionListing({ status: 'awarded', minimumBid: null }), mine: { ...none, hasBid: true, yourMaximum: '120000', secondChanceOffer: offer } });
    const doc = renderApp(`/listings/${ID}`, be);
    const region = await screen.findByRole('region', { name: 'Second-chance offer' });
    expect(within(region).getByText('The winner did not pay. You can buy this item for ৳1,200, your highest bid.')).toBeTruthy();
    expect(within(region).getByText(/^Decide by .+ \(in 1 day 0 h\)\.$|^Decide by .+ \(in 23 h 59 min\)\.$/)).toBeTruthy();
    fireEvent.click(within(region).getByRole('button', { name: 'Accept for ৳1,200' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Accepting creates your order of ৳1,200/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Accept for ৳1,200' }));
    await waitFor(() => expect(doc.router.state.location.pathname).toBe('/orders/o-10'));
    expect(be.called(`POST /auctions/${ID}/second-chance/offer-1/decision`)[0].body).toEqual({ decision: 'accept' });
  });

  it('FR-AUC-15 declining is said in words; an offer no longer open is explained', async () => {
    const offer = { id: 'offer-1', price: '120000', expiresAt: at(3_600_000) };
    renderApp(`/listings/${ID}`, backend({ l: auctionListing({ status: 'awarded', minimumBid: null }), mine: { ...none, secondChanceOffer: offer },
      decision: (c) => ((c.body as { decision: string }).decision === 'decline' ? json(200, { offerId: 'offer-1', status: 'declined', orderId: null })() : problem(409, 'offer-closed')()) }));
    const region = await screen.findByRole('region', { name: 'Second-chance offer' });
    fireEvent.click(within(region).getByRole('button', { name: 'Decline' }));
    expect(await within(region).findByText('You declined the offer.')).toBeTruthy();
    fireEvent.click(within(region).getByRole('button', { name: 'Accept for ৳1,200' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Accept for ৳1,200' }));
    expect(await within(region).findByText('This offer is no longer open.')).toBeTruthy();
  });

  it('FR-AUC-02 the seller sees their auction without a bid form', async () => {
    renderApp(`/listings/${ID}`, backend({ l: auctionListing(), me: { ...standInMe, id: 'seller-1' } }));
    expect(await screen.findByText('Bidding is open to other members. You cannot bid on your own auction.')).toBeTruthy();
    expect(screen.queryByLabelText(/Your maximum bid/)).toBeNull();
  });

  it('NFR-USE-04 the panel in Bangla, with Bangla digits', async () => {
    renderApp(`/listings/${ID}`, backend({ l: auctionListing() }), 'bn');
    expect(await screen.findByText('সর্বনিম্ন বিড: ৳১,০৫০')).toBeTruthy();
    expect(screen.getByText('এগিয়ে আছেন: বিডার ১')).toBeTruthy();
    expect(screen.getByText('বিডের ইতিহাস')).toBeTruthy();
  });
});

describe('auction helpers', () => {
  it('NFR-USE-02 announcements come at most every 5 s, the newest winning; an outbid notice at once', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useAnnouncer());
    act(() => result.current.say('Price ৳1,000'));
    expect(result.current.text).toBe('Price ৳1,000');
    act(() => result.current.say('Price ৳1,100'));
    act(() => result.current.say('Price ৳1,200'));
    expect(result.current.text).toBe('Price ৳1,000');
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(result.current.text).toBe('Price ৳1,200');
    act(() => result.current.say('You have been outbid.', true));
    expect(result.current.text).toBe('You have been outbid.');
  });

  it('FR-AUC-02 every refusal of the bid engine has its own words', () => {
    const t = (k: string, v: Record<string, string> = {}) => `${k}${Object.values(v).join(',')}`;
    const refused = (reason: string, extra: Record<string, string> = {}) =>
      refusalText(new ApiError(422, { type: '/problems/bid-refused', errors: [{ field: 'maximum', reason, ...extra }] }), t, 'en');
    expect(refused('below_minimum', { minimum: '130000' })).toBe('auction.refused.below_minimum৳1,300');
    for (const r of ['max_not_higher', 'auction_ended', 'auction_not_open', 'seller_cannot_bid']) expect(refused(r)).toBe(`auction.refused.${r}`);
    expect(refused('bidder_restricted', { until: '2026-12-01T00:00:00Z' })).toBe('auction.refused.bidder_restrictedTue 1 Dec 2026, 6:00 am');
    expect(refusalText(new ApiError(409, { type: '/problems/auction-busy' }), t, 'en')).toBe('auction.busy');
    expect(refusalText(new ApiError(403, { type: '/problems/transaction-not-allowed' }), t, 'en')).toBe('auction.not_allowed');
  });

  it('NFR-USE-04 both languages have the same keys and placeholders, in Bangla script', () => {
    expect(Object.keys(bn).sort()).toEqual(Object.keys(en).sort());
    for (const k of Object.keys(en) as (keyof typeof en)[]) expect(placeholders(bn[k])).toEqual(placeholders(en[k]));
    for (const v of Object.values(bn)) expect(v).toMatch(/[ঀ-৿]/);
  });
});
