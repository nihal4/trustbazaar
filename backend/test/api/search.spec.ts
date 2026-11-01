import { randomInt, randomUUID } from 'crypto';
import { loadConfig } from '../../src/kernel/config/config';
import { startApp, TestApp } from '../support/app';
import { IdentityFixtures } from '../support/identity';

// U3-03: GET /search over HTTP against PostgreSQL (docs/design/03_listings_auctions.pdf section 7): Bangla and English
// text, filters, sorts, distance, cursor pages, what never appears, featured listings, guests and the limits.
// Other suites' listings share the database, so each test searches inside categories of its own.

const DHAKA = { lat: 23.81, lng: 90.41 };
const CHATTOGRAM = { lat: 22.357, lng: 91.783 };
const SYLHET = { lat: 24.894, lng: 91.868 };

describe('search', () => {
  let t: TestApp;
  let fx: IdentityFixtures;
  let origin: string;
  let seller: string;

  beforeAll(async () => {
    t = await startApp();
    fx = await IdentityFixtures.open();
    origin = loadConfig(process.env).publicOrigin;
    seller = await fx.user();
  });
  afterAll(async () => {
    await fx?.close();
    await t?.close();
  });

  const tag = () => randomUUID().slice(0, 8);
  async function category(kind = 'physical', parentId: number | null = null) {
    const [{ id }] = await fx.query<{ id: number }>(
      `INSERT INTO listings.categories (slug, name_en, name_bn, item_kind, parent_id) VALUES ($1, 'Search', 'খোঁজ', $2, $3) RETURNING id`,
      [`search-${tag()}`, kind, parentId],
    );
    return id;
  }
  interface Item { title?: string; description?: string; price?: number; at?: { lat: number; lng: number }; condition?: string; auction?: { start: number; endsIn?: string }; sellerId?: string }
  /** An active listing, published as the database allows it; returns its id. */
  async function listing(categoryId: number, o: Item = {}) {
    const at = o.at ?? DHAKA;
    const auction = o.auction !== undefined;
    const [{ id }] = await fx.query<{ id: string }>(
      `INSERT INTO listings.listings (seller_id, item_kind, sale_format, category_id, title, description, condition, no_visible_defects,
                                      fulfilment_options, area_district, approx_lat, approx_lng, price)
       VALUES ($1, 'physical', $2, $3, $4, $5, $6, true, 'pickup_only', 'Dhaka', $7, $8, $9) RETURNING id`,
      [o.sellerId ?? seller, auction ? 'auction' : 'fixed_price', categoryId, o.title ?? 'Used item for sale', o.description ?? 'A used item in good working order, as described.',
       o.condition ?? 'used', at.lat, at.lng, auction ? null : (o.price ?? 100000)],
    );
    for (const position of [1, 2]) {
      await fx.query(`INSERT INTO listings.listing_photos (listing_id, position, storage_key, width, height) VALUES ($1, $2, $3, 800, 600)`, [id, position, randomUUID().replace(/-/g, '')]);
    }
    await fx.query(`UPDATE listings.listings SET status = 'active', published_at = clock_timestamp() WHERE id = $1`, [id]);
    if (o.auction) {
      await fx.query(
        `INSERT INTO auctions.auctions (listing_id, seller_id, start_price, inc_bps, inc_min, snipe_window, snipe_extension, starts_at, original_end_at, end_at)
         VALUES ($1, $2, $3, 200, 5000, '2 minutes', '2 minutes', now() - interval '1 minute', now() + $4::interval, now() + $4::interval)`,
        [id, o.sellerId ?? seller, o.auction.start, o.auction.endsIn ?? '1 day'],
      );
    }
    return id;
  }
  const ip = () => `192.0.2.${randomInt(1, 255)}, 10.4.${randomInt(0, 255)}.${randomInt(1, 255)}`;
  async function search(params: Record<string, string | number>, headers: Record<string, string> = {}) {
    const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
    const r = await fetch(t.url(`/search?${qs}`), { headers: { origin, 'x-forwarded-for': ip(), ...headers } });
    return { status: r.status, body: (await r.json()) as { items: Record<string, unknown>[]; nextCursor: string | null; featured: Record<string, unknown>[]; sort: string; errors?: { field: string; reason: string }[] } };
  }
  const ids = async (params: Record<string, string | number>) => {
    const r = await search(params);
    expect(r.status).toBe(200);
    return r.body.items.map((i) => i.id);
  };

  it('FR-SRC-01 Bangla and English words, parts of words, a misspelling and description words find the same listing', async () => {
    const cat = await category();
    const phone = await listing(cat, { title: 'Samsung মোবাইল ফোন', description: 'Comes with its leather case and the original charger.' });
    const other = await listing(cat, { title: 'Wooden study table', description: 'A sturdy table, good for students.' });
    for (const q of ['মোবাইল', 'samsung', 'SAMSUNG', 'samsun', 'samsumg', 'মোবাইলে', 'leather']) {
      expect({ q, found: await ids({ q, category: cat }) }).toEqual({ q, found: [phone] });
    }
    expect(await ids({ q: 'table', category: cat })).toEqual([other]);
    expect(await ids({ q: 'galaxy', category: cat })).toEqual([]);
    // with words and no sort, the best match comes first
    const r = await search({ q: 'samsung', category: cat });
    expect(r.body.sort).toBe('relevance');
  });

  it('FR-SRC-02 filters: category with its sub-categories, kind, format, price (an auction at its current price), condition', async () => {
    const parent = await category();
    const child = await category('physical', parent);
    const cheap = await listing(parent, { price: 50000, condition: 'new' });
    const dear = await listing(child, { price: 900000 });
    const bidded = await listing(child, { auction: { start: 100000 } });
    await fx.query(`UPDATE auctions.auctions SET leader_id = $2, leader_max = 400000, current_price = 300000, bid_count = 1 WHERE listing_id = $1`, [bidded, await fx.user()]);

    expect((await ids({ category: parent })).sort()).toEqual([cheap, dear, bidded].sort());
    expect((await ids({ category: child })).sort()).toEqual([dear, bidded].sort());
    expect(await ids({ category: parent, saleFormat: 'auction' })).toEqual([bidded]);
    expect(await ids({ category: parent, itemKind: 'game_account' })).toEqual([]);
    expect(await ids({ category: parent, condition: 'new' })).toEqual([cheap]);
    expect(await ids({ category: parent, minPrice: 200000, maxPrice: 400000 })).toEqual([bidded]);
    const [card] = (await search({ category: parent, saleFormat: 'auction' })).body.items;
    expect(card).toMatchObject({ price: '300000', saleFormat: 'auction', auction: { bidCount: 1, reserveMet: true }, district: 'Dhaka' });
    expect(String(card.thumbUrl)).toMatch(/^\/api\/v1\/listing-photos\/[0-9a-f]{32}\?size=thumb$/);
  });

  it('FR-SRC-05 distance from the search point, in whole kilometres, never with coordinates', async () => {
    const cat = await category();
    const dhaka = await listing(cat, { at: DHAKA });
    const ctg = await listing(cat, { at: CHATTOGRAM });
    const syl = await listing(cat, { at: SYLHET });
    const r = await search({ category: cat, ...DHAKA, sort: 'distance' });
    expect(r.body.items.map((i) => [i.id, i.distanceKm])).toEqual([[dhaka, 0], [syl, expect.any(Number)], [ctg, expect.any(Number)]]);
    const km = r.body.items[2].distanceKm as number;
    expect(Number.isInteger(km)).toBe(true);
    expect(km).toBeGreaterThanOrEqual(205);
    expect(km).toBeLessThanOrEqual(225); // about 215 km (section 7.2)
    expect(await ids({ category: cat, ...DHAKA, maxKm: 210, sort: 'distance' })).toEqual([dhaka, syl]);
    const json = JSON.stringify(r.body);
    for (const leak of ['approx', 'lat', 'lng', '23.81', '91.78']) expect(json).not.toContain(leak);
    // the cursor carries the kilometres only
    const page = await search({ category: cat, ...DHAKA, sort: 'distance' });
    expect(page.body.nextCursor).toBeNull();
  });

  it('FR-SRC-02 a signed-in user without a point searches from their saved area; a guest must send one for distance', async () => {
    const cat = await category();
    const ctg = await listing(cat, { at: CHATTOGRAM });
    const near = await listing(cat, { at: { lat: 22.36, lng: 91.79 } });
    const user = await fx.user();
    await fx.query(`UPDATE identity.users SET area_district = 'Chattogram', approx_lat = 22.357, approx_lng = 91.783 WHERE id = $1`, [user]);
    const sid = await fx.session({ userId: user });
    const r = await search({ category: cat, sort: 'distance', maxKm: 5 }, fx.headers(sid, user, 'user'));
    expect(r.status).toBe(200);
    expect(r.body.items.map((i) => i.id)).toEqual([ctg, near]);
    const guest = await search({ category: cat, sort: 'distance' });
    expect(guest.status).toBe(400);
    expect(guest.body.errors).toEqual([{ field: 'sort', reason: 'needs-a-search-point' }]);
  });

  it('FR-SRC-03 sorts: newest, price up and down, auctions ending soonest', async () => {
    const cat = await category();
    const a = await listing(cat, { price: 300000 });
    const b = await listing(cat, { price: 100000 });
    const c = await listing(cat, { price: 200000 });
    const late = await listing(cat, { auction: { start: 150000, endsIn: '3 days' } });
    const soon = await listing(cat, { auction: { start: 250000, endsIn: '2 hours' } });
    expect(await ids({ category: cat })).toEqual([soon, late, c, b, a]);
    expect(await ids({ category: cat, sort: 'price_asc' })).toEqual([b, late, c, soon, a]);
    expect(await ids({ category: cat, sort: 'price_desc' })).toEqual([a, soon, c, late, b]);
    expect(await ids({ category: cat, sort: 'ending_soon' })).toEqual([soon, late]);
  });

  it('FR-SRC-03 cursor pages never repeat or skip a listing, also when new ones arrive between pages', async () => {
    const cat = await category();
    const made: string[] = [];
    for (let i = 0; i < 25; i++) made.push(await listing(cat, { price: 100000 + (i % 3) * 1000 }));
    for (const sort of ['newest', 'price_asc', 'price_desc']) {
      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const r = await search({ category: cat, sort, ...(cursor ? { cursor } : {}) });
        expect(r.status).toBe(200);
        expect(r.body.items.length).toBeLessThanOrEqual(20);
        seen.push(...r.body.items.map((i) => String(i.id)));
        cursor = r.body.nextCursor;
        if (pages++ === 0) await listing(cat, { price: 100500 }); // arrives after the first page
      } while (cursor);
      expect(new Set(seen).size).toBe(seen.length);
      for (const id of made) expect(seen).toContain(id);
    }
    const first = await search({ category: cat, sort: 'newest' });
    expect((await search({ category: cat, sort: 'price_asc', cursor: first.body.nextCursor! })).status).toBe(400);
    expect((await search({ category: cat, cursor: 'not-a-cursor' })).status).toBe(400);
    const forged = Buffer.from(JSON.stringify({ s: 'newest', k: ["2026-01-01'; DROP TABLE x;--"], id: randomUUID() })).toString('base64url');
    expect((await search({ category: cat, cursor: forged })).status).toBe(400);
  });

  it('FR-SRC-04 only active listings of visible sellers and open auctions appear', async () => {
    const cat = await category();
    const shown = await listing(cat);
    const hiddenSeller = await listing(cat);
    await fx.query(`UPDATE listings.listings SET seller_visible = false WHERE id = $1`, [hiddenSeller]);
    const cancelled = await listing(cat);
    await fx.query(`UPDATE listings.listings SET status = 'cancelled' WHERE id = $1`, [cancelled]);
    const closed = await listing(cat, { auction: { start: 100000 } });
    await fx.query(`UPDATE auctions.auctions SET status = 'unsold', closed_at = now() WHERE listing_id = $1`, [closed]);
    const draft = (await fx.query<{ id: string }>(
      `INSERT INTO listings.listings (seller_id, item_kind, sale_format, category_id, title, description, condition, no_visible_defects,
          fulfilment_options, area_district, approx_lat, approx_lng, price)
       VALUES ($1, 'physical', 'fixed_price', $2, 'Draft item', 'A draft that is not published yet.', 'used', true, 'pickup_only', 'Dhaka', 23.81, 90.41, 1000) RETURNING id`,
      [seller, cat],
    ))[0].id;
    const found = await ids({ category: cat });
    expect(found).toEqual([shown]);
    expect(found).not.toContain(draft);
  });

  it('FR-MON-05 featured matches are listed apart on the first page, at most DV-21, and labelled in the results', async () => {
    const cat = await category();
    const plain = await listing(cat);
    const featured: string[] = [];
    for (let i = 0; i < 4; i++) {
      const id = await listing(cat);
      await fx.query(`UPDATE listings.listings SET featured_until = now() + interval '1 day' WHERE id = $1`, [id]);
      featured.push(id);
    }
    const r = await search({ category: cat });
    expect(r.body.featured).toHaveLength(3);
    for (const f of r.body.featured) expect(f).toMatchObject({ featured: true });
    expect(r.body.items.find((i) => i.id === plain)).toMatchObject({ featured: false });
    expect(r.body.items.filter((i) => i.featured).map((i) => i.id).sort()).toEqual([...featured].sort()); // ranking unchanged, labelled
  });

  it('FR-SRC-05 guests search; bad parameters are 400; CP-35 limits a source address', async () => {
    const cat = await category();
    await listing(cat);
    expect((await ids({ category: cat })).length).toBe(1);
    const bads: Record<string, string | number>[] = [
      { lat: 23.8 }, { sort: 'relevance' }, { minPrice: 500, maxPrice: 100 }, { sort: 'cheapest' }, { lat: 50, lng: 90 },
      { maxKm: 0, lat: 23.8, lng: 90.4 }, { category: 'phones' }, { minPrice: '12.5' }, { surprise: 1 },
    ];
    for (const bad of bads) {
      expect({ bad, status: (await search(bad)).status }).toEqual({ bad, status: 400 });
    }
    const address = `198.18.${randomInt(0, 255)}.${randomInt(1, 255)}`;
    let last = 0;
    for (let i = 0; i < 61; i++) last = (await fetch(t.url(`/search?category=${cat}`), { headers: { origin, 'x-forwarded-for': `${address}, 10.0.0.1` } })).status;
    expect(last).toBe(429);
  });
});
