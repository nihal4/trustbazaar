import { randomInt, randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { loadConfig } from '../../src/kernel/config/config';
import { LISTINGS_PORT, ListingsPort } from '../../src/modules/listings/ports';
import { StockService } from '../../src/modules/listings/services/stock.service';
import { startApp, TestApp } from '../support/app';
import { IdentityFixtures } from '../support/identity';

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const sharp = require('sharp') as typeof import('sharp').default;

// U3-02: listings over HTTP against PostgreSQL, Redis and a temporary photo volume, through the security
// pipeline (docs/design/03_listings_auctions.pdf sections 3.1, 3.3, 6.1 and 6.2), and the stock port.
let shade = 0;
const jpeg = (w = 900, h = 600) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: (shade += 9) % 255, g: 120, b: 80 } } }).jpeg().toBuffer();

describe('listings', () => {
  let t: TestApp;
  let fx: IdentityFixtures;
  let origin: string;
  let phones: number; // a category of physical items
  let games: number;
  let banned: number;

  beforeAll(async () => {
    t = await startApp();
    fx = await IdentityFixtures.open();
    origin = loadConfig(process.env).publicOrigin;
    const tag = randomUUID().slice(0, 8);
    const cat = async (slug: string, kind: string, prohibited = false) =>
      (await fx.query<{ id: number }>(
        `INSERT INTO listings.categories (slug, name_en, name_bn, item_kind, prohibited) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [`${slug}-${tag}`, slug, 'বিভাগ', kind, prohibited],
      ))[0].id;
    phones = await cat('phones', 'physical');
    games = await cat('games', 'game_account');
    banned = await cat('weapons', 'physical', true);
  });
  afterAll(async () => {
    await fx?.close();
    await t?.close();
  });

  type Who = Awaited<ReturnType<typeof member>>;
  async function member(o: { kyc?: string; emailVerified?: boolean; status?: 'active' | 'suspended' } = {}) {
    const userId = await fx.user(o);
    const sid = await fx.session({ userId });
    const ip = `203.0.113.${randomInt(1, 255)}, 198.51.100.${randomInt(1, 255)}`;
    const base = () => ({ ...fx.headers(sid, userId, 'user'), 'x-forwarded-for': ip });
    const call = (method: string, path: string, body?: unknown, extra: Record<string, string> = {}) =>
      fetch(t.url(path), {
        method,
        headers: { ...base(), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...extra },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const upload = (path: string, form: FormData) => fetch(t.url(path), { method: 'POST', headers: base(), body: form });
    return { userId, sid, call, upload };
  }
  const guest = (method: string, path: string, body?: unknown) =>
    fetch(t.url(path), {
      method,
      headers: { origin, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const phoneDraft = (o: Record<string, unknown> = {}) => ({
    itemKind: 'physical', saleFormat: 'fixed_price', categoryId: phones, title: 'Used Android phone',
    description: 'Used phone in good condition, battery healthy, charger included.', condition: 'used', noVisibleDefects: true,
    fulfilmentOptions: 'pickup_or_courier', weightClass: 'up_to_1kg', sizeClass: 'small', price: '1500000', quantity: 2,
    area: { district: 'Dhaka', lat: 23.81049, lng: 90.41234 }, ...o,
  });
  async function draft(u: Who, o: Record<string, unknown> = {}) {
    const r = await u.call('POST', '/listings', phoneDraft(o));
    expect(r.status).toBe(201);
    return (await r.json()) as { id: string; [k: string]: unknown };
  }
  async function photo(u: Who, id: string, o: { bytes?: Buffer; showsDefects?: boolean } = {}) {
    const form = new FormData();
    form.set('photo', new Blob([new Uint8Array(o.bytes ?? (await jpeg()))], { type: 'image/jpeg' }), 'p.jpg');
    if (o.showsDefects !== undefined) form.set('showsDefects', String(o.showsDefects));
    return u.upload(`/listings/${id}/photos`, form);
  }
  async function active(u: Who, o: Record<string, unknown> = {}) {
    const l = await draft(u, o);
    for (let i = 0; i < 2; i++) expect((await photo(u, l.id)).status).toBe(201);
    const r = await u.call('POST', `/listings/${l.id}/publish`, {});
    expect(r.status).toBe(200);
    expect((await r.json()).status).toBe('active');
    return l.id;
  }
  const outbox = (id: string) =>
    fx.query<{ event_type: string; payload: Record<string, unknown> }>(`SELECT event_type, payload FROM auctions.outbox WHERE aggregate_id = $1 ORDER BY id`, [id]);
  const errorsOf = async (r: Response) => ((await r.json()).errors ?? []).map((e: { field: string; reason: string }) => `${e.field}:${e.reason}`);

  // ---------------------------------------------------------------- categories and drafts

  it('FR-LST-10 categories in both languages; a prohibited one is shown but cannot be chosen', async () => {
    const r = await guest('GET', '/categories');
    expect(r.status).toBe(200);
    const all = (await r.json()) as { id: number; nameBn: string; selectable: boolean }[];
    expect(all.find((c) => c.id === banned)).toMatchObject({ selectable: false, nameBn: 'বিভাগ' });
    const u = await member();
    const refused = await u.call('POST', '/listings', phoneDraft({ categoryId: banned }));
    expect(refused.status).toBe(400);
    expect(await errorsOf(refused)).toContain('categoryId:prohibited');
  });

  it('FR-LST-01 a verified seller creates a draft; the location is rounded to 3 decimals and only the district is public', async () => {
    const u = await member();
    const l = await draft(u);
    expect(l).toMatchObject({ status: 'draft', price: '1500000', quantity: { total: 2, available: 2 }, district: 'Dhaka' });
    expect((l.own as { area: unknown }).area).toEqual({ district: 'Dhaka', lat: 23.81, lng: 90.412 });
    const [h] = await fx.query(`SELECT from_status, to_status, actor_type, actor_id FROM listings.status_history WHERE listing_id = $1`, [l.id]);
    expect(h).toEqual({ from_status: null, to_status: 'draft', actor_type: 'user', actor_id: u.userId });
  });

  it('FR-LST-06 without an area the draft takes the seller\'s saved area (I-24)', async () => {
    const u = await member();
    await fx.query(`UPDATE identity.users SET area_district = 'Sylhet', approx_lat = 24.895, approx_lng = 91.869 WHERE id = $1`, [u.userId]);
    const rest = { ...phoneDraft(), area: undefined }; // dropped by JSON.stringify
    const r = await u.call('POST', '/listings', rest);
    expect(r.status).toBe(201);
    expect(await r.json()).toMatchObject({ district: 'Sylhet', own: { area: { district: 'Sylhet', lat: 24.895, lng: 91.869 } } });
    const v = await member(); // no saved area: then the area is required
    expect(await errorsOf(await v.call('POST', '/listings', rest))).toContain('area:required');
  });

  it('FR-KYC-07 only a verified seller with a verified e-mail creates listings', async () => {
    for (const o of [{ kyc: 'unsubmitted' }, { kyc: 'pending_review' }, { emailVerified: false }]) {
      const u = await member(o);
      expect((await u.call('POST', '/listings', phoneDraft())).status).toBe(403);
    }
  });

  it('I-53 the same Idempotency-Key gives the same draft; another key a new one', async () => {
    const u = await member();
    const key = `k-${randomUUID()}`;
    const first = await u.call('POST', '/listings', phoneDraft(), { 'idempotency-key': key });
    const again = await u.call('POST', '/listings', phoneDraft(), { 'idempotency-key': key });
    expect([first.status, again.status]).toEqual([201, 200]);
    const [a, b] = [await first.json(), await again.json()];
    expect(b.id).toBe(a.id);
    const other = await (await u.call('POST', '/listings', phoneDraft(), { 'idempotency-key': `k-${randomUUID()}` })).json();
    expect(other.id).not.toBe(a.id);
    expect((await u.call('POST', '/listings', phoneDraft(), { 'idempotency-key': 'bad key!' })).status).toBe(400);
    // another user's identical key is a different request
    const v = await member();
    expect((await (await v.call('POST', '/listings', phoneDraft(), { 'idempotency-key': key })).json()).id).not.toBe(a.id);
  });

  it('FR-LST-02 and FR-LST-03 the item details are checked together, each problem named', async () => {
    const u = await member();
    const r = await u.call('POST', '/listings', phoneDraft({ condition: undefined, fulfilmentOptions: 'courier_only', weightClass: null, price: undefined }));
    expect(r.status).toBe(400);
    expect(await errorsOf(r)).toEqual(expect.arrayContaining(['condition:required', 'weightClass:required-for-courier', 'price:required']));
    const game = await u.call('POST', '/listings', { ...phoneDraft({ itemKind: 'game_account', categoryId: games }), area: undefined });
    expect(await errorsOf(game)).toEqual(expect.arrayContaining(['condition:not-for-game-accounts', 'fulfilmentOptions:not-for-game-accounts']));
    const auction = await u.call('POST', '/listings', phoneDraft({ saleFormat: 'auction' }));
    expect(await errorsOf(auction)).toEqual(expect.arrayContaining(['price:auction-sets-start-price-at-publication', 'quantity:single-unit']));
    expect((await u.call('POST', '/listings', { ...phoneDraft(), sellerVisible: false })).status).toBe(400); // unknown field
  });

  it('I-23 no courier for an item over 10 kg or an oversize item; pickup is fine', async () => {
    const u = await member();
    const heavy = await u.call('POST', '/listings', phoneDraft({ weightClass: 'over_10kg' }));
    expect(await errorsOf(heavy)).toContain('weightClass:no-courier-over-10kg');
    const big = await u.call('POST', '/listings', phoneDraft({ sizeClass: 'oversize', fulfilmentOptions: 'courier_only' }));
    expect(await errorsOf(big)).toContain('sizeClass:no-courier-oversize');
    expect((await u.call('POST', '/listings', phoneDraft({ weightClass: 'over_10kg', sizeClass: 'oversize', fulfilmentOptions: 'pickup_only' }))).status).toBe(201);
  });

  // ---------------------------------------------------------------- photos

  it('SEC-DAT-08 a photo is re-encoded at most 1600 px, with a 400 px thumbnail, and keeps no EXIF location', async () => {
    const u = await member();
    const l = await draft(u);
    const withGps = await sharp({ create: { width: 3200, height: 2000, channels: 3, background: '#7a7' } })
      .jpeg()
      .withExif({ IFD0: { Copyright: 'home' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '23/1 48/1 0/1' } })
      .toBuffer();
    expect((await sharp(withGps).metadata()).exif).toBeDefined();
    const r = await photo(u, l.id, { bytes: withGps, showsDefects: true });
    expect(r.status).toBe(201);
    const p = await r.json();
    expect(p).toMatchObject({ position: 1, width: 1600, height: 1000, showsDefects: true });
    const full = await guest('GET', p.url);
    expect(full.status).toBe(200);
    expect(full.headers.get('content-type')).toBe('image/jpeg');
    expect(full.headers.get('x-content-type-options')).toBe('nosniff');
    const meta = await sharp(Buffer.from(await full.arrayBuffer())).metadata();
    expect(meta).toMatchObject({ width: 1600, height: 1000, format: 'jpeg' });
    expect(meta.exif).toBeUndefined();
    const thumb = await sharp(Buffer.from(await (await guest('GET', p.thumbUrl)).arrayBuffer())).metadata();
    expect(Math.max(thumb.width!, thumb.height!)).toBe(400);
  });

  it('SEC-INP-04 a file that is not an image is refused, whatever its name or declared type', async () => {
    const u = await member();
    const l = await draft(u);
    const r = await photo(u, l.id, { bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>') });
    expect(r.status).toBe(422);
    expect(await errorsOf(r)).toEqual(['photo:not-an-image']);
    const cut = (await jpeg()).subarray(0, 400);
    expect(await errorsOf(await photo(u, l.id, { bytes: cut }))).toEqual(['photo:unreadable']);
  });

  it('CP-33 at most ten photos are shown; a removed photo frees its place and is no longer served', async () => {
    const u = await member();
    const l = await draft(u);
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      const r = await photo(u, l.id, { bytes: await jpeg(200, 150) });
      expect(r.status).toBe(201);
      ids.push((await r.json()).id);
    }
    expect((await photo(u, l.id)).status).toBe(409);
    const view = await (await u.call('GET', `/listings/${l.id}`)).json();
    const third = view.photos[2];
    expect((await u.call('DELETE', `/listings/${l.id}/photos/${third.id}`)).status).toBe(204);
    expect((await guest('GET', third.url)).status).toBe(404);
    const again = await photo(u, l.id);
    expect(again.status).toBe(201);
    expect((await again.json()).position).toBe(3);
  });

  // ---------------------------------------------------------------- publication

  it('FR-LST-02 publishing needs two photos and a defect photo or the no-defects declaration', async () => {
    const u = await member();
    const l = await draft(u, { noVisibleDefects: false });
    await photo(u, l.id);
    const r = await u.call('POST', `/listings/${l.id}/publish`, {});
    expect(r.status).toBe(422);
    expect(await errorsOf(r)).toEqual(['photos:two-needed', 'photos:defect-photo-or-declaration']);
    await photo(u, l.id, { showsDefects: true });
    const ok = await u.call('POST', `/listings/${l.id}/publish`, {});
    expect(ok.status).toBe(200);
  });

  it('FR-LST-12 a published listing is active, announced once and in its history', async () => {
    const u = await member();
    const id = await active(u);
    expect(await outbox(id)).toEqual([
      { event_type: 'listings.listing.published', payload: { listingId: id, sellerId: u.userId, itemKind: 'physical', saleFormat: 'fixed_price' } },
    ]);
    const rows = await fx.query(`SELECT from_status, to_status, reason FROM listings.status_history WHERE listing_id = $1 ORDER BY id`, [id]);
    expect(rows[1]).toEqual({ from_status: 'draft', to_status: 'active', reason: 'published' });
    expect((await u.call('POST', `/listings/${id}/publish`, {})).status).toBe(409);
  });

  it('FR-LST-11 a screening term holds the listing for review, without telling the seller which word', async () => {
    const term = `zq${randomUUID().slice(0, 6)}`;
    await fx.query(`INSERT INTO listings.screening_terms (term, severity) VALUES ($1, 'high_risk')`, [term]);
    const u = await member();
    const l = await draft(u, { description: `A phone, works well. Contact me about ${term.toUpperCase()} offers.` });
    await photo(u, l.id);
    await photo(u, l.id);
    const r = await u.call('POST', `/listings/${l.id}/publish`, {});
    expect(r.status).toBe(200);
    const body = await r.text();
    expect(JSON.parse(body).status).toBe('pending_review');
    expect(body).not.toContain(term);
    expect(await outbox(l.id)).toEqual([]);
    const [h] = await fx.query<{ reason: string }>(`SELECT reason FROM listings.status_history WHERE listing_id = $1 AND to_status = 'pending_review'`, [l.id]);
    expect(h.reason).toContain(term);
    expect((await guest('GET', `/listings/${l.id}`)).status).toBe(404);
  });

  it('FR-LST-12 a game-account listing waits for the ownership approval of Unit 5', async () => {
    const u = await member();
    const r = await u.call('POST', '/listings', {
      itemKind: 'game_account', saleFormat: 'fixed_price', categoryId: games, title: 'PUBG account level 70',
      description: 'Level 70 account with many skins and two seasons of passes.', price: '500000',
    });
    expect(r.status).toBe(201);
    const { id } = await r.json();
    const p = await u.call('POST', `/listings/${id}/publish`, {});
    expect((await p.json()).status).toBe('pending_review');
  });

  it('FR-LST-09 the listing limit CP-28 counts the seller\'s active listings', async () => {
    const u = await member();
    for (let i = 0; i < 10; i++) {
      const [{ id }] = await fx.query<{ id: string }>(
        `INSERT INTO listings.listings (seller_id, item_kind, sale_format, category_id, title, description, price)
         VALUES ($1, 'game_account', 'fixed_price', $2, 'Game account for sale', 'An account with many items in it.', 100000) RETURNING id`,
        [u.userId, games],
      );
      await fx.query(`UPDATE listings.listings SET status = 'active', published_at = now() WHERE id = $1`, [id]);
    }
    const l = await draft(u);
    await photo(u, l.id);
    await photo(u, l.id);
    expect((await u.call('POST', `/listings/${l.id}/publish`, {})).status).toBe(409);
  });

  it('FR-AUC-01 publishing an auction fixes its terms and copies CP-08 and CP-09 into the auction', async () => {
    const u = await member();
    const l = await draft(u, { saleFormat: 'auction', price: undefined, quantity: undefined });
    await photo(u, l.id);
    await photo(u, l.id);
    const bad = await u.call('POST', `/listings/${l.id}/publish`, { startPrice: '100000', reservePrice: '50000', duration: '5 hours' });
    expect(await errorsOf(bad)).toEqual(['duration:one-of-cp-07', 'reservePrice:below-start-price']);
    const r = await u.call('POST', `/listings/${l.id}/publish`, { startPrice: '100000', reservePrice: '300000', duration: '24 hours' });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.auction).toMatchObject({ status: 'open', startPrice: '100000', bidCount: 0, hasReserve: true, reserveMet: false, reservePrice: '300000' });
    const [a] = await fx.query<Record<string, unknown>>(
      `SELECT inc_bps, inc_min, snipe_window::text, snipe_extension::text, extract(epoch FROM end_at - starts_at)::int AS secs FROM auctions.auctions WHERE listing_id = $1`,
      [l.id],
    );
    expect(a).toEqual({ inc_bps: 200, inc_min: '5000', snipe_window: '00:02:00', snipe_extension: '00:02:00', secs: 86400 });
    const pub = await (await guest('GET', `/listings/${l.id}`)).json();
    expect(pub.auction.reservePrice).toBeUndefined(); // SEC-WEB-05
    expect(pub.auction.serverTime).toEqual(expect.any(String));
  });

  // ---------------------------------------------------------------- after publication

  it('FR-LST-07 an active listing changes its text and price until the first order, never its category', async () => {
    const u = await member();
    const id = await active(u);
    const ok = await u.call('PATCH', `/listings/${id}`, { title: 'Used Android phone, 128 GB', price: '1450000' });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ title: 'Used Android phone, 128 GB', price: '1450000' });
    const cat = await u.call('PATCH', `/listings/${id}`, { categoryId: games });
    expect(cat.status).toBe(409);
    expect(await errorsOf(cat)).toEqual(['categoryId:fixed-after-publication']);
    const port = t.app.get<ListingsPort>(LISTINGS_PORT);
    await t.app.get(DataSource).transaction((m: EntityManager) => port.reserve(id, 1, m));
    expect((await u.call('PATCH', `/listings/${id}`, { title: 'A different title now' })).status).toBe(409);
    expect((await (await u.call('PATCH', `/listings/${id}`, { title: 'A different title now' })).json()).type).toBe('/problems/listing-locked');
    const c = await u.call('POST', `/listings/${id}/clarifications`, { body: '  Box and receipt included.  ' });
    expect(c.status).toBe(201);
    const page = await (await guest('GET', `/listings/${id}`)).json();
    expect(page.clarifications).toEqual([{ id: expect.any(String), body: 'Box and receipt included.', at: expect.any(String) }]);
    expect(page.locked).toBe(true);
  });

  it('FR-LST-08 a draft is discarded; an active listing with a reservation cannot be cancelled; an auction without bids can', async () => {
    const u = await member();
    const d = await draft(u);
    expect((await (await u.call('POST', `/listings/${d.id}/cancel`)).json()).status).toBe('cancelled');
    expect(await outbox(d.id)).toEqual([]);

    const id = await active(u);
    const port = t.app.get<ListingsPort>(LISTINGS_PORT);
    await t.app.get(DataSource).transaction((m: EntityManager) => port.reserve(id, 1, m));
    const held = await u.call('POST', `/listings/${id}/cancel`);
    expect(held.status).toBe(409);
    expect(await errorsOf(held)).toEqual(['listing:order-in-progress']);

    const a = await draft(u, { saleFormat: 'auction', price: undefined, quantity: undefined });
    await photo(u, a.id);
    await photo(u, a.id);
    await u.call('POST', `/listings/${a.id}/publish`, { startPrice: '100000', duration: '1 hour' });
    const r = await u.call('POST', `/listings/${a.id}/cancel`);
    expect((await r.json()).auction.status).toBe('cancelled');
    expect((await outbox(a.id)).map((e) => e.event_type)).toEqual(['listings.listing.published', 'listings.listing.cancelled']); // I-30
  });

  it('FR-SRC-04 others see an active listing of a visible seller only, never its coordinates', async () => {
    const u = await member();
    const d = await draft(u);
    expect((await guest('GET', `/listings/${d.id}`)).status).toBe(404); // a draft is the seller's
    const id = await active(u);
    const page = await guest('GET', `/listings/${id}`);
    const text = await page.text();
    expect(page.status).toBe(200);
    expect(JSON.parse(text)).toMatchObject({ status: 'active', district: 'Dhaka', seller: { id: u.userId, verified: true } });
    expect(text).not.toContain('23.81');
    expect(JSON.parse(text).own).toBeUndefined();
    await fx.query(`UPDATE listings.listings SET seller_visible = false WHERE id = $1`, [id]);
    expect((await guest('GET', `/listings/${id}`)).status).toBe(404);
    expect((await u.call('GET', `/listings/${id}`)).status).toBe(200);
  });

  it('FR-LST-12 my listings, newest first, filtered by status, in pages', async () => {
    const u = await member();
    const ids = [(await draft(u)).id, (await draft(u)).id, await active(u)];
    const all = await (await u.call('GET', '/me/listings')).json();
    expect(all.items.map((i: { id: string }) => i.id)).toEqual([...ids].reverse());
    expect(all.nextCursor).toBeNull();
    const drafts = await (await u.call('GET', '/me/listings?status=draft')).json();
    expect(drafts.items).toHaveLength(2);
    expect((await u.call('GET', '/me/listings?cursor=nonsense')).status).toBe(400);
    expect((await (await u.call('GET', '/me/listings')).json()).items[0].thumbUrl).toMatch(/size=thumb$/);
  });

  // ---------------------------------------------------------------- SEC-SDL-09's four negative cases

  it('SEC-SDL-09 another user\'s listing, a lower role, no session and an expired session are all refused', async () => {
    const owner = await member();
    const d = await draft(owner);
    const other = await member();
    expect((await other.call('PATCH', `/listings/${d.id}`, { title: 'Taken over listing' })).status).toBe(404);
    expect((await other.call('POST', `/listings/${d.id}/cancel`)).status).toBe(404);
    expect((await other.call('GET', `/listings/${d.id}`)).status).toBe(404);
    const unverified = await member({ kyc: 'revoked' });
    expect((await unverified.call('POST', `/listings/${d.id}/publish`, {})).status).toBe(403);
    expect((await guest('POST', '/listings', phoneDraft())).status).toBe(401);
    expect((await guest('PATCH', `/listings/${d.id}`, { title: 'No session at all' })).status).toBe(401);
    const sid = await fx.session({ userId: owner.userId }, { idleSeconds: -60 });
    const expired = await fetch(t.url(`/listings/${d.id}`), {
      method: 'PATCH', headers: { ...fx.headers(sid, owner.userId, 'user'), 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Expired session edit' }),
    });
    expect(expired.status).toBe(401);
  });

  // ---------------------------------------------------------------- the stock port and the order events

  it('FR-FIX-05 twenty buyers racing for two units get exactly two reservations', async () => {
    const u = await member();
    const id = await active(u);
    const port = t.app.get<ListingsPort>(LISTINGS_PORT);
    const db = t.app.get(DataSource);
    const results = await Promise.all(Array.from({ length: 20 }, () => db.transaction((m: EntityManager) => port.reserve(id, 1, m))));
    expect(results.filter(Boolean)).toHaveLength(2);
    const [l] = await fx.query(`SELECT quantity_available, quantity_reserved FROM listings.listings WHERE id = $1`, [id]);
    expect(l).toEqual({ quantity_available: 0, quantity_reserved: 2 });
    expect((await (await guest('GET', `/listings/${id}`)).json()).currentlyReserved).toBe(true);
  });

  it('FR-FIX-04 order events: paid sells, cancelled returns, a redelivery moves nothing twice', async () => {
    const u = await member();
    const id = await active(u);
    const port = t.app.get<ListingsPort>(LISTINGS_PORT);
    const stock = t.app.get(StockService);
    await t.app.get(DataSource).transaction(async (m: EntityManager) => {
      expect(await port.reserve(id, 1, m)).toBe(true);
      expect(await port.reserve(id, 1, m)).toBe(true);
    });
    const [paid, cancelled] = [randomUUID(), randomUUID()];
    const ev = (orderId: string) => ({ aggregateId: orderId, payload: { listingId: id, quantity: 1 } });
    await stock.onOrder(ev(paid), 'sold');
    await stock.onOrder(ev(paid), 'sold'); // redelivered
    await stock.onOrder(ev(paid), 'released'); // a cancellation after payment returns nothing (I-14)
    await stock.onOrder(ev(cancelled), 'released');
    await stock.onOrder(ev(cancelled), 'released');
    const [l] = await fx.query(`SELECT quantity_available, quantity_reserved, quantity_sold, status FROM listings.listings WHERE id = $1`, [id]);
    expect(l).toEqual({ quantity_available: 1, quantity_reserved: 0, quantity_sold: 1, status: 'active' });
    await t.app.get(DataSource).transaction((m: EntityManager) => port.reserve(id, 1, m));
    await stock.onOrder(ev(randomUUID()), 'sold');
    const [s] = await fx.query(`SELECT status FROM listings.listings WHERE id = $1`, [id]);
    expect(s.status).toBe('sold');
    expect((await outbox(id)).map((e) => e.event_type)).toEqual(['listings.listing.published', 'listings.listing.sold']);
    await expect(stock.onOrder({ aggregateId: randomUUID(), payload: {} }, 'sold')).rejects.toThrow(/lacks listingId/);
  });

  it('FR-FIX-01 the order keeps a copy of the listing the buyer saw (DR-03)', async () => {
    const u = await member();
    const id = await active(u);
    await u.call('POST', `/listings/${id}/clarifications`, { body: 'Screen protector fitted.' });
    const snap = await t.app.get<ListingsPort>(LISTINGS_PORT).snapshot(id);
    expect(snap).toMatchObject({
      listingId: id, sellerId: u.userId, price: '1500000', district: 'Dhaka', status: 'active',
      category: { id: phones }, clarifications: [{ body: 'Screen protector fitted.' }],
    });
    expect(snap.photoKeys).toHaveLength(2);
    await expect(t.app.get<ListingsPort>(LISTINGS_PORT).snapshot(randomUUID())).rejects.toThrow();
  });
});
