// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, configure, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { placeholders } from '../../lib/i18n.js';
import { fakeBackend, json, problem, renderApp, standInMe, type Call } from '../../testing/app';
import { commissionOf, nearestArea, type Area, type EditableListing, type SellingTerms } from './sell';
import { sellStepsOf } from './SellPage';
import en from '../../messages/en/sell.json';
import bn from '../../messages/bn/sell.json';

// The listing editor (docs/design/08_frontend.pdf section 7.3; FR-LST-01 to FR-LST-12, FR-MON-01; IF-SW-08; U8-14):
// a draft created once, the area from the list or the device's position, photos one by one with their progress, the
// commission before publishing, the auction terms fixed at publication, review said, clarifications afterwards.

configure({ asyncUtilTimeout: 3000 });
afterEach(() => cleanup());

const ID = '7e1c2a3e-1111-4a5b-8c9d-000000000009';
const terms: SellingTerms = { pro: false, commissionBps: 500, auctionDurations: ['1 hour', '24 hours', '72 hours'], photos: { max: 10, maxBytes: 10_485_760, min: 2 }, activeListings: { count: 3, limit: 10 } };
const areas: Area[] = [
  { id: 1, district: 'Dhaka', nameEn: 'Dhanmondi', nameBn: 'ধানমন্ডি', lat: 23.746, lng: 90.374 },
  { id: 2, district: 'Khulna', nameEn: 'Sonadanga', nameBn: 'সোনাডাঙ্গা', lat: 22.81, lng: 89.55 },
];
const categories = [
  { id: 5, parentId: null, slug: 'lamps', nameEn: 'Lamps', nameBn: 'বাতি', itemKind: 'physical', selectable: true },
  { id: 6, parentId: null, slug: 'weapons', nameEn: 'Weapons', nameBn: 'অস্ত্র', itemKind: 'physical', selectable: false },
  { id: 7, parentId: null, slug: 'games', nameEn: 'Game accounts', nameBn: 'গেম অ্যাকাউন্ট', itemKind: 'game_account', selectable: true },
];
const draft = (o: Partial<EditableListing> = {}): EditableListing => ({
  id: ID, itemKind: 'physical', saleFormat: 'fixed_price', status: 'draft', category: { id: 5, nameEn: 'Lamps', nameBn: 'বাতি' },
  title: 'Brass desk lamp', description: 'A brass desk lamp with a green shade, works well.', condition: 'used', noVisibleDefects: true,
  fulfilmentOptions: 'pickup_only', weightClass: null, sizeClass: null, price: '150000', quantity: { total: 1, available: 1 }, locked: false,
  photos: [], clarifications: [], own: { area: { district: 'Dhaka', lat: 23.746, lng: 90.374 }, updatedAt: '2026-11-18T00:00:00Z' }, ...o,
});
const photo = (n: number) => ({ id: `p-${n}`, position: n, url: `/api/v1/listing-photos/k${n}`, thumbUrl: `/api/v1/listing-photos/k${n}?size=thumb`, showsDefects: false });

