// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, configure, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { fakeBackend, json, renderApp, renderDocument, type Call } from '../../testing/app';
import { searchRoutes } from './routes';
import type { SearchCard } from './SearchPage';
import type { Category } from './searchShared';

// The home page and the search page's chips in the Daylight design (docs/design/10_visual.md, sections 7.1 and 7.2;
// U10-03): the search goes to /search, categories link to their results, auctions ending soonest, featured listings
// apart with their note, the newest listings, and the filters in use as removable chips.

configure({ asyncUtilTimeout: 3000 });
afterEach(cleanup);

const card = (c: Partial<SearchCard> & { id: string }): SearchCard => ({
  title: 'Used phone',
  itemKind: 'physical',
  saleFormat: 'fixed_price',
  condition: 'used',
  district: 'Dhaka',
  price: '1500000',
  thumbUrl: null,
  distanceKm: null,
  featured: false,
  currentlyReserved: false,
  auction: null,
  ...c,
});
const categories: Category[] = [
  { id: 1, parentId: null, slug: 'phones', nameEn: 'Phones', nameBn: 'ফোন', itemKind: 'physical', selectable: true },
  { id: 2, parentId: 1, slug: 'android', nameEn: 'Android phones', nameBn: 'অ্যান্ড্রয়েড ফোন', itemKind: 'physical', selectable: true },
  { id: 3, parentId: null, slug: 'weapons', nameEn: 'Weapons', nameBn: 'অস্ত্র', itemKind: 'physical', selectable: false },
  { id: 4, parentId: null, slug: 'bikes', nameEn: 'Bicycles', nameBn: 'সাইকেল', itemKind: 'physical', selectable: true },
];
const soon = (h: number) => ({ endAt: new Date(Date.now() + h * 3_600_000).toISOString(), bidCount: 2, reserveMet: true });

function backend() {
  return fakeBackend({
    'GET /me': json(401, { type: '/problems/session-ended' }),
    'POST /auth/refresh': json(401, {}),
    'GET /categories': json(200, categories),
    'GET /search': (c: Call) =>
      json(
        200,
        c.query.get('saleFormat') === 'auction'
          ? {
              items: [1, 2, 3, 4, 5].map((n) => card({ id: `a-${n}`, title: `Auction ${n}`, saleFormat: 'auction', auction: soon(n === 1 ? 0.5 : n * 3) })),
              nextCursor: null,
              featured: [],
              sort: 'ending_soon',
            }
          : {
              items: [card({ id: 'n-1', title: 'Samsung Galaxy A15' }), card({ id: 'n-2', title: 'Phoenix bicycle', district: 'Chattogram' })],
              nextCursor: 'x',
              featured: [card({ id: 'f-1', title: 'Canon camera', featured: true })],
              sort: 'newest',
            },
      )(),
  });
}

/** The user app with the real home page (renderApp stands in a plain one). */
const renderHome = (be: ReturnType<typeof backend>, lang: 'en' | 'bn' = 'en') =>
  renderDocument('/', be, lang, { home: { path: '/', sameDocument: true }, accountLinks: true, routes: searchRoutes });

