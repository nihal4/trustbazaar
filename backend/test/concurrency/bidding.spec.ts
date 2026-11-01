import { randomInt, randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { OutboxDispatcher } from '../../src/kernel/events/outbox-dispatcher';
import { LISTINGS_PORT, ListingsPort } from '../../src/modules/listings/ports';
import { AuctionCloser } from '../../src/modules/listings/services/auction-closer.service';
import { SecondChanceService } from '../../src/modules/listings/services/second-chance.service';
import { StockService } from '../../src/modules/listings/services/stock.service';
import { OrderService } from '../../src/modules/orders/services/order.service';
import { startApp, TestApp } from '../support/app';
import { endAuction, openAuction, type AuctionOptions } from '../support/auctions';
import { IdentityFixtures } from '../support/identity';

// U3-07: Unit 3 under real concurrency (SRS Appendix A: AC-1, AC-2; NFR-MNT-02, NFR-PERF-08; docs/design/
// 03_listings_auctions.pdf sections 5.2 to 5.6 and Appendix B), against PostgreSQL and Redis through the HTTP API
// and the services. Every race is started at once (Promise.all, small random delays so that lock order differs
// from arrival order); the assertions are on what the database holds afterwards, checked against the database's
// own serial replay of the bids (auctions.replay), as Appendix B does.
describe('Auction concurrency (FR-AUC-01–FR-AUC-18, NFR-MNT-02)', () => {
  let t: TestApp;
  let fx: IdentityFixtures;
  let db: DataSource;
  let category: number;

  beforeAll(async () => {
    process.env.OUTBOX_DISPATCHER = 'off'; // drained by hand
    t = await startApp();
    fx = await IdentityFixtures.open();
    db = t.app.get(DataSource);
    [{ id: category }] = await fx.query<{ id: number }>(
      `INSERT INTO listings.categories (slug, name_en, name_bn, item_kind) VALUES ($1, 'Race', 'দৌড়', 'physical') RETURNING id`,
      [`bid-race-${randomUUID().slice(0, 8)}`],
    );
  });
  afterAll(async () => {
    delete process.env.OUTBOX_DISPATCHER;
    await fx?.close();
    await t?.close();
  });

  type Who = Awaited<ReturnType<typeof member>>;
  async function member() {
    const userId = await fx.user();
    const sid = await fx.session({ userId });
    const ip = `203.0.113.${randomInt(1, 255)}, 10.7.${randomInt(0, 255)}.${randomInt(1, 255)}`;
    const call = (method: string, path: string, body?: unknown, extra: Record<string, string> = {}) =>
      fetch(t.url(path), {
        method,
        headers: { ...fx.headers(sid, userId, 'user'), 'x-forwarded-for': ip, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...extra },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const bid = async (auction: string, maximum: string, key?: string) => {
      const r = await call('POST', `/auctions/${auction}/bids`, { maximum }, key ? { 'idempotency-key': key } : {});
      const body = (await r.json()) as { bidId?: string; type?: string; errors?: { reason: string }[] };
      return { status: r.status, body };
    };
    return { userId, call, bid };
  }
  const auction = async (o: AuctionOptions = {}) => openAuction(fx, (await member()).userId, category, o);
  const people = (n: number) => Promise.all(Array.from({ length: n }, () => member()));
  const jitter = (ms = 25) => new Promise((r) => setTimeout(r, randomInt(0, ms)));
  const one = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await fx.query<T>(sql, p))[0];

  /** Every answer is a decision: placed (201), refused with a reason (422), or "try again" (409, DV-18). */
  function expectAnswered(results: { status: number; body: { type?: string } }[]) {
    for (const r of results) {
      expect([201, 422, 409]).toContain(r.status);
      if (r.status === 409) expect(r.body.type).toBe('/problems/auction-busy');
      if (r.status === 422) expect(r.body.type).toBe('/problems/bid-refused');
    }
  }

  /**
   * NFR-PERF-08 and Appendix B: after the race, every recorded decision equals the serial replay in bid-id order; the
   * price never decreased; the leader holds the highest maximum (ties to the earlier); the price never exceeds the
   * leader's maximum; final price = min(top maximum, second-highest maximum + increment); the row agrees.
   */
  async function expectConsistent(auctionId: string) {
    const bids = await fx.query<{ id: string; bidder_id: string; max_amount: string; outcome: string; price_after: string; leader_after: string }>(
      `SELECT id::text, bidder_id, max_amount::text, outcome, price_after::text, leader_after FROM auctions.bids
        WHERE auction_id = $1 AND voided_at IS NULL ORDER BY id`, [auctionId]);
    const replay = await fx.query<{ bid_id: string; leader: string; leader_max: string; price: string; is_leading: boolean; counted: boolean }>(
      `SELECT r.bid_id::text, r.leader, r.leader_max::text, r.price::text, r.is_leading, r.counted FROM auctions.replay($1) r ORDER BY r.bid_id`, [auctionId]);
    expect(replay.map((r) => [r.bid_id, r.counted, r.leader, r.price, r.is_leading]))
      .toEqual(bids.map((b) => [b.id, true, b.leader_after, b.price_after, b.outcome !== 'outbid']));
    for (let i = 1; i < bids.length; i++) expect(BigInt(bids[i].price_after)).toBeGreaterThanOrEqual(BigInt(bids[i - 1].price_after));

    const a = await one<{ leader_id: string; leader_max: string; current_price: string; bid_count: number; start_price: string; inc_bps: number; inc_min: string }>(
      `SELECT leader_id, leader_max::text, current_price::text, bid_count, start_price::text, inc_bps, inc_min::text FROM auctions.auctions WHERE listing_id = $1`, [auctionId]);
    const last = bids[bids.length - 1];
    expect([a.leader_id, a.current_price, a.bid_count]).toEqual([last.leader_after, last.price_after, bids.length]);
    expect(BigInt(a.current_price)).toBeLessThanOrEqual(BigInt(a.leader_max));

    const top = bids.reduce((m, b) => (BigInt(b.max_amount) > m ? BigInt(b.max_amount) : m), 0n);
    const first = bids.find((b) => BigInt(b.max_amount) === top)!;
    expect(a.leader_id).toBe(first.bidder_id); // equal maximums: the earlier one leads
    expect(BigInt(a.leader_max)).toBe(top);
    const others = bids.filter((b) => b.bidder_id !== a.leader_id).map((b) => BigInt(b.max_amount));
    if (others.length === 0) {
      expect(a.current_price).toBe(a.start_price);
    } else {
      const second = others.reduce((m, x) => (x > m ? x : m), 0n);
      const [{ inc }] = await fx.query<{ inc: string }>(`SELECT auctions.increment($1, $2, $3)::text AS inc`, [String(second), a.inc_bps, a.inc_min]);
      const expected = top < second + BigInt(inc) ? top : second + BigInt(inc);
      expect(BigInt(a.current_price)).toBe(expected);
    }
    return { bids, auction: a };
  }

  it('AC-1 thirty bidders sending ten rising bids each at once: one leader, every decision equal to the serial replay, none lost', async () => {
    const id = await auction();
    const bidders = await people(30);
    // as in Appendix B: every bidder raises their own bid ten times, all bidders at once
    const results = (await Promise.all(bidders.map(async (b, i) => {
      const mine: ({ who: string } & Awaited<ReturnType<Who["bid"]>>)[] = [];
      for (let k = 0; k < 10; k++) {
        await jitter();
        mine.push({ who: b.userId, ...(await b.bid(id, String(100000 + (k * 30 + i) * 5000))) });
      }
      return mine;
    }))).flat();
    expectAnswered(results);
    const { bids } = await expectConsistent(id);
    const placed = results.filter((r) => r.status === 201);
    expect(placed.length).toBe(bids.length);
    expect(new Set(placed.map((r) => r.body.bidId))).toEqual(new Set(bids.map((b) => b.id)));
    expect(placed.length).toBeGreaterThan(20);
    // lock order may differ from arrival order; the bid id records the order decided, which the replay follows
    const leaders = await one<{ n: number }>(`SELECT count(DISTINCT leader_id)::int AS n FROM auctions.auctions WHERE listing_id = $1`, [id]);
    expect(leaders.n).toBe(1);
  }, 120_000);

  it('NFR-MNT-02 a bid placed inside the anti-sniping window extends end_time by the configured amount exactly once, even under concurrent bids', async () => {
    const id = await auction({ endsIn: '30 seconds', window: '2 minutes', extension: '1 minute' });
    const bidders = await people(20);
    const results = await Promise.all(bidders.map(async (b, i) => {
      await jitter(50);
      return b.bid(id, String(100000 + i * 10000));
    }));
    expectAnswered(results);
    await expectConsistent(id);
    const rows = await fx.query<{ received_at: Date; extended_to: Date }>(
      `SELECT received_at, extended_to FROM auctions.bids WHERE auction_id = $1 ORDER BY id`, [id]);
    expect(rows.length).toBeGreaterThan(0);
    for (let i = 0; i < rows.length; i++) {
      // each accepted bid in the window moved the end to at least its own receipt plus the extension, never earlier
      expect(rows[i].extended_to.getTime()).toBeGreaterThanOrEqual(rows[i].received_at.getTime() + 60_000);
      if (i > 0) expect(rows[i].extended_to.getTime()).toBeGreaterThanOrEqual(rows[i - 1].extended_to.getTime());
    }
    const { end_at } = await one<{ end_at: Date }>(`SELECT end_at FROM auctions.auctions WHERE listing_id = $1`, [id]);
    const latest = Math.max(...rows.map((r) => r.received_at.getTime()));
    expect(end_at.getTime()).toBe(latest + 60_000);
    expect(end_at.getTime()).toBe(Math.max(...rows.map((r) => r.extended_to.getTime())));
  }, 60_000);

  it('NFR-MNT-02 proxy bidding automatically outbids a competing bidder up to (but not past) the proxy_max set by the original bidder', async () => {
    const id = await auction();
    const [proxy, ...rivals] = await people(16);
    expect((await proxy.bid(id, '400000')).status).toBe(201);
    const results = await Promise.all(rivals.map(async (r, i) => {
      await jitter();
      return r.bid(id, String(150000 + i * 20000)); // up to 450000: some below the proxy's maximum, some above
    }));
    expectAnswered(results);
    const { bids, auction: a } = await expectConsistent(id);
    // while the proxy led, its answers never went past its maximum
    for (const b of bids.filter((x) => x.leader_after === proxy.userId)) expect(BigInt(b.price_after)).toBeLessThanOrEqual(400000n);
    const above = bids.filter((b) => b.bidder_id !== proxy.userId && BigInt(b.max_amount) > 400000n);
    if (above.length > 0) expect(a.leader_id).not.toBe(proxy.userId);
    else expect(a.leader_id).toBe(proxy.userId);
  }, 60_000);

  it('AC-1 bids arriving across the end while three closers run: one award, one order, no bid accepted after the end', async () => {
    const id = await auction({ endsIn: '1500 milliseconds', window: '1 millisecond', extension: '1 millisecond' });
    const closer = t.app.get(AuctionCloser);
    const bidders = await people(20);
    let running = true;
    const closers = Array.from({ length: 3 }, async () => {
      while (running) {
        await closer.closeOne(id).catch(() => null);
        await new Promise((r) => setTimeout(r, 100));
      }
    });
    const results = await Promise.all(bidders.flatMap((b, i) => [0, 1, 2].map(async (k) => {
      await new Promise((r) => setTimeout(r, randomInt(0, 2600)));
      return b.bid(id, String(100000 + (k * 20 + i) * 5000));
    })));
    await new Promise((r) => setTimeout(r, 4500)); // past end_at + DV-17 for the last possible extension
    running = false;
    await Promise.all(closers);

    for (const r of results) {
      expect([201, 422, 409]).toContain(r.status);
      if (r.status === 422) expect(['below_minimum', 'max_not_higher', 'auction_ended', 'auction_not_open']).toContain(r.body.errors?.[0]?.reason);
    }
    const a = await one<{ status: string; winner_id: string | null; final_price: string | null; end_at: Date; closed_at: Date }>(
      `SELECT status, winner_id, final_price::text, end_at, closed_at FROM auctions.auctions WHERE listing_id = $1`, [id]);
    const bids = await fx.query<{ received_at: Date; leader_after: string; price_after: string }>(
      `SELECT received_at, leader_after, price_after::text FROM auctions.bids WHERE auction_id = $1 ORDER BY id`, [id]);
    expect(bids.length).toBeGreaterThan(0);
    expect(a.status).toBe('awarded');
    for (const b of bids) expect(b.received_at.getTime()).toBeLessThan(a.end_at.getTime());
    expect(a.closed_at.getTime()).toBeGreaterThanOrEqual(a.end_at.getTime() + 2000);
    const last = bids[bids.length - 1];
    expect([a.winner_id, a.final_price]).toEqual([last.leader_after, last.price_after]);
    const orders = await fx.query<{ buyer_id: string; item_price: string }>(`SELECT buyer_id, item_price::text FROM orders.orders WHERE listing_id = $1`, [id]);
    expect(orders).toEqual([{ buyer_id: a.winner_id, item_price: a.final_price }]);
    await expectConsistent(id);
  }, 60_000);

  it('I-53 ten identical bids with one Idempotency-Key at once place exactly one bid', async () => {
    const id = await auction();
    const b = await member();
    const key = `race-${randomUUID()}`;
    const results = await Promise.all(Array.from({ length: 10 }, () => b.bid(id, '150000', key)));
    expect((await one<{ n: number }>(`SELECT count(*)::int AS n FROM auctions.bids WHERE auction_id = $1`, [id])).n).toBe(1);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    for (const r of results) {
      expect([201, 200, 409]).toContain(r.status);
      if (r.status === 409) expect(r.body.type).toBe('/problems/request-in-progress');
    }
  }, 30_000);

  it('AC-2 fifty transactions reserving the last two units at once through the stock port: exactly two', async () => {
    const seller = await member();
    const [{ id }] = await fx.query<{ id: string }>(
      `INSERT INTO listings.listings (seller_id, item_kind, sale_format, category_id, title, description, condition, no_visible_defects,
          fulfilment_options, area_district, approx_lat, approx_lng, price, quantity_total, quantity_available)
       VALUES ($1, 'physical', 'fixed_price', $2, 'Last two lamps', 'Two lamps in good condition, for the race test.', 'used', true,
               'pickup_only', 'Dhaka', 23.81, 90.41, 100000, 2, 2) RETURNING id`, [seller.userId, category]);
    for (const n of [1, 2]) await fx.query(`INSERT INTO listings.listing_photos (listing_id, position, storage_key, width, height) VALUES ($1, $2, $3, 800, 600)`, [id, n, randomUUID().replace(/-/g, '')]);
    await fx.query(`UPDATE listings.listings SET status = 'active', published_at = now() WHERE id = $1`, [id]);
    const port = t.app.get<ListingsPort>(LISTINGS_PORT);
    const granted = await Promise.all(Array.from({ length: 50 }, async () => {
      await jitter(10);
      return db.transaction((m) => port.reserve(id, 1, m));
    }));
    expect(granted.filter(Boolean)).toHaveLength(2);
    expect(await one(`SELECT quantity_available, quantity_reserved, quantity_sold FROM listings.listings WHERE id = $1`, [id]))
      .toEqual({ quantity_available: 0, quantity_reserved: 2, quantity_sold: 0 });

    // the paid and cancelled events of two orders, each delivered ten times at once: each unit moves exactly once
    const stock = t.app.get(StockService);
    const [sold, released] = [randomUUID(), randomUUID()];
    await Promise.all([
      ...Array.from({ length: 10 }, () => stock.onOrder({ aggregateId: sold, payload: { listingId: id, quantity: 1 } }, 'sold')),
      ...Array.from({ length: 10 }, () => stock.onOrder({ aggregateId: released, payload: { listingId: id, quantity: 1 } }, 'released')),
    ]);
    expect(await one(`SELECT quantity_available, quantity_reserved, quantity_sold, status FROM listings.listings WHERE id = $1`, [id]))
      .toEqual({ quantity_available: 1, quantity_reserved: 0, quantity_sold: 1, status: 'active' });
    expect((await one<{ n: number }>(`SELECT count(*)::int AS n FROM listings.stock_moves WHERE listing_id = $1`, [id])).n).toBe(2);
  }, 30_000);

  /** An auction won by the first of three bidders, its order left unpaid: the second is offered the item. */
  async function offered() {
    const id = await auction();
    const [winner, second, third] = await people(3);
    for (const [who, max] of [[third, '110000'], [second, '120000'], [winner, '150000']] as [Who, string][]) expect((await who.bid(id, max)).status).toBe(201);
    await endAuction(fx, id);
    await t.app.get(AuctionCloser).closeOne(id);
    const { id: orderId } = await one<{ id: string }>(`SELECT id FROM orders.orders WHERE listing_id = $1`, [id]);
    await fx.query(`UPDATE orders.orders SET payment_due_at = now() - interval '1 minute' WHERE id = $1`, [orderId]);
    expect(await t.app.get(OrderService).expireUnpaid(orderId)).toBe(true);
    // deliver orders.order.payment_expired (and anything queued before it) until the offer exists
    const dispatcher = t.app.get(OutboxDispatcher);
    const find = () => one<{ id: string }>(`SELECT id FROM auctions.second_chance_offers WHERE auction_id = $1 AND bidder_id = $2`, [id, second.userId]);
    let offer = await find();
    for (let i = 0; i < 100 && !offer; i++) {
      if ((await dispatcher.drain()).dispatched === 0) await new Promise((r) => setTimeout(r, 50));
      offer = await find();
    }
    if (!offer) {
      // say what the outbox held, so a failure here explains itself
      const pending = await fx.query(`SELECT event_type, attempts, dispatched_at, next_attempt_at FROM orders.outbox WHERE aggregate_id = $1`, [orderId]);
      expect({ offer: null, pending }).toEqual({ offer: 'made' });
    }
    return { id, second, third, offerId: offer.id };
  }

  it('FR-AUC-15 accepting and declining one offer at the same moment: exactly one outcome, at most one open offer and one live order', async () => {
    const o = await offered();
    const results = await Promise.all(Array.from({ length: 10 }, async (_, i) => {
      await jitter(10);
      const r = await o.second.call('POST', `/auctions/${o.id}/second-chance/${o.offerId}/decision`, { decision: i % 2 ? 'accept' : 'decline' });
      return { status: r.status, body: (await r.json()) as { status?: string; type?: string } };
    }));
    const decided = results.filter((r) => r.status === 200);
    expect(decided).toHaveLength(1);
    for (const r of results.filter((x) => x.status !== 200)) expect([r.status, r.body.type]).toEqual([409, '/problems/offer-closed']);
    const { status } = await one<{ status: string }>(`SELECT status FROM auctions.second_chance_offers WHERE id = $1`, [o.offerId]);
    const live = await one<{ n: number }>(`SELECT count(*)::int AS n FROM orders.orders WHERE listing_id = $1 AND status <> 'cancelled'`, [o.id]);
    const open = await one<{ n: number }>(`SELECT count(*)::int AS n FROM auctions.second_chance_offers WHERE auction_id = $1 AND status = 'offered'`, [o.id]);
    if (decided[0].body.status === 'accepted') {
      expect([status, live.n, open.n]).toEqual(['accepted', 1, 0]);
    } else {
      expect([status, live.n, open.n]).toEqual(['declined', 0, 1]); // passed to the third bidder
    }
  }, 60_000);

  it('FR-AUC-15 an offer expiring while it is accepted and five expiry jobs run: one outcome, one next offer', async () => {
    const o = await offered();
    await fx.query(`UPDATE auctions.second_chance_offers SET expires_at = now() - interval '1 second' WHERE id = $1`, [o.offerId]);
    const jobs = t.app.get(SecondChanceService);
    const [accept] = await Promise.all([
      o.second.call('POST', `/auctions/${o.id}/second-chance/${o.offerId}/decision`, { decision: 'accept' }),
      ...Array.from({ length: 5 }, () => jobs.expireDue()),
    ]);
    expect(accept.status).toBe(409); // expired on the database clock: never accepted late
    expect((await one<{ status: string }>(`SELECT status FROM auctions.second_chance_offers WHERE id = $1`, [o.offerId])).status).toBe('expired');
    const next = await fx.query<{ bidder_id: string }>(`SELECT bidder_id FROM auctions.second_chance_offers WHERE auction_id = $1 AND status = 'offered'`, [o.id]);
    expect(next).toEqual([{ bidder_id: o.third.userId }]);
    expect((await one<{ n: number }>(`SELECT count(*)::int AS n FROM auctions.outbox WHERE event_type = 'auctions.offer.expired' AND payload->>'offerId' = $1`, [o.offerId])).n).toBe(1);
  }, 60_000);
});

// The fixed-price, webhook and settlement placeholders that were here are real tests now, in orders.spec.ts and
// webhooks.spec.ts (U2-08).