type Answer = (c: Call) => Response | Promise<Response>;
function backend(answers: Record<string, Answer | Answer[]> = {}) {
  return fakeBackend({
    'GET /me': json(200, { ...standInMe, kycStatus: 'verified' }),
    'POST /auth/refresh': json(401, {}),
    'GET /notifications/unread-count': json(200, { unread: 0 }),
    'GET /me/notification-preferences': json(200, { language: 'en', emailTransactional: true }),
    'GET /me/selling-terms': json(200, terms),
    'GET /categories': json(200, categories),
    'GET /delivery/areas': json(200, { items: areas }),
    ...answers,
  });
}
const type = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('the listing editor', () => {
  it('FR-LST-01 FR-LST-10 FR-MON-01 a draft: prohibited categories shown but not choosable, the commission on the price, created once', async () => {
    const be = backend({ 'POST /listings': json(201, draft()), [`GET /listings/${ID}`]: json(200, draft()) });
    const doc = renderApp('/sell/new', be);
    const category = await screen.findByLabelText('Category') as HTMLSelectElement;
    await waitFor(() => expect(category.options.length).toBe(3));
    expect(Array.from(category.options).map((o) => [o.textContent, o.disabled])).toEqual([['Choose a category', false], ['Lamps', false], ['Weapons (not allowed)', true]]);
    expect(screen.getByText('Active listings: 3 of 10 allowed.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save as a draft' }));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Choose a category.', 'Enter a title of at least 5 characters.', 'Enter a description of at least 20 characters.', 'Choose the condition.',
      'Enter the price in taka, for example 1500.', 'Choose your area.',
    ]);
    fireEvent.change(category, { target: { value: '5' } });
    type('Title', '  Brass desk lamp ');
    type('Description', 'A brass desk lamp with a green shade, works well.');
    fireEvent.change(screen.getByLabelText('Condition'), { target: { value: 'used' } });
    fireEvent.click(screen.getByLabelText('The item has no visible defects'));
    type('Price (taka)', '১,৫০০');
    expect(screen.getByText("TrustBazaar's commission of 5% (৳75 for each one sold) is deducted from your payout.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Area'), { target: { value: '1' } });
    const save = screen.getByRole('button', { name: 'Save as a draft' });
    fireEvent.click(save);
    fireEvent.click(save);
    await waitFor(() => expect(doc.router.state.location.pathname).toBe(`/sell/${ID}`));
    const sent = be.called('POST /listings');
    expect(sent).toHaveLength(1);
    expect(sent[0].headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
    expect(sent[0].body).toEqual({
      categoryId: 5, title: 'Brass desk lamp', description: 'A brass desk lamp with a green shade, works well.', condition: 'used', noVisibleDefects: true,
      fulfilmentOptions: 'pickup_only', weightClass: null, sizeClass: null, price: '150000', quantity: 1,
      area: { district: 'Dhaka', lat: 23.746, lng: 90.374 }, itemKind: 'physical', saleFormat: 'fixed_price',
    });
  });

  it('IF-SW-08 FR-LST-06 the area from the device\'s position after the button press, the nearest area\'s district and a rounded point', async () => {
    const asked: number[] = [];
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: (ok: (p: { coords: { latitude: number; longitude: number } }) => void) => { asked.push(1); ok({ coords: { latitude: 22.8123456, longitude: 89.5612345 } }); } },
    });
    const be = backend({ 'POST /listings': json(201, draft()), [`GET /listings/${ID}`]: json(200, draft()) });
    renderApp('/sell/new', be);
    const button = await screen.findByRole('button', { name: 'Use my location' });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    expect(asked).toEqual([]);
    fireEvent.click(button);
    expect(await screen.findByText('Your area: Sonadanga, Khulna')).toBeTruthy();
    expect((screen.getByLabelText('Area') as HTMLSelectElement).value).toBe('2');
    fireEvent.change(await screen.findByLabelText('Category'), { target: { value: '5' } });
    type('Title', 'Brass desk lamp');
    type('Description', 'A brass desk lamp with a green shade, works well.');
    fireEvent.change(screen.getByLabelText('Condition'), { target: { value: 'new' } });
    fireEvent.change(screen.getByLabelText('How the buyer gets it'), { target: { value: 'pickup_or_courier' } });
    type('Price (taka)', '1500');
    fireEvent.click(screen.getByRole('button', { name: 'Save as a draft' }));
    expect(await screen.findByText('For courier delivery choose the weight and size.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Weight'), { target: { value: 'up_to_2kg' } });
    fireEvent.change(screen.getByLabelText('Size'), { target: { value: 'small' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save as a draft' }));
    await waitFor(() => expect(be.called('POST /listings')).toHaveLength(1));
    expect(be.called('POST /listings')[0].body).toMatchObject({ area: { district: 'Khulna', lat: 22.812, lng: 89.561 }, fulfilmentOptions: 'pickup_or_courier', weightClass: 'up_to_2kg', sizeClass: 'small' });
    expect(nearestArea([], 1, 1)).toBeNull();
  });

  it('CP-33 photos are uploaded one by one with their progress; a refused one is named; a photo can be removed', async () => {
    let current = draft();
    let n = 0;
    const be = backend({
      [`GET /listings/${ID}`]: () => json(200, current)(),
      [`POST /listings/${ID}/photos`]: (c) => {
        const f = (c.body as FormData).get('photo') as File;
        if (f.name === 'bad.jpg') return problem(422, 'photo-rejected')();
        n += 1;
        current = { ...current, photos: [...current.photos, photo(n)] };
        return json(201, { id: `p-${n}` })();
      },
      [`DELETE /listings/${ID}/photos/p-1`]: () => { current = { ...current, photos: current.photos.filter((p) => p.id !== 'p-1') }; return new Response(null, { status: 204 }); },
    });
    renderApp(`/sell/${ID}`, be);
    const input = await screen.findByLabelText('Add photos (10 more allowed)');
    const file = (name: string, t = 'image/jpeg') => new File([new Uint8Array(100)], name, { type: t });
    fireEvent.click(screen.getByLabelText('The photos I add now show the defects'));
    fireEvent.change(input, { target: { files: [file('a.jpg'), file('bad.jpg'), file('c.gif', 'image/gif'), file('d.png', 'image/png')] } });
    expect(await screen.findByText('These photos could not be used: bad.jpg, c.gif. Use JPEG, PNG or WebP images within the size limit.')).toBeTruthy();
    await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(2));
    const sent = be.called(`POST /listings/${ID}/photos`);
    expect(sent.map((c) => [((c.body as FormData).get('photo') as File).name, (c.body as FormData).get('showsDefects')])).toEqual([['a.jpg', 'true'], ['bad.jpg', 'true'], ['d.png', 'true']]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove photo 1' }));
    await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(1));
  });

  it('FR-LST-12 FR-LST-07 an auction\'s terms are given at publication, with the commission and their limit stated; review is said', async () => {
    let current = draft({ saleFormat: 'auction', price: null, photos: [photo(1), photo(2)] });
    const be = backend({
      [`GET /listings/${ID}`]: () => json(200, current)(),
      [`POST /listings/${ID}/publish`]: [
        problem(422, 'listing-not-publishable', { errors: [{ field: 'photos', reason: 'defect-photo-or-declaration' }, { field: 'listing', reason: 'something-new' }] }),
        () => { current = { ...current, status: 'pending_review' }; return json(200, current)(); },
      ],
    });
    renderApp(`/sell/${ID}`, be);
    const form = (await screen.findByRole('heading', { name: 'Publish' })).closest('form')!;
    expect(within(form).getByText("When it sells, TrustBazaar's commission of 5% of the item price is deducted from your payout.")).toBeTruthy();
    expect(within(form).getByText('The starting price, reserve and duration never change after publishing; after that only clarifications can be added.')).toBeTruthy();
    expect(Array.from((within(form).getByLabelText('Duration') as HTMLSelectElement).options).map((o) => o.textContent)).toEqual(['1 hour', '24 hours', '72 hours']);
    fireEvent.change(within(form).getByLabelText('Starting price (taka)'), { target: { value: '1000' } });
    fireEvent.change(within(form).getByLabelText('Reserve price (taka, optional)'), { target: { value: '900' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Publish' }));
    expect(await within(form).findByText('The reserve price cannot be below the starting price.')).toBeTruthy();
    fireEvent.change(within(form).getByLabelText('Reserve price (taka, optional)'), { target: { value: '1,500' } });
    fireEvent.change(within(form).getByLabelText('Duration'), { target: { value: '24 hours' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Publish' }));
    expect(await within(form).findByText('Photos: show the defects in a photo, or declare there are none')).toBeTruthy();
    expect(within(form).getByText('Listing: not valid')).toBeTruthy();
    fireEvent.click(within(form).getByRole('button', { name: 'Publish' }));
    expect(await screen.findByText(/^This listing is waiting for review\./)).toBeTruthy();
    expect(be.called(`POST /listings/${ID}/publish`)[0].body).toEqual({ startPrice: '100000', reservePrice: '150000', duration: '24 hours' });
    expect(screen.queryByRole('heading', { name: 'Publish' })).toBeNull();
  });

  it('FR-LST-07 a published listing with an order takes only clarifications; another seller\'s listing is not offered', async () => {
    const be = backend({
      [`GET /listings/${ID}`]: json(200, draft({ status: 'active', locked: true, clarifications: [{ id: 'c-1', body: 'The bulb is included.', at: '2026-11-17T10:00:00Z' }] })),
      [`POST /listings/${ID}/clarifications`]: json(201, { id: 'c-2', body: 'Shade is glass.', at: '2026-11-18T10:00:00Z' }),
      'GET /listings/other': json(200, { ...draft(), id: 'other', own: undefined }),
    });
    renderApp(`/sell/${ID}`, be);
    expect(await screen.findByText('This listing has a bid or an order, so it can no longer be edited. You can add clarifications.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save the changes' })).toBeNull();
    expect(screen.getByText('The bulb is included.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Add a clarification'), { target: { value: ' Shade is glass. ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(be.called(`POST /listings/${ID}/clarifications`)[0]?.body).toEqual({ body: 'Shade is glass.' }));
    cleanup();
    renderApp('/sell/other', be);
    expect(await screen.findByRole('heading', { name: 'This listing was not found, or it is not yours.' })).toBeTruthy();
  });

  it('FR-GAM-02 FR-GAM-06 a game account: no condition, delivery or area, one unit; its game details before publishing, never a login', async () => {
    const gameDraft = draft({
      itemKind: 'game_account', category: { id: 7, nameEn: 'Game accounts', nameBn: 'গেম অ্যাকাউন্ট' }, title: 'PUBG level 70 account',
      condition: null, noVisibleDefects: false, fulfilmentOptions: null, own: { area: null, updatedAt: '2026-11-18T00:00:00Z' },
    });
    let ownership: { details: unknown; proof: null } = { details: null, proof: null };
    const be = backend({
      'POST /listings': json(201, gameDraft),
      [`GET /listings/${ID}`]: json(200, gameDraft),
      [`GET /listings/${ID}/ownership`]: () => json(200, ownership)(),
      'GET /games': json(200, { items: [{ id: 3, slug: 'pubg', name: 'PUBG Mobile', platforms: ['android', 'ios'], codePlacement: 'Put it in your bio', publisherNote: 'The publisher forbids selling accounts.' }] }),
      [`PUT /listings/${ID}/game-details`]: (c) => { ownership = { details: c.body, proof: null }; return json(200, c.body)(); },
      [`POST /listings/${ID}/publish`]: json(200, { ...gameDraft, status: 'pending_review' }),
    });
    const doc = renderApp('/sell/new', be);
    fireEvent.click(await screen.findByLabelText('A game account'));
    const category = screen.getByLabelText('Category') as HTMLSelectElement;
    await waitFor(() => expect(Array.from(category.options).map((o) => o.textContent)).toEqual(['Choose a category', 'Game accounts']));
    expect(screen.queryByLabelText('Condition')).toBeNull();
    expect(screen.queryByLabelText('How the buyer gets it')).toBeNull();
    expect(screen.queryByLabelText('Area')).toBeNull();
    expect(screen.queryByLabelText('Quantity')).toBeNull();
    fireEvent.change(category, { target: { value: '7' } });
    type('Title', 'PUBG level 70 account');
    type('Description', 'Level 70, many skins, two seasons of passes.');
    type('Price (taka)', '5000');
    fireEvent.click(screen.getByRole('button', { name: 'Save as a draft' }));
    await waitFor(() => expect(doc.router.state.location.pathname).toBe(`/sell/${ID}`));
    expect(be.called('POST /listings')[0].body).toEqual({
      categoryId: 7, title: 'PUBG level 70 account', description: 'Level 70, many skins, two seasons of passes.', price: '500000', quantity: 1,
      itemKind: 'game_account', saleFormat: 'fixed_price',
    });

    expect(await screen.findByText('Never write the password, recovery e-mail or any login detail in the listing.')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Photos' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Publish' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Save the game details before publishing.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save the game details' }));
    expect(within(await screen.findByRole('alert')).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Choose the game.', 'Choose the platform.', 'Give the player ID (at least 2 characters).', 'Describe what the account holds (at least 10 characters).',
    ]);
    const gameSelect = screen.getByLabelText('Game') as HTMLSelectElement;
    await waitFor(() => expect(gameSelect.options.length).toBe(2));
    fireEvent.change(gameSelect, { target: { value: '3' } });
    expect(screen.getByText('The publisher forbids selling accounts.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Platform'), { target: { value: 'android' } });
    type('Player ID', ' 5123456789 ');
    type('What the account holds', 'Level 70, 40 skins, Royale Pass season 3.');
    fireEvent.click(screen.getByRole('button', { name: 'Save the game details' }));
    expect(await screen.findByText('The game details are saved.')).toBeTruthy();
    expect(be.called(`PUT /listings/${ID}/game-details`)[0].body).toEqual({ gameId: 3, platform: 'android', playerId: '5123456789', contents: 'Level 70, 40 skins, Royale Pass season 3.' });
    await waitFor(() => expect((screen.getByRole('button', { name: 'Publish' }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByText(/^A game account is held for review when published/)).toBeTruthy();
  });

  it('FR-GAM-03 after publication the seller gets a one-time code with where to put it and its expiry, uploads the screenshot, and sees the review', async () => {
    const pending = draft({
      itemKind: 'game_account', status: 'pending_review', category: { id: 7, nameEn: 'Game accounts', nameBn: 'গেম অ্যাকাউন্ট' },
      condition: null, fulfilmentOptions: null, own: { area: null, updatedAt: '2026-11-18T00:00:00Z' },
    });
    const details = { gameId: 3, platform: 'android', playerId: '5123456789', contents: 'Level 70, 40 skins, Royale Pass season 3.' };
    const expiresAt = new Date(Date.now() + 2 * 3_600_000).toISOString();
    let proof: Record<string, unknown> | null = { code: 'OLD111', status: 'rejected', expiresAt, submittedAt: expiresAt, reviewedAt: expiresAt, reason: 'The code is not visible.' };
    const be = backend({
      [`GET /listings/${ID}`]: json(200, pending),
      [`GET /listings/${ID}/ownership`]: () => json(200, { details, proof })(),
      'GET /games': json(200, { items: [{ id: 3, slug: 'pubg', name: 'PUBG Mobile', platforms: ['android'], codePlacement: 'Put it in your bio', publisherNote: 'The publisher forbids selling accounts.' }] }),
      [`POST /listings/${ID}/ownership-code`]: () => { proof = { code: 'TB7Q2X', status: 'issued', expiresAt, submittedAt: null, reviewedAt: null, reason: null }; return json(201, { code: 'TB7Q2X', expiresAt, placement: 'Put it in your bio' })(); },
      [`POST /listings/${ID}/ownership-proof`]: () => { proof = { ...proof, status: 'submitted', submittedAt: expiresAt }; return json(201, { status: 'submitted', submittedAt: expiresAt })(); },
    });
    renderApp(`/sell/${ID}`, be);
    expect(await screen.findByText('Your proof was not accepted.')).toBeTruthy();
    expect(screen.getByText('Reason: The code is not visible.')).toBeTruthy();
    expect(screen.getByText(/^Your listing is waiting for review\./)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Get a new code' }));
    expect(await screen.findByText('TB7Q2X')).toBeTruthy();
    expect(screen.getByText('Where to put it: Put it in your bio')).toBeTruthy();
    expect(screen.getByText(/^The code expires .+\(in (2|1) h/)).toBeTruthy();
    const file = new File(['png'], 'proof.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Upload the screenshot (JPEG, PNG or WebP)'), { target: { files: [file] } });
    expect(await screen.findByText('Your proof is being reviewed.')).toBeTruthy();
    const sent = be.called(`POST /listings/${ID}/ownership-proof`)[0].body as FormData;
    expect((sent.get('file') as File).name).toBe('proof.png');
    expect(screen.queryByRole('button', { name: /code/ })).toBeNull();
    expect((screen.getByLabelText('Player ID') as HTMLInputElement).disabled).toBe(true);
  });

  it('FR-KYC-07 FR-MON-01 an unverified member is told why; the commission is whole poisha, rounded down; both languages match', async () => {
    renderApp('/sell/new', backend({ 'GET /me/selling-terms': problem(403, 'forbidden') }));
    expect(await screen.findByText('Only members with a verified identity and e-mail can sell.')).toBeTruthy();
    expect(commissionOf('1,500', 500)).toBe(7500n);
    expect(commissionOf('10.01', 300)).toBe(30n);
    expect(commissionOf('abc', 500)).toBeNull();
    expect(Object.keys(bn).sort()).toEqual(Object.keys(en).sort());
    for (const k of Object.keys(en) as (keyof typeof en)[]) expect(placeholders(bn[k])).toEqual(placeholders(en[k]));
  });
});

describe('the listing editor in the Daylight design (U10-06)', () => {
  it('FR-LST-09 the steps follow the draft: the item, then the photos up to the minimum, then publishing', () => {
    const states = (l: EditableListing | null) => sellStepsOf(l, 2).map((x) => `${x.key}:${x.state}`).join(' ');
    expect(states(null)).toBe('details:current photos:next publish:next');
    expect(states(draft({ photos: [photo(1)] }))).toBe('details:done photos:current publish:next');
    expect(states(draft({ photos: [photo(1), photo(2)] }))).toBe('details:done photos:done publish:current');
    expect(states(draft({ itemKind: 'game_account' }))).toBe('details:done game:current publish:next');
  });

  it('FR-LST-09 a draft shows its steps, the first photo marked as the cover, and the formats on the add tile', async () => {
    renderApp(`/sell/${ID}`, backend({ [`GET /listings/${ID}`]: json(200, draft({ photos: [photo(1), photo(2)] })) }));
    const steps = await screen.findByRole('list', { name: 'Steps' });
    expect(within(steps).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['The item(done)', 'Photos(done)', '3Publish(now)']);
    const photos = screen.getByRole('region', { name: 'Photos' });
    expect(within(photos).getAllByText('Cover')).toHaveLength(1);
    expect(within(photos).getByText('JPEG, PNG or WebP')).toBeTruthy();
  });
});