describe('home', () => {
  it('IF-UI-03 FR-SRC-01 the search on the home page goes to /search with the words', async () => {
    const doc = renderHome(backend());
    expect(await screen.findByRole('heading', { level: 1, name: 'Find it nearby. Pay when it is in your hands.' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('What are you looking for?'), { target: { value: ' camera ' } });
    fireEvent.click(within(screen.getByRole('search', { name: 'Phones, cycles, game accounts' })).getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(doc.router.state.location.pathname + doc.router.state.location.search).toBe('/search?q=camera'));
  });

  it('NFR-USE-07 beside the search, the escrow card shows in order how the money moves (docs/design/10_visual_v3.md)', async () => {
    renderHome(backend());
    const promise = (await screen.findByRole('heading', { level: 3, name: 'Your money waits with us' })).closest('article')!;
    expect(within(promise).getByText('How your money moves')).toBeTruthy();
    expect(
      within(promise)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['You pay TrustBazaar', 'We hold it', 'The seller is paid when you confirm']);
    expect(within(promise).queryByText(/৳|Tk/)).toBeNull(); // an explanation, not an order: no amount is made up
  });

  it('FR-SRC-02 the top categories that may be chosen link to their results', async () => {
    renderHome(backend());
    const nav = await screen.findByRole('navigation', { name: 'Categories' });
    await waitFor(() =>
      expect(
        within(nav)
          .getAllByRole('link')
          .map((a) => [a.textContent, a.getAttribute('href')]),
      ).toEqual([
        ['Everything', '/search'],
        ['Phones', '/search?category=1'],
        ['Bicycles', '/search?category=4'],
      ]),
    );
  });

  it('FR-AUC-01 four auctions ending soonest, each with its time left on the photo, the last hour marked', async () => {
    const be = backend();
    renderHome(be);
    const section = (await screen.findByRole('heading', { name: 'Auctions ending soon' })).closest('section')!;
    const items = within(section).getAllByRole('listitem');
    expect(items).toHaveLength(4);
    expect(within(items[0]).getByText(/^Ends in \d+:\d\d$/).className).toMatch(/soon/);
    expect(within(items[1]).getByText(/^Ends in 6 h/).className).not.toMatch(/soon/);
    expect(within(section).getByRole('link', { name: 'All auctions' }).getAttribute('href')).toBe('/search?saleFormat=auction&sort=ending_soon');
    expect(be.called('GET /search').some((c) => c.query.toString() === 'saleFormat=auction&sort=ending_soon')).toBe(true);
  });

  it('FR-MON-05 featured listings stand apart with their note; the newest follow, with a link to all', async () => {
    renderHome(backend());
    const featured = (await screen.findByRole('heading', { name: 'Featured' })).closest('section')!;
    expect(within(featured).getByText('Sellers paid to show these listings here.')).toBeTruthy();
    expect(within(featured).getByText('Featured', { selector: 'span' })).toBeTruthy();
    const newest = screen.getByRole('heading', { name: 'Newest listings' }).closest('section')!;
    expect(
      within(newest)
        .getAllByRole('listitem')
        .map((li) => within(li).getByRole('link').getAttribute('href')),
    ).toEqual(['/listings/n-1', '/listings/n-2']);
    expect(within(newest).getByText('Chattogram')).toBeTruthy();
    expect(within(newest).getByRole('link', { name: 'See everything new' }).getAttribute('href')).toBe('/search?sort=newest');
  });

  it('NFR-USE-04 the home page in Bangla, with Bangla digits in prices and steps', async () => {
    renderHome(backend(), 'bn');
    expect(await screen.findByRole('heading', { level: 1, name: 'কাছেই খুঁজুন। পণ্য হাতে পেলে তবেই টাকা যাবে।' })).toBeTruthy();
    expect((await screen.findAllByText('৳১৫,০০০')).length).toBeGreaterThan(0);
    expect(within(screen.getByRole('heading', { name: 'কিছু বিক্রি করবেন?' }).closest('section')!).getByText('১')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'বিক্রি শুরু করুন' }).getAttribute('href')).toBe('/sell/new');
  });
});

describe('search chips', () => {
  it('FR-SRC-02 the filters in use show as chips; one press removes a filter, "Clear all" removes them all but the words', async () => {
    const doc = renderApp('/search?q=phone&category=1&saleFormat=auction&maxPrice=1500000', backend());
    const chips = await screen.findByRole('group', { name: 'Filters in use' });
    await waitFor(() =>
      expect(
        within(chips)
          .getAllByRole('button')
          .map((b) => b.textContent),
      ).toEqual(['Remove filter: Phones', 'Remove filter: Auction', 'Remove filter: Up to ৳15,000', 'Clear all']),
    );
    fireEvent.click(within(chips).getByRole('button', { name: 'Remove filter: Auction' }));
    await waitFor(() => expect(doc.router.state.location.search).toBe('?q=phone&category=1&maxPrice=1500000'));
    fireEvent.click(within(await screen.findByRole('group', { name: 'Filters in use' })).getByRole('button', { name: 'Clear all' }));
    await waitFor(() => expect(doc.router.state.location.search).toBe('?q=phone'));
    expect(screen.queryByRole('group', { name: 'Filters in use' })).toBeNull();
  });

  it('NFR-USE-05 on phones the filters fold away behind a button that says whether they are open', async () => {
    renderApp('/search', backend());
    const toggle = await screen.findByRole('button', { name: 'Show filters' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Hide filters' }).getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById('search-filters')!.className).toMatch(/open/);
  });
});
