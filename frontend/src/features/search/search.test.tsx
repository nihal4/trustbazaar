// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, configure, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { placeholders } from '../../lib/i18n.js';
import { fakeBackend, json, problem, renderApp, standInMe, type Call } from '../../testing/app';
import { categoryTree, searchQuery, type Category, type SearchCard } from './SearchPage';
import en from '../../messages/en/search.json';
import bn from '../../messages/bn/search.json';

// Home and search (IF-UI-03; FR-SRC-01 to FR-SRC-05; FR-MON-05; section 7.3): filters in the URL, "Show more"
// pages, cards with every label in words, the location only on request, both languages.

configure({ asyncUtilTimeout: 3000 });
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const card = (c: Partial<SearchCard> & { id: string }): SearchCard => ({
  title: 'Used phone', itemKind: 'physical', saleFormat: 'fixed_price', condition: 'used', district: 'Dhaka', price: '1500000',
  thumbUrl: '/api/v1/listing-photos/aaaa?size=thumb', distanceKm: null, featured: false, currentlyReserved: false, auction: null, ...c,
});
const categories: Category[] = [
  { id: 1, parentId: null, slug: 'phones', nameEn: 'Phones', nameBn: 'ফোন', itemKind: 'physical', selectable: true },
  { id: 2, parentId: 1, slug: 'android', nameEn: 'Android phones', nameBn: 'অ্যান্ড্রয়েড ফোন', itemKind: 'physical', selectable: true },
  { id: 3, parentId: null, slug: 'weapons', nameEn: 'Weapons', nameBn: 'অস্ত্র', itemKind: 'physical', selectable: false },
];

function backend(o: { signedIn?: boolean; search?: (c: Call) => Response } = {}) {
  const pages: Record<string, unknown> = {
    first: {
      items: [
        card({ id: 'l-1', title: '<b>Samsung</b> মোবাইল', distanceKm: 3 }),
        card({ id: 'l-2', title: 'Film camera', saleFormat: 'auction', price: '125000', featured: true,
          auction: { endAt: new Date(Date.now() + 2 * 86_400_000).toISOString(), bidCount: 4, reserveMet: false } }),
        card({ id: 'l-3', title: 'Table', currentlyReserved: true }),
      ],
      nextCursor: 'c-2', featured: [card({ id: 'l-2', title: 'Film camera', featured: true })], sort: 'newest',
    },
    second: { items: [card({ id: 'l-4', title: 'Bicycle' })], nextCursor: null, featured: [], sort: 'newest' },
  };
  return fakeBackend({
    'GET /me': o.signedIn ? json(200, standInMe) : json(401, { type: '/problems/session-ended' }),
    'POST /auth/refresh': json(401, {}),
    'GET /categories': json(200, categories),
    'GET /search': o.search ?? ((c: Call) => json(200, c.query.get('cursor') === 'c-2' ? pages.second : pages.first)()),
  });
}

