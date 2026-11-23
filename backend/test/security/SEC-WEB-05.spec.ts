import { randomUUID } from 'crypto';
import { openAuction } from '../support/auctions';
import { suite } from './setup';

// SEC-WEB-05: the API returns only the fields each view needs; internal fields (hashes, blind indexes, other users'
// contact details, proxy maximums) never appear in responses.
const s = suite();
const INTERNAL = /hash|bidx|blind|_enc\b|Enc"|wrapped|secret|pepper|maxAmount|maximum(?!Bid)/i;
const keysOf = (v: unknown, out: string[] = []): string[] => {
  if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.push(k); keysOf(x, out); }
  return out;
};

describe('SEC-WEB-05 minimal responses', () => {
  it('SEC-WEB-05 a member\'s own account view has no hash, index or secret', async () => {
    const { b } = await s.signedIn();
    const me = await (await b.get('/me')).json();
    expect(keysOf(me).filter((k) => INTERNAL.test(k))).toEqual([]);
  });

  it('SEC-WEB-05 a public listing and its seller\'s profile carry no contact details of the seller', async () => {
    const seller = await s.fx.account({ kyc: 'verified' });
    const [{ id: category }] = await s.fx.query<{ id: number }>(`INSERT INTO listings.categories (slug, name_en, name_bn, item_kind) VALUES ($1, 'Kettles', 'কেটলি', 'physical') RETURNING id`, [`web05-${randomUUID().slice(0, 8)}`]);
    const [{ id }] = await s.fx.query<{ id: string }>(
      `INSERT INTO listings.listings (seller_id, item_kind, sale_format, category_id, title, description, condition, no_visible_defects,
          fulfilment_options, weight_class, size_class, area_district, approx_lat, approx_lng, price, quantity_total, quantity_available)
       VALUES ($1, 'physical', 'fixed_price', $2, 'Electric kettle', 'A kettle, written by the response test.', 'used', true,
          'pickup_only', 'up_to_1kg', 'small', 'Dhaka', 23.81, 90.41, 120000, 1, 1) RETURNING id`, [seller.userId, category]);
    for (const n of [1, 2]) await s.fx.query(`INSERT INTO listings.listing_photos (listing_id, position, storage_key, width, height) VALUES ($1, $2, $3, 800, 600)`, [id, n, randomUUID().replace(/-/g, '')]);
    await s.fx.query(`UPDATE listings.listings SET status = 'active', published_at = now() WHERE id = $1`, [id]);
    for (const path of [`/listings/${id}`, `/users/${seller.userId}/trust`, `/users/${seller.userId}/ratings`, '/search?q=kettle']) {
      const r = await s.browser().get(path);
      const text = await r.text();
      expect(text).not.toContain(seller.phone);
      expect(text.toLowerCase()).not.toContain(seller.email.toLowerCase());
      if (r.status === 200) expect(keysOf(JSON.parse(text)).filter((k) => INTERNAL.test(k))).toEqual([]);
    }
  });

  it('SEC-WEB-05 an auction shows the price and a masked leader, never anyone\'s proxy maximum', async () => {
    const seller = await s.fx.user({ kyc: 'verified' });
    const [{ id: category }] = await s.fx.query<{ id: number }>(`INSERT INTO listings.categories (slug, name_en, name_bn, item_kind) VALUES ($1, 'Clocks', 'ঘড়ি', 'physical') RETURNING id`, [`web05a-${randomUUID().slice(0, 8)}`]);
    const auction = await openAuction(s.fx, seller, category, { start: '100000', endsIn: '1 day' });
    const bidder = await s.signedIn({ kyc: 'verified' });
    expect((await bidder.b.post(`/auctions/${auction}/bids`, { maximum: '987600' })).status).toBe(201);
    const viewer = await s.signedIn({ kyc: 'verified' });
    for (const path of [`/auctions/${auction}`, `/auctions/${auction}/bids`, `/listings/${auction}`]) {
      const text = await (await viewer.b.get(path)).text();
      expect(text).not.toContain('987600');
      expect(text).not.toContain(bidder.a.userId);
    }
    // the bidder sees their own maximum, and only theirs
    expect(await (await bidder.b.get(`/auctions/${auction}/my-status`)).text()).toContain('987600');
  });
});
