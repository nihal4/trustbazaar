import { randomUUID } from 'crypto';
import { submitKyc, suite } from './setup';

// SEC-ACC-02: every request that names an object (order, listing, chat, KYC document, dispute, payout account,
// ciphertext) is checked against the requester; changing an identifier never reaches another person's object. The
// sweep over every object-taking endpoint is SEC-SDL-09.spec.ts; this file follows the kinds the requirement names.
const s = suite();

describe('SEC-ACC-02 object-level access', () => {
  async function seeded() {
    const seller = await s.signedIn({ kyc: 'verified' });
    const buyer = await s.signedIn({ kyc: 'verified' });
    const stranger = await s.signedIn({ kyc: 'verified' });
    const [{ id: category }] = await s.fx.query<{ id: number }>(
      `INSERT INTO listings.categories (slug, name_en, name_bn, item_kind) VALUES ($1, 'Fans', 'পাখা', 'physical') RETURNING id`,
      [`acc02-${randomUUID().slice(0, 8)}`],
    );
    const [{ id: listing }] = await s.fx.query<{ id: string }>(
      `INSERT INTO listings.listings (seller_id, item_kind, sale_format, category_id, title, description, condition, no_visible_defects,
          fulfilment_options, weight_class, size_class, area_district, approx_lat, approx_lng, price, quantity_total, quantity_available)
       VALUES ($1, 'physical', 'fixed_price', $2, 'Table fan', 'A table fan, written by the access test.', 'used', true,
          'pickup_only', 'up_to_1kg', 'small', 'Dhaka', 23.81, 90.41, 300000, 1, 1) RETURNING id`,
      [seller.a.userId, category],
    );
    const [{ id: order }] = await s.fx.query<{ id: string }>(
      `INSERT INTO orders.orders (kind, listing_id, item_kind, buyer_id, seller_id, quantity, unit_price, item_price, fulfilment, delivery_fee, total,
          listing_snapshot, commission_bps, delivery_margin_bps, params_version, payment_due_at, status, paid_at, fulfilment_step, fulfilment_due_at)
       VALUES ('fixed_price', $1, 'physical', $2, $3, 1, 300000, 300000, 'self_pickup', 0, 300000, '{"title":"Table fan"}', 500, 1000, 1,
               now(), 'paid', now(), 'meetup_handover', now() + interval '3 days') RETURNING id`,
      [listing, buyer.a.userId, seller.a.userId],
    );
    const [{ id: dispute }] = await s.fx.query<{ id: string }>(
      `INSERT INTO disputes.disputes (order_id, buyer_id, seller_id, item_kind, type, description, item_price, amount_collected, seller_due_at)
       VALUES ($1, $2, $3, 'physical', 'not_as_described', 'The fan does not turn at all.', 300000, 300000, now() + interval '2 days') RETURNING id`,
      [order, buyer.a.userId, seller.a.userId],
    );
    return { seller, buyer, stranger, listing, order, dispute };
  }

  it('SEC-ACC-02 an order, its dispute and a draft listing: the parties reach them, a stranger with the same identifiers does not', async () => {
    const x = await seeded();
    expect((await x.buyer.b.get(`/orders/${x.order}`)).status).toBe(200);
    expect((await x.seller.b.get(`/orders/${x.order}`)).status).toBe(200);
    expect((await x.buyer.b.get(`/disputes/${x.dispute}`)).status).toBe(200);
    expect([403, 404]).toContain((await x.stranger.b.get(`/orders/${x.order}`)).status);
    expect([403, 404]).toContain((await x.stranger.b.get(`/disputes/${x.dispute}`)).status);
    expect([403, 404]).toContain((await x.stranger.b.request('PATCH', `/listings/${x.listing}`, { title: 'Not your fan' })).status);
    expect([403, 404]).toContain((await x.buyer.b.request('PATCH', `/listings/${x.listing}`, { title: 'Not your fan either' })).status);
    const [l] = await s.fx.query(`SELECT title FROM listings.listings WHERE id = $1`, [x.listing]);
    expect(l.title).toBe('Table fan');
  });

  it("SEC-ACC-02 a refusal looks the same for another person's object and for one that does not exist", async () => {
    const x = await seeded();
    const theirs = await x.stranger.b.get(`/orders/${x.order}`);
    const none = await x.stranger.b.get(`/orders/${randomUUID()}`);
    expect(theirs.status).toBe(none.status);
  });

  it('SEC-ACC-02 a chat thread: only its two parties read and write it', async () => {
    const x = await seeded();
    for (const n of [1, 2])
      await s.fx.query(`INSERT INTO listings.listing_photos (listing_id, position, storage_key, width, height) VALUES ($1, $2, $3, 800, 600)`, [
        x.listing,
        n,
        randomUUID().replace(/-/g, ''),
      ]);
    await s.fx.query(`UPDATE listings.listings SET status = 'active', published_at = now() WHERE id = $1`, [x.listing]);
    const thread = (await (await x.buyer.b.post(`/listings/${x.listing}/threads`, {})).json()) as { id: string };
    expect((await x.seller.b.get(`/threads/${thread.id}/messages`)).status).toBe(200);
    expect([403, 404]).toContain((await x.stranger.b.get(`/threads/${thread.id}/messages`)).status);
    expect([403, 404]).toContain((await x.stranger.b.post(`/threads/${thread.id}/messages`, { clientId: randomUUID(), text: 'Hello from outside' })).status);
  });

  it("SEC-ACC-02 KYC documents: a member reaches only their own; the routes take no other member's identifier at all", async () => {
    const owner = await s.signedIn({ kyc: 'unsubmitted' });
    await submitKyc(owner.b);
    const other = await s.signedIn({ kyc: 'unsubmitted' });
    const { url } = (await (await owner.b.post('/kyc/files/doc_front/view')).json()) as { url: string };
    expect((await owner.b.get(url.replace('/api/v1', ''))).status).toBe(200);
    expect((await other.b.get(url.replace('/api/v1', ''))).status).toBe(410); // the link is tied to the owner's session
    expect((await other.b.post('/kyc/files/doc_front/view')).status).toBe(404); // the other member's own: none submitted
  });

  it('SEC-ACC-02 payout accounts and game ciphertext: reached only through the owner, never by identifier', async () => {
    const x = await seeded();
    // a payout account is only "my payout account": there is no route that names one, so none can be swapped
    const payoutRoutes = (await import('../support/routes')).routesOf(s.t.app).filter((r) => r.path.includes('payout-account') && r.policy?.kind !== 'staff');
    expect(payoutRoutes.every((r) => !r.path.includes(':'))).toBe(true);
    // the sealed credentials of an order: neither a stranger nor the seller may fetch them
    expect([403, 404]).toContain((await x.stranger.b.get(`/orders/${x.order}/game/sealed`)).status);
    expect([403, 404, 409]).toContain((await x.seller.b.get(`/orders/${x.order}/game/sealed`)).status);
  });
});
