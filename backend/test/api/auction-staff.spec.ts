import { randomInt, randomUUID } from 'crypto';
import { AUCTION_QUERY, AuctionQuery, LISTINGS_QUERIES, ListingsQueries } from '../../src/modules/listings/ports';
import { AuctionCloser } from '../../src/modules/listings/services/auction-closer.service';
import { ShillDetector } from '../../src/modules/listings/services/shill-detector.service';
import { startApp, TestApp } from '../support/app';
import { endAuction, openAuction } from '../support/auctions';
import { IdentityFixtures } from '../support/identity';

// U3-06: operators void bids, cancel auctions and see maximums only while a flag is open; the ShillDetector raises
// flags; a similar relisting is flagged; ListingsQueries.fulfilmentFacts (docs/design/03_listings_auctions.pdf
// sections 3.1, 5.5, 5.8, 6.1; 09_integration section 4). Amounts in poisha.

describe('auction staff actions, shill flags and relisting', () => {
  let t: TestApp;
  let fx: IdentityFixtures;
  let category: number;

  beforeAll(async () => {
    process.env.OUTBOX_DISPATCHER = 'off'; // events are read from the outbox, not delivered
    t = await startApp();
    fx = await IdentityFixtures.open();
    [{ id: category }] = await fx.query<{ id: number }>(
      `INSERT INTO listings.categories (slug, name_en, name_bn, item_kind) VALUES ($1, 'Cameras', 'ক্যামেরা', 'physical') RETURNING id`,
      [`staff-${randomUUID().slice(0, 8)}`],
    );
  });
  afterAll(async () => {
    delete process.env.OUTBOX_DISPATCHER;
    await fx?.close();
    await t?.close();
  });

  async function member(o: { verifiedNow?: boolean } = {}) {
    const userId = await fx.user();
    if (o.verifiedNow) {
      await fx.query(`INSERT INTO identity.kyc_status_history (user_id, from_status, to_status, actor_type, at) VALUES ($1, 'pending_review', 'verified', 'system', now())`, [userId]);
    }
    const sid = await fx.session({ userId });
    const ip = `203.0.113.${randomInt(1, 255)}, 198.51.100.${randomInt(1, 255)}`;
    const call = (method: string, path: string, body?: unknown) =>
      fetch(t.url(path), {
        method, headers: { ...fx.headers(sid, userId, 'user'), 'x-forwarded-for': ip, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const bid = async (auction: string, maximum: string) => {
      const r = await call('POST', `/auctions/${auction}/bids`, { maximum });
      expect(r.status).toBe(201);
      return (await r.json()) as { bidId: string };
    };
    return { userId, call, bid };
  }
  async function operator() {
    const staffId = await fx.staff('operator');
    const sid = await fx.session({ staffId });
    const call = (method: string, path: string, body?: unknown) =>
      fetch(t.url(path), {
        method, headers: { ...fx.headers(sid, staffId, 'staff'), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    return { staffId, call };
  }
  const one = async <T = Record<string, unknown>>(sql: string, p: unknown[]) => (await fx.query<T>(sql, p))[0];
  const events = async (type: string, aggregateId: string) =>
    (await fx.query<{ payload: Record<string, unknown> }>(`SELECT payload FROM auctions.outbox WHERE event_type = $1 AND aggregate_id = $2 ORDER BY id`, [type, aggregateId]))
      .map((e) => e.payload);
  const audit = async (action: string, objectId: string) =>
    (await fx.query<{ reason: string | null }>(`SELECT reason FROM audit.events WHERE action = $1 AND object_id = $2`, [action, objectId]));
  const REASON = 'Bidder account compromised, confirmed by the owner.';

  it('FR-AUC-10 an operator voids a bid with a reason; the auction is recomputed as if it had not been placed', async () => {
    const seller = await member();
    const id = await openAuction(fx, seller.userId, category);
    const [a, b, c] = [await member(), await member(), await member()];
    await a.bid(id, '120000');
    await b.bid(id, '150000');
    const { bidId } = await c.bid(id, '300000'); // the leader, at 155000
    expect(await one(`SELECT leader_id, current_price::text AS p FROM auctions.auctions WHERE listing_id = $1`, [id])).toEqual({ leader_id: c.userId, p: '155000' });

    const op = await operator();
    expect((await op.call('POST', `/staff/bids/${bidId}/void`, { reason: 'short' })).status).toBe(400);
    expect((await a.call('POST', `/staff/bids/${bidId}/void`, { reason: REASON })).status).toBe(401); // users have no staff session
    const r = await op.call('POST', `/staff/bids/${bidId}/void`, { reason: REASON });
    expect(r.status).toBe(200);
    expect((await r.json()).state).toMatchObject({ price: '125000', bidCount: 2 }); // b leads again, one increment over a
    expect(await one(`SELECT leader_id, current_price::text AS p FROM auctions.auctions WHERE listing_id = $1`, [id])).toEqual({ leader_id: b.userId, p: '125000' });
    expect(await one(`SELECT void_reason, voided_by FROM auctions.bids WHERE id = $1`, [bidId])).toEqual({ void_reason: REASON, voided_by: op.staffId });
    expect(await events('auctions.bid.voided', id)).toEqual([{ auctionId: id, bidId, bidderId: c.userId, previousLeader: c.userId, leader: b.userId }]);
    expect(await audit('auctions.bid.voided', id)).toEqual([{ reason: REASON }]);
    expect((await op.call('POST', `/staff/bids/${bidId}/void`, { reason: REASON })).status).toBe(409); // once only
    expect((await op.call('POST', '/staff/bids/999999999999/void', { reason: REASON })).status).toBe(404);

    await endAuction(fx, id);
    const { bidId: late } = (await fx.query<{ bidId: string }>(`SELECT id::text AS "bidId" FROM auctions.bids WHERE auction_id = $1 AND bidder_id = $2`, [id, a.userId]))[0];
    await t.app.get(AuctionCloser).closeDue();
    expect((await op.call('POST', `/staff/bids/${late}/void`, { reason: REASON })).status).toBe(409); // closed: not recomputed
  });

  it('FR-LST-08 an operator cancels an auction with bids; its listing is cancelled and every bidder is named', async () => {
    const seller = await member();
    const id = await openAuction(fx, seller.userId, category);
    const [a, b] = [await member(), await member()];
    await a.bid(id, '120000');
    await b.bid(id, '150000');
    expect((await seller.call('POST', `/listings/${id}/cancel`)).status).toBe(409); // the seller cannot, once there are bids
    const op = await operator();
    const r = await op.call('POST', `/staff/auctions/${id}/cancel`, { reason: 'Item reported as stolen; police report seen.' });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ status: 'cancelled', minimumBid: null });
    expect(await one(`SELECT l.status AS listing, a.status AS auction FROM listings.listings l JOIN auctions.auctions a ON a.listing_id = l.id WHERE l.id = $1`, [id]))
      .toEqual({ listing: 'cancelled', auction: 'cancelled' });
    const [cancelled] = await events('auctions.auction.cancelled', id);
    expect(cancelled).toMatchObject({ auctionId: id, sellerId: seller.userId, by: 'operator' });
    expect((cancelled.bidderIds as string[]).sort()).toEqual([a.userId, b.userId].sort());
    expect(await events('listings.listing.cancelled', id)).toEqual([{ listingId: id, sellerId: seller.userId, itemKind: 'physical' }]);
    expect(await one(`SELECT actor_type, reason FROM listings.status_history WHERE listing_id = $1 AND to_status = 'cancelled'`, [id]))
      .toEqual({ actor_type: 'staff', reason: 'cancelled by an operator: Item reported as stolen; police report seen.' });
    expect((await a.call('POST', `/auctions/${id}/bids`, { maximum: '400000' })).status).toBeGreaterThanOrEqual(400);
    expect((await op.call('POST', `/staff/auctions/${id}/cancel`, { reason: 'Item reported as stolen; police report seen.' })).status).toBe(409);
  });

  it('FR-AUC-18 FR-AUC-08 new accounts raising in small steps are flagged; maximums are shown only while the flag is open', async () => {
    const seller = await member();
    const id = await openAuction(fx, seller.userId, category);
    const [n1, n2] = [await member({ verifiedNow: true }), await member({ verifiedNow: true })];
    await n1.bid(id, '100000');
    await n2.bid(id, '105000');
    await n1.bid(id, '110000');
    await n2.bid(id, '115000');
    const op = await operator();
    expect((await op.call('GET', `/staff/auctions/${id}/maximums`)).status).toBe(403); // no flag yet

    const detector = t.app.get(ShillDetector);
    expect(await detector.scan(id)).toBe(1);
    expect(await detector.scan(id)).toBe(0); // once per kind and auction
    const flags = await t.app.get<AuctionQuery>(AUCTION_QUERY).getFlags(id);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ kind: 'new_account_cluster', reviewedAt: null, detail: { smallRaises: 4 } });
    expect(flags[0].score).toBeGreaterThanOrEqual(0.5);
    expect(await events('auctions.flag.raised', id)).toEqual([{ auctionId: id, flagId: flags[0].id, kind: 'new_account_cluster', score: flags[0].score }]);

    const max = await op.call('GET', `/staff/auctions/${id}/maximums`);
    expect(max.status).toBe(200);
    const body = (await max.json()) as { bidders: { bidderId: string; maximum: string; alias: number }[] };
    expect(body.bidders.map((x) => [x.bidderId, x.maximum])).toEqual([[n2.userId, '115000'], [n1.userId, '110000']]);
    expect(await audit('auctions.maximums.viewed', id)).toHaveLength(1);

    expect((await op.call('POST', `/staff/auctions/${id}/flags/${flags[0].id}/review`, { note: 'ok' })).status).toBe(400);
    expect((await op.call('POST', `/staff/auctions/${id}/flags/${flags[0].id}/review`, { note: 'Checked: two friends, no link to the seller.' })).status).toBe(204);
    expect((await op.call('POST', `/staff/auctions/${id}/flags/${flags[0].id}/review`, { note: 'Checked: two friends, no link to the seller.' })).status).toBe(409);
    expect((await op.call('GET', `/staff/auctions/${id}/maximums`)).status).toBe(403); // closed again
    expect(await audit('auctions.flag.reviewed', id)).toEqual([{ reason: 'Checked: two friends, no link to the seller.' }]);
  });

  it('FR-AUC-18 a bidder in the final minute of several auctions is flagged; an ordinary auction is not', async () => {
    const seller = await member();
    const sniper = await member();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const id = await openAuction(fx, seller.userId, category, { endsIn: '30 seconds', window: '1 second', extension: '1 second' });
      await sniper.bid(id, '110000');
      ids.push(id);
    }
    const plain = await openAuction(fx, seller.userId, category);
    await (await member()).bid(plain, '110000');
    const detector = t.app.get(ShillDetector);
    expect(await detector.scan(plain)).toBe(0);
    expect(await detector.scan(ids[2])).toBe(1);
    const [flag] = await t.app.get<AuctionQuery>(AUCTION_QUERY).getFlags(ids[2]);
    expect(flag).toMatchObject({ kind: 'last_second_pattern', detail: { auctions: { [sniper.userId]: 3 } } });
  });

  it('FR-AUC-18 a bidder who raises the price on one seller\'s auctions and never wins is flagged', async () => {
    const seller = await member();
    const [pusher, winner] = [await member(), await member()];
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const id = await openAuction(fx, seller.userId, category);
      await pusher.bid(id, '130000');
      await winner.bid(id, '200000');
      await endAuction(fx, id);
      ids.push(id);
    }
    await t.app.get(AuctionCloser).closeDue();
    expect(await one(`SELECT count(*)::int AS n FROM auctions.auctions WHERE listing_id = ANY($1) AND winner_id = $2`, [ids, winner.userId])).toEqual({ n: 3 });
    expect(await t.app.get(ShillDetector).scan(ids[0])).toBe(1);
    const [flag] = await t.app.get<AuctionQuery>(AUCTION_QUERY).getFlags(ids[0]);
    expect(flag).toMatchObject({ kind: 'self_outbid_pattern', detail: { auctions: { [pusher.userId]: 3 } } });
    expect(JSON.stringify(flag.detail)).not.toContain(winner.userId);
  });

  it('FR-TNS-02 publishing an item like one cancelled in the last 7 days is flagged; publication goes on', async () => {
    const seller = await member();
    const draft = async (title: string, status: 'draft' | 'active') => {
      const [{ id }] = await fx.query<{ id: string }>(
        `INSERT INTO listings.listings (seller_id, item_kind, sale_format, category_id, title, description, condition, no_visible_defects,
            fulfilment_options, weight_class, size_class, area_district, approx_lat, approx_lng, price, quantity_total, quantity_available)
         VALUES ($1, 'physical', 'fixed_price', $2, $3, 'A camera in good condition, written by the relisting test.', 'used', true,
            'pickup_or_courier', 'up_to_1kg', 'small', 'Dhaka', 23.81, 90.41, 1500000, 1, 1) RETURNING id`,
        [seller.userId, category, title],
      );
      for (const n of [1, 2]) await fx.query(`INSERT INTO listings.listing_photos (listing_id, position, storage_key, width, height) VALUES ($1, $2, $3, 800, 600)`, [id, n, randomUUID().replace(/-/g, '')]);
      if (status === 'active') {
        await fx.query(`UPDATE listings.listings SET status = 'active', published_at = now() WHERE id = $1`, [id]);
        await fx.query(`INSERT INTO listings.status_history (listing_id, from_status, to_status, actor_type, actor_id, reason) VALUES ($1, 'draft', 'active', 'user', $2, 'published')`, [id, seller.userId]);
      }
      return id;
    };
    const first = await draft('Canon AE-1 film camera with 50mm lens', 'active');
    expect((await seller.call('POST', `/listings/${first}/cancel`)).status).toBe(200);
    const again = await draft('Canon AE-1 film camera with 50mm lens, boxed', 'draft');
    expect((await seller.call('POST', `/listings/${again}/publish`, {})).status).toBe(200);
    const [flagged] = await fx.query<{ payload: { previousListingId: string; similarity: number } }>(
      `SELECT payload FROM auctions.outbox WHERE event_type = 'listings.listing.relisting_flagged' AND aggregate_id = $1`, [again]);
    expect(flagged.payload.previousListingId).toBe(first);
    expect(flagged.payload.similarity).toBeGreaterThanOrEqual(0.6);
    expect(await one(`SELECT status FROM listings.listings WHERE id = $1`, [again])).toEqual({ status: 'active' });

    const other = await draft('Garden hose, 20 metres', 'draft');
    expect((await seller.call('POST', `/listings/${other}/publish`, {})).status).toBe(200);
    expect(await fx.query(`SELECT 1 FROM auctions.outbox WHERE event_type = 'listings.listing.relisting_flagged' AND aggregate_id = $1`, [other])).toEqual([]);
  });

  it('I-23 fulfilmentFacts gives Unit 4 the methods, parcel classes, district and rounded coordinates', async () => {
    const seller = await member();
    const id = await openAuction(fx, seller.userId, category);
    const q = t.app.get<ListingsQueries>(LISTINGS_QUERIES);
    expect(await q.fulfilmentFacts(id)).toEqual({ options: ['self_pickup'], weightClass: null, sizeClass: null, district: 'Dhaka', approxLat: 23.81, approxLng: 90.41 });
    await expect(q.fulfilmentFacts(randomUUID())).rejects.toMatchObject({ problem: 'not-found' });
  });
});
