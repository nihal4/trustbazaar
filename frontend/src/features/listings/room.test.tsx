// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, configure, fireEvent, screen, within } from '@testing-library/react';
import { serverClock } from '../../shared/clock';
import { fakeBackend, json, problem, renderApp, standInMe, type Call } from '../../testing/app';
import type { AuctionState, ListingView, MyStatus } from './model';

// The auction room (U10-30; docs/design/10_visual_v3.md section 10). Named after the requirements it relies on: the auction's state and the
// leader as an alias (FR-AUC-01), bids checked, confirmed and sent once through the one bid form (FR-AUC-01, section 8.4), announcements
// (NFR-USE-02) and the listing page's link to the room (IF-UI-03).

configure({ asyncUtilTimeout: 3000 });
beforeEach(() => { serverClock.samples = []; serverClock.estimate = 0; });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const ID = '7d1c2a3e-1111-4a5b-8c9d-000000000001';
const at = (ms: number) => new Date(Date.now() + ms).toISOString();
const state = (o: Partial<AuctionState> = {}): AuctionState => ({
  auctionId: ID, status: 'open', startPrice: '100000', price: '120000', bidCount: 2, leaderAlias: 2, endAt: at(3_600_000),
  hasReserve: false, reserveMet: false, minimumBid: '125000', serverTime: at(0), seq: 2, ...o,
});
const listing = (o: Partial<ListingView> = {}): ListingView => ({
  id: ID, itemKind: 'physical', saleFormat: 'auction', status: 'active',
  category: { id: 1, slug: 'cameras', nameEn: 'Cameras', nameBn: 'ক্যামেরা' }, title: 'Film camera', description: 'Works.', condition: 'used',
  noVisibleDefects: true, fulfilmentOptions: 'pickup_or_courier', district: 'Dhaka', price: null, quantity: { total: 1, available: 1 }, currentlyReserved: false,
  photos: [], clarifications: [], auction: state(), seller: { id: 'seller-1', displayName: 'Karim', verified: true, joinMonth: '2026-10' }, ...o,
});
const none: MyStatus = { hasBid: false, yourMaximum: null, leading: false, yourAlias: null, orderId: null, secondChanceOffer: null };
const backend = (o: { l?: ListingView; signedIn?: boolean; me?: typeof standInMe; mine?: MyStatus; bid?: (c: Call) => Response } = {}) => fakeBackend({
  'GET /me': o.signedIn === false ? json(401, { type: '/problems/session-ended' }) : json(200, o.me ?? standInMe),
  'POST /auth/refresh': json(401, {}),
  'GET /notifications/unread-count': json(200, { unread: 0 }),
  'GET /me/notification-preferences': json(200, { language: 'en', emailTransactional: true }),
  [`GET /listings/${ID}`]: o.l ? json(200, o.l) : problem(404, 'not-found'),
  [`GET /auctions/${ID}/state`]: json(200, (o.l ?? listing()).auction),
  [`GET /auctions/${ID}/bids`]: json(200, { items: [
    { id: '2', bidderAlias: 2, amount: '120000', leading: true, at: '2026-11-01T10:00:00Z' },
    { id: '1', bidderAlias: 1, amount: '100000', leading: false, at: '2026-11-01T09:00:00Z' },
  ] }),
  [`GET /auctions/${ID}/my-status`]: json(200, o.mine ?? none),
  [`POST /auctions/${ID}/bids`]: o.bid ?? json(201, { bidId: '9', outcome: 'leading', yourMaximum: '130000', state: state({ price: '125000', seq: 3, bidCount: 3, leaderAlias: 3 }) }),
});

describe('the auction room', () => {
  it('FR-AUC-01 the room shows the price, the leader by alias, the number of bidders and the live bids', async () => {
    renderApp(`/listings/${ID}/room`, backend({ l: listing() }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Film camera' })).toBeTruthy();
    expect(screen.getAllByText('৳1,200').length).toBeGreaterThan(0);
    expect(screen.getByText('Leading: Bidder 2')).toBeTruthy();
    const feed = screen.getByRole('complementary', { name: 'Live bids' });
    expect((await within(feed).findAllByRole('listitem')).map((li) => li.textContent)).toEqual(['Bidder 2৳1,200 (took the lead)', 'Bidder 1৳1,000']);
    expect(screen.getByRole('timer')).toBeTruthy();
  });

  it('FR-AUC-01 a quick bid fills the field and opens the same confirmation; nothing is sent until it is confirmed', async () => {
    const calls: string[] = [];
    const bid = (c: Call) => { calls.push(c.path); return json(201, { bidId: '9', outcome: 'leading', yourMaximum: '175000', state: state({ price: '125000', seq: 3, bidCount: 3, leaderAlias: 3 }) })(); };
    renderApp(`/listings/${ID}/room`, backend({ l: listing(), bid }));
    const group = await screen.findByRole('group', { name: 'Quick bids' });
    fireEvent.click(within(group).getAllByRole('button')[1]);          // the minimum plus ৳500
    const dialog = await screen.findByRole('dialog', { hidden: true });
    expect(within(dialog).getByText(/A bid of ৳1,750 is binding/)).toBeTruthy();
    expect(calls).toEqual([]);                                          // pressing a quick bid sends nothing
    fireEvent.click(within(dialog).getByRole('button', { name: 'Bid ৳1,750' }));
    await screen.findByText(/You are leading/, undefined, { timeout: 3000 }).catch(() => null);
    expect(calls).toEqual([`/auctions/${ID}/bids`]);                    // sent once
  });

  it('NFR-USE-02 Sit this one out turns this page\'s announcements off and says what it does not change', async () => {
    renderApp(`/listings/${ID}/room`, backend({ l: listing() }));
    const sit = await screen.findByRole('button', { name: 'Sit this one out' });
    expect(document.querySelector('[aria-live="polite"][role="status"]')).not.toBeNull();
    fireEvent.click(sit);
    expect(screen.getByRole('button', { name: 'Join in again' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(/alerts you get elsewhere/)).toBeTruthy();
    expect(document.querySelector('[aria-live="polite"][role="status"]')).toBeNull();
  });

  it('IF-UI-03 a guest is sent to sign in, the seller watches without controls, and a fixed-price listing has no room', async () => {
    renderApp(`/listings/${ID}/room`, backend({ l: listing(), signedIn: false }));
    expect(await screen.findByRole('heading', { name: /Sign in/ })).toBeTruthy();
    cleanup();
    renderApp(`/listings/${ID}/room`, backend({ l: listing(), me: { ...standInMe, id: 'seller-1' } }));
    expect(await screen.findByText('This is your auction. You can watch it here; you cannot bid.')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Quick bids' })).toBeNull();
    cleanup();
    renderApp(`/listings/${ID}/room`, backend({ l: listing({ saleFormat: 'fixed_price', price: '150000', auction: null }) }));
    expect(await screen.findByText('This listing is not an auction.')).toBeTruthy();
  });

  it('IF-UI-03 the listing\'s bid bar offers the room to a signed-in bidder and not to a guest', async () => {
    renderApp(`/listings/${ID}`, backend({ l: listing() }));
    const join = await screen.findByRole('link', { name: 'Join the live room' });
    expect(join.getAttribute('href')).toBe(`/listings/${ID}/room`);
    cleanup();
    renderApp(`/listings/${ID}`, backend({ l: listing(), signedIn: false }));
    await screen.findByRole('link', { name: 'Sign in to bid' });
    expect(screen.queryByRole('link', { name: 'Join the live room' })).toBeNull();
  });
});