describe('search', () => {
  it('FR-SRC-02 the filters come from the URL and go to GET /search unchanged', async () => {
    const be = backend();
    renderApp('/search?q=phone&category=2&sort=price_asc&minPrice=150000&other=x', be);
    await screen.findByText('Table');
    expect(Object.fromEntries(be.called('GET /search')[0].query)).toEqual({ q: 'phone', category: '2', minPrice: '150000', sort: 'price_asc' });
    expect((screen.getByLabelText('What are you looking for?') as HTMLInputElement).value).toBe('phone');
    expect((screen.getByLabelText('Lowest price (taka)') as HTMLInputElement).value).toBe('1500');
    expect((screen.getByLabelText('Category') as HTMLSelectElement).value).toBe('2');
    // categories in tree order; prohibited ones are not offered as a filter
    const options = within(screen.getByLabelText('Category')).getAllByRole('option').map((x) => x.textContent?.trim());
    expect(options).toEqual(['Any', 'Phones', 'Android phones']);
  });

  it('FR-SRC-01 searching puts the words and filters in the URL; prices are typed in taka, Bangla digits too', async () => {
    const be = backend();
    const doc = renderApp('/search', be);
    await screen.findByText('Table');
    fireEvent.change(screen.getByLabelText('What are you looking for?'), { target: { value: ' মোবাইল ' } });
    fireEvent.change(screen.getByLabelText('How it is sold'), { target: { value: 'auction' } });
    fireEvent.change(screen.getByLabelText('Highest price (taka)'), { target: { value: '১,৫০০' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(doc.router.state.location.search).toBe(`?q=${encodeURIComponent('মোবাইল')}&saleFormat=auction&maxPrice=150000`));
    await waitFor(() => expect(be.called('GET /search').some((c) => c.query.get('maxPrice') === '150000' && c.query.get('q') === 'মোবাইল')).toBe(true));
  });

  it('FR-SRC-02 a price that is not an amount, or a range the wrong way round, is explained before searching', async () => {
    const be = backend();
    renderApp('/search', be);
    await screen.findByText('Table');
    fireEvent.change(screen.getByLabelText('Lowest price (taka)'), { target: { value: 'cheap' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('Enter a price in taka, for example 1,500.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Lowest price (taka)'), { target: { value: '900' } });
    fireEvent.change(screen.getByLabelText('Highest price (taka)'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('The highest price must not be below the lowest.')).toBeTruthy();
    expect(be.called('GET /search').every((c) => c.query.toString() === '')).toBe(true);
  });

  it('FR-SRC-05 cards show text as text, labels in words, distance in whole kilometres; featured ones apart (FR-MON-05)', async () => {
    const be = backend();
    renderApp('/search', be);
    const results = (await screen.findByRole('heading', { name: 'Results' })).closest('section')!;
    const cards = within(results).getAllByRole('listitem');
    expect(cards).toHaveLength(3);
    expect(within(cards[0]).getByText('<b>Samsung</b> মোবাইল')).toBeTruthy();
    expect(cards[0].querySelector('b')).toBeNull();
    expect(within(cards[0]).getByText(/3 km away/)).toBeTruthy();
    expect(within(cards[0]).getByRole('link').getAttribute('href')).toBe('/listings/l-1');
    expect(within(cards[1]).getByText('Featured')).toBeTruthy();
    expect(within(cards[1]).getByText(/Auction · Ends in 2 days 0 h · Bids: 4 · Reserve not met yet/)).toBeTruthy();
    expect(within(cards[1]).getByText('৳1,250')).toBeTruthy();
    expect(within(cards[2]).getByText('Currently reserved')).toBeTruthy();
    const featured = screen.getByRole('heading', { name: 'Featured' }).closest('section')!;
    expect(within(featured).getByText('Sellers paid to show these listings here.')).toBeTruthy();
    expect(within(featured).getAllByRole('listitem')).toHaveLength(1);
  });

  it('FR-SRC-03 "Show more" adds the next page after the first, by cursor', async () => {
    const be = backend();
    renderApp('/search', be);
    fireEvent.click(await screen.findByRole('button', { name: 'Show more' }));
    expect(await screen.findByText('Bicycle')).toBeTruthy();
    expect(be.called('GET /search').some((c) => c.query.get('cursor') === 'c-2')).toBe(true);
    expect(screen.getByText('Table')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  it('FR-SRC-05 the location is asked for only on the button, rounded to 3 decimals, and can be dropped', async () => {
    const getCurrentPosition = vi.fn((ok: PositionCallback) => ok({ coords: { latitude: 23.810_49, longitude: 90.412_34 } } as GeolocationPosition));
    vi.stubGlobal('navigator', { ...navigator, geolocation: { getCurrentPosition } });
    const be = backend();
    const doc = renderApp('/search?sort=distance', be);
    await screen.findByText('Table');
    expect(getCurrentPosition).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Use my location' }));
    await waitFor(() => expect(doc.router.state.location.search).toBe('?lat=23.810&lng=90.412&sort=distance'));
    expect(await screen.findByText('Distances are from your location.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Stop using my location' }));
    await waitFor(() => expect(doc.router.state.location.search).toBe('?sort=distance'));
  });

  it('FR-SRC-05 a refused location, and a distance search without a point, are explained', async () => {
    vi.stubGlobal('navigator', { ...navigator, geolocation: { getCurrentPosition: (_: PositionCallback, no: PositionErrorCallback) => no({} as GeolocationPositionError) } });
    const be = backend({ search: (c) => (c.query.get('sort') === 'distance'
      ? problem(400, 'validation-failed', { errors: [{ field: 'sort', reason: 'needs-a-search-point' }] })()
      : json(200, { items: [], nextCursor: null, featured: [], sort: 'newest' })()) });
    renderApp('/search?sort=distance', be);
    expect(await screen.findByText('To search by distance, press “Use my location” first.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Use my location' }));
    expect(await screen.findByText('Your location could not be used. You can still search without it.')).toBeTruthy();
  });

  it('FR-SRC-05 a signed-in user is told distances come from their saved area; guests search too', async () => {
    renderApp('/search', backend({ signedIn: true }));
    expect(await screen.findByText('Distances are from the area saved in your account.')).toBeTruthy();
    cleanup();
    renderApp('/search', backend());
    await screen.findByText('Table');
    expect(screen.queryByText('Distances are from the area saved in your account.')).toBeNull();
  });

  it('NFR-USE-04 the page in Bangla, with Bangla digits and category names', async () => {
    renderApp('/search?category=1', backend(), 'bn');
    expect(await screen.findByRole('heading', { name: 'যাচাই করা বিক্রেতাদের কাছ থেকে পুরোনো জিনিস খুঁজুন' })).toBeTruthy();
    expect((await screen.findAllByRole('listitem')).some((li) => li.textContent?.includes('৩ কিমি দূরে'))).toBe(true);
    expect(screen.getAllByText('৳১৫,০০০').length).toBeGreaterThan(0);
    expect(within(screen.getByLabelText('বিভাগ')).getByRole('option', { name: 'ফোন' })).toBeTruthy();
  });

  it('NFR-USE-04 both languages have the same keys and placeholders, in Bangla script', () => {
    expect(Object.keys(bn).sort()).toEqual(Object.keys(en).sort());
    for (const k of Object.keys(en) as (keyof typeof en)[]) expect(placeholders(bn[k])).toEqual(placeholders(en[k]));
    for (const v of Object.values(bn)) expect(v).toMatch(/[ঀ-৿]/);
  });

  it('FR-SRC-02 helpers: the request keeps only known parameters in a fixed order; categories in tree order', () => {
    expect(searchQuery(new URLSearchParams('sort=newest&zzz=1&q=a&cursor=x')).toString()).toBe('q=a&sort=newest');
    expect(categoryTree(categories).map(({ c, depth }) => `${depth}:${c.slug}`)).toEqual(['0:phones', '1:android', '0:weapons']);
  });
});
