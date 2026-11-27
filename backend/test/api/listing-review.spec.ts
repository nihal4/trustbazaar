import { randomInt, randomUUID } from 'crypto';
import { EventBus, OutboxEvent } from '../../src/kernel/events/event-bus';
import { ListingReviewService } from '../../src/modules/listings/services/listing-review.service';
import { startApp, TestApp } from '../support/app';
import { openAuction } from '../support/auctions';
import { IdentityFixtures } from '../support/identity';

// U3-08: operators review listings held by the screening terms, remove listings, maintain the terms; a seller's
// listings are hidden and shown with their KYC, account and sanctions (docs/design/03_listings_auctions.pdf sections
// 3.1, 3.4 and 5; FR-LST-11, FR-LST-12, FR-SRC-04, FR-TNS-05, I-45), against PostgreSQL through the real security
// pipeline. Events are read from the outbox and handed to their consumers as the dispatcher would.
describe('listing review, removal, screening terms and seller visibility', () => {
  let t: TestApp;
  let fx: IdentityFixtures;
  let bus: EventBus;
  let category: number;

  beforeAll(async () => {
    process.env.OUTBOX_DISPATCHER = 'off';
    t = await startApp();
    fx = await IdentityFixtures.open();
    bus = t.app.get(EventBus);
    [{ id: category }] = await fx.query<{ id: number }>(
      `INSERT INTO listings.categories (slug, name_en, name_bn, item_kind) VALUES ($1, 'Watches', 'ঘড়ি', 'physical') RETURNING id`,
      [`review-${randomUUID().slice(0, 8)}`],
    );
  });
  afterAll(async () => {
    delete process.env.OUTBOX_DISPATCHER;
    await fx?.close();
    await t?.close();
  });

  const caller = (headers: Record<string, string>) => (method: string, path: string, body?: unknown) =>
    fetch(t.url(path), {
      method,
      headers: { ...headers, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  async function member() {
    const userId = await fx.user();
    const sid = await fx.session({ userId });
    return {
      userId,
      call: caller({ ...fx.headers(sid, userId, 'user'), 'x-forwarded-for': `203.0.113.${randomInt(1, 255)}, 198.51.100.${randomInt(1, 255)}` }),
    };
  }
  async function operator() {
    const staffId = await fx.staff('operator');
    return { staffId, call: caller(fx.headers(await fx.session({ staffId }), staffId, 'staff')) };
  }
  /** A complete draft of the seller's, with its photos. */
  async function draft(sellerId: string, title: string) {
    const [{ id }] = await fx.query<{ id: string }>(
      `INSERT INTO listings.listings (seller_id, item_kind, sale_format, category_id, title, description, condition, no_visible_defects,
          fulfilment_options, weight_class, size_class, area_district, approx_lat, approx_lng, price, quantity_total, quantity_available)
       VALUES ($1, 'physical', 'fixed_price', $2, $3, 'A wrist watch in good condition, written by the review tests.', 'used', true,
          'pickup_only', 'up_to_1kg', 'small', 'Dhaka', 23.81, 90.41, 250000, 1, 1) RETURNING id`,
      [sellerId, category, title],
    );
    for (const n of [1, 2])
      await fx.query(`INSERT INTO listings.listing_photos (listing_id, position, storage_key, width, height) VALUES ($1, $2, $3, 800, 600)`, [
        id,
        n,
        randomUUID().replace(/-/g, ''),
      ]);
    return id;
  }
  const status = async (id: string) => (await fx.query<{ status: string }>(`SELECT status FROM listings.listings WHERE id = $1`, [id]))[0].status;
  const events = (id: string, type: string) =>
    fx.query<{ payload: Record<string, unknown> }>(`SELECT payload FROM auctions.outbox WHERE aggregate_id = $1 AND event_type = $2`, [id, type]);
  const errors = async (r: Response) => ((await r.json()) as { errors?: unknown[] }).errors;

  it('FR-LST-11 operators maintain the terms; a matching listing waits in the queue, readable by the operator; returned with a reason, then approved and published', async () => {
    const [op, seller] = [await operator(), await member()];
    const word = `replica${randomInt(10_000, 99_999)}`;
    const added = await op.call('POST', '/staff/screening-terms', { term: `  ${word.toUpperCase()} `, severity: 'high_risk' });
    expect([added.status, await added.json()]).toEqual([201, { id: expect.any(Number), term: word, severity: 'high_risk' }]);
    const { id: termId } = ((await (await op.call('GET', '/staff/screening-terms')).json()) as { items: { id: number; term: string }[] }).items.find(
      (i) => i.term === word,
    )!;
    expect(await errors(await op.call('POST', '/staff/screening-terms', { term: word, severity: 'prohibited' }))).toEqual([{ field: 'term', reason: 'taken' }]);
    expect((await seller.call('POST', '/staff/screening-terms', { term: 'x1', severity: 'prohibited' })).status).toBe(401);

    const id = await draft(seller.userId, `Gold watch ${word} edition`);
    expect(await (await seller.call('POST', `/listings/${id}/publish`, {})).json()).toMatchObject({ status: 'pending_review' });
    const queue = (await (await op.call('GET', '/staff/listings/review')).json()) as { items: { listingId: string; reason: string }[] };
    expect(queue.items.find((i) => i.listingId === id)).toMatchObject({ sellerId: seller.userId, reason: expect.stringContaining(word) });
    const console = (await (await op.call('GET', '/staff/queues/listings_review')).json()) as { items: { id: string; path: string }[] };
    expect(console.items.find((i) => i.id === id)).toMatchObject({ status: 'pending_review', path: `/staff/listings/${id}/review` });
    // Decisions log, U8-10: the operator reads the listing itself, without the seller's own area or a reserve; audited
    const seen = (await (await op.call('GET', `/staff/listings/${id}`)).json()) as Record<string, unknown>;
    expect(seen).toMatchObject({ id, status: 'pending_review', title: `Gold watch ${word} edition`, description: expect.any(String) });
    expect(Array.isArray(seen.photos)).toBe(true);
    expect(seen).not.toHaveProperty('own');
    expect((await seller.call('GET', `/staff/listings/${id}`)).status).toBe(401);
    expect((await op.call('GET', `/staff/listings/${randomUUID()}`)).status).toBe(404);

    expect(await errors(await op.call('POST', `/staff/listings/${id}/review`, { decision: 'return', reason: 'short' }))).toEqual([
      { field: 'reason', reason: 'too-short' },
    ]);
    const back = await op.call('POST', `/staff/listings/${id}/review`, {
      decision: 'return',
      reason: 'Replica watches may not be sold; describe the original.',
    });
    expect([back.status, await back.json()]).toEqual([200, { status: 'draft' }]);
    expect((await events(id, 'listings.listing.returned'))[0].payload).toMatchObject({
      sellerId: seller.userId,
      reason: 'Replica watches may not be sold; describe the original.',
    });
    expect((await op.call('POST', `/staff/listings/${id}/review`, { decision: 'return', reason: 'Returned a second time, by mistake.' })).status).toBe(409);

    expect((await seller.call('POST', `/listings/${id}/publish`, {})).status).toBe(200); // still matches: held again
    expect(
      await (await op.call('POST', `/staff/listings/${id}/review`, { decision: 'approve', reason: 'An original; the word is the model name.' })).json(),
    ).toEqual({ status: 'active' });
    expect(await status(id)).toBe('active');
    expect(await events(id, 'listings.listing.published')).toHaveLength(1);
    expect(
      (await fx.query<{ action: string }>(`SELECT action FROM audit.events WHERE object_id = $1 AND action LIKE 'listings.listing.%' ORDER BY id`, [id])).map(
        (a) => a.action,
      ),
    ).toEqual(['listings.listing.staff_viewed', 'listings.listing.returned', 'listings.listing.approved']);

    expect((await op.call('DELETE', `/staff/screening-terms/${termId}`)).status).toBe(204);
    expect((await op.call('DELETE', `/staff/screening-terms/${termId}`)).status).toBe(404);
    const later = await draft(seller.userId, `Silver watch ${word} edition`);
    expect(await (await seller.call('POST', `/listings/${later}/publish`, {})).json()).toMatchObject({ status: 'active' }); // the term is gone
  });

  it('FR-LST-12 FR-LST-08 a listing is removed for a policy breach; an open auction on it is cancelled and its bidders told; removed is final', async () => {
    const [op, seller, bidder] = [await operator(), await member(), await member()];
    const fixed = await draft(seller.userId, 'Counterfeit-looking chronograph');
    expect((await seller.call('POST', `/listings/${fixed}/publish`, {})).status).toBe(200);
    expect(await errors(await op.call('POST', `/staff/listings/${fixed}/remove`, { reason: 'too short' }))).toEqual([{ field: 'reason', reason: 'too-short' }]);
    expect(await (await op.call('POST', `/staff/listings/${fixed}/remove`, { reason: 'The photos show a counterfeit brand mark.' })).json()).toEqual({
      status: 'removed',
    });
    expect(await status(fixed)).toBe('removed');
    expect((await events(fixed, 'listings.listing.removed'))[0].payload).toEqual({
      listingId: fixed,
      sellerId: seller.userId,
      itemKind: 'physical',
      reason: 'The photos show a counterfeit brand mark.',
    });
    expect((await op.call('POST', `/staff/listings/${fixed}/remove`, { reason: 'The photos show a counterfeit brand mark.' })).status).toBe(409);
    expect((await (await member()).call('GET', `/listings/${fixed}`)).status).toBe(404);

    const auction = await openAuction(fx, seller.userId, category);
    expect((await bidder.call('POST', `/auctions/${auction}/bids`, { maximum: '150000' })).status).toBe(201);
    expect((await op.call('POST', `/staff/listings/${auction}/remove`, { reason: 'Stolen goods reported by the police.' })).status).toBe(200);
    expect(await fx.query(`SELECT status FROM auctions.auctions WHERE listing_id = $1`, [auction])).toEqual([{ status: 'cancelled' }]);
    expect((await events(auction, 'auctions.auction.cancelled'))[0].payload).toMatchObject({ bidderIds: [bidder.userId], by: 'operator' });
    expect((await bidder.call('POST', `/auctions/${auction}/bids`, { maximum: '200000' })).status).not.toBe(201);
  });

  it("FR-SRC-04 FR-TNS-05 I-45 a seller's listings are hidden while they may not list and shown again after, whatever the order of the events", async () => {
    const seller = await member();
    const id = await draft(seller.userId, 'Steel diver watch');
    expect((await seller.call('POST', `/listings/${id}/publish`, {})).status).toBe(200);
    const visible = async () => (await fx.query<{ v: boolean }>(`SELECT seller_visible AS v FROM listings.listings WHERE id = $1`, [id]))[0].v;
    const event = (type: string): OutboxEvent => ({
      outbox: 'identity',
      id: String(randomInt(1, 2 ** 31)),
      type,
      aggregateId: seller.userId,
      payload: { userId: seller.userId },
      createdAt: new Date(),
      attempt: 1,
    });
    const consume = (type: string) =>
      bus
        .consumersOf(type)
        .find((c) => c.name === 'listings.visibility')!
        .handler(event(type));

    await fx.query(`UPDATE identity.users SET account_status = 'suspended' WHERE id = $1`, [seller.userId]);
    await consume('identity.account.suspended');
    expect(await visible()).toBe(false);
    expect((await (await member()).call('GET', `/listings/${id}`)).status).toBe(404); // FR-SRC-04: not shown to buyers
    await consume('identity.kyc.verified'); // a late or unrelated event does not show them while suspended
    expect(await visible()).toBe(false);
    await fx.query(`UPDATE identity.users SET account_status = 'active' WHERE id = $1`, [seller.userId]);
    await consume('identity.account.reinstated');
    expect(await visible()).toBe(true);
    expect(await t.app.get(ListingReviewService).onSellerChanged(event('trust.sanction.lifted'))).toBe(0); // nothing to change
  });

  it("FR-LST-11 a game-account listing is approved only through Unit 5's ownership review", async () => {
    const [op, seller] = [await operator(), await member()];
    const [{ id: games }] = await fx.query<{ id: number }>(
      `INSERT INTO listings.categories (slug, name_en, name_bn, item_kind) VALUES ($1, 'Games', 'গেম', 'game_account') RETURNING id`,
      [`rg-${randomUUID().slice(0, 8)}`],
    );
    const [{ id }] = await fx.query<{ id: string }>(
      `INSERT INTO listings.listings (seller_id, item_kind, sale_format, category_id, title, description, price, quantity_total, quantity_available, status)
       VALUES ($1, 'game_account', 'fixed_price', $2, 'PUBG account, conqueror', 'A conqueror-rank account, written by the review tests.', 300000, 1, 1, 'pending_review') RETURNING id`,
      [seller.userId, games],
    );
    expect(await errors(await op.call('POST', `/staff/listings/${id}/review`, { decision: 'approve', reason: 'Looks fine to me, approving it.' }))).toEqual([
      { field: 'listing', reason: 'use-the-ownership-review' },
    ]);
    expect(await status(id)).toBe('pending_review');
    expect((await op.call('POST', `/staff/listings/${id}/remove`, { reason: 'The account is advertised as stolen.' })).status).toBe(200); // removal works for any item
  });
});
