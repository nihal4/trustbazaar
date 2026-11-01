import { randomInt, randomUUID } from 'crypto';
import { io, Socket } from 'socket.io-client';
import { loadConfig } from '../../src/kernel/config/config';
import { OutboxDispatcher } from '../../src/kernel/events/outbox-dispatcher';
import { AUCTION_ORDERS, AuctionOrders } from '../../src/modules/listings/adapters/orders';
import { AuctionCloser } from '../../src/modules/listings/services/auction-closer.service';
import { SecondChanceService } from '../../src/modules/listings/services/second-chance.service';
import { OrderService } from '../../src/modules/orders/services/order.service';
import { startApp, TestApp } from '../support/app';
import { AuctionOptions, endAuction, openAuction } from '../support/auctions';
import { IdentityFixtures } from '../support/identity';

// U3-05: closing auctions, the winner's order, strikes and second-chance offers, against PostgreSQL and Redis with
// Unit 2's real order service (docs/design/03_listings_auctions.pdf section 5.6; 02_orders_payments.pdf section
// "Auction and second-chance orders"). Jobs are run by hand (JobRunner is off in tests); events are delivered by
// draining the outboxes. Amounts in poisha.

describe('auction close and second chance', () => {
  let t: TestApp;
  let fx: IdentityFixtures;
  let origin: string;
  let category: number;
  let closer: AuctionCloser;
  let secondChance: SecondChanceService;
  let orders: OrderService;
  let dispatcher: OutboxDispatcher;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    process.env.OUTBOX_DISPATCHER = 'off'; // drained by hand, so each step is seen in order
    t = await startApp();
    fx = await IdentityFixtures.open();
    origin = loadConfig(process.env).publicOrigin;
    closer = t.app.get(AuctionCloser);
    secondChance = t.app.get(SecondChanceService);
    orders = t.app.get(OrderService);
    dispatcher = t.app.get(OutboxDispatcher);
    [{ id: category }] = await fx.query<{ id: number }>(
      `INSERT INTO listings.categories (slug, name_en, name_bn, item_kind) VALUES ($1, 'Cameras', 'ক্যামেরা', 'physical') RETURNING id`,
      [`close-${randomUUID().slice(0, 8)}`],
    );
  });
  afterAll(async () => {
    delete process.env.OUTBOX_DISPATCHER;
    for (const s of sockets) s.disconnect();
    await fx?.close();
    await t?.close();
  });

  async function member(o: { kyc?: string } = {}) {
    const userId = await fx.user(o);
    const sid = await fx.session({ userId });
    const ip = `203.0.113.${randomInt(1, 255)}, 198.51.100.${randomInt(1, 255)}`;
    const call = (method: string, path: string, body?: unknown) =>
      fetch(t.url(path), {
        method, redirect: 'manual',
        headers: { ...fx.headers(sid, userId, 'user'), 'x-forwarded-for': ip, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const bid = async (auction: string, maximum: string) => expect((await call('POST', `/auctions/${auction}/bids`, { maximum })).status).toBe(201);
    const status = async (auction: string) => (await (await call('GET', `/auctions/${auction}/my-status`)).json()) as {
      orderId: string | null; secondChanceOffer: { id: string; price: string; expiresAt: string } | null;
    };
    const decide = (auction: string, offerId: string, decision: string) => call('POST', `/auctions/${auction}/second-chance/${offerId}/decision`, { decision });
    return { userId, sid, call, bid, status, decide, cookie: fx.headers(sid, userId, 'user').cookie };
  }
  async function auction(o: AuctionOptions = {}) {
    const seller = await member();
    return { id: await openAuction(fx, seller.userId, category, o), seller };
  }
  const one = async <T = Record<string, unknown>>(sql: string, p: unknown[]) => (await fx.query<T>(sql, p))[0];
  const listing = (id: string) =>
    one<{ status: string; quantity_available: number; quantity_reserved: number; quantity_sold: number }>(
      `SELECT status, quantity_available, quantity_reserved, quantity_sold FROM listings.listings WHERE id = $1`, [id]);
  const events = async (type: string, aggregateId: string) =>
    (await fx.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM auctions.outbox WHERE event_type = $1 AND aggregate_id = $2 ORDER BY id`, [type, aggregateId])).map((e) => e.payload);
  const auctionOrders = (id: string) =>
    fx.query<{ id: string; kind: string; buyer_id: string; item_price: string; status: string }>(
      `SELECT id, kind, buyer_id, item_price::text, status FROM orders.orders WHERE listing_id = $1 ORDER BY created_at`, [id]);
  /** Delivers every pending event; other suites may have left a backlog larger than one pass takes. */
  async function deliver() {
    for (let i = 0; i < 50 && (await dispatcher.drain()).dispatched > 0; i++);
  }
  /** Unit 2's expiry of an unpaid order, as its job would run it once the payment window has passed. */
  async function leaveUnpaid(orderId: string) {
    await fx.query(`UPDATE orders.orders SET payment_due_at = now() - interval '1 minute' WHERE id = $1`, [orderId]);
    expect(await orders.expireUnpaid(orderId)).toBe(true);
    await deliver();
  }
  /** An auction won by Asha (max 150000) over Babu (120000) and Chaya (110000), closed: price 125000. */
  async function won() {
    const a = await auction();
    const [asha, babu, chaya] = [await member(), await member(), await member()];
    await chaya.bid(a.id, '110000');
    await babu.bid(a.id, '120000');
    await asha.bid(a.id, '150000');
    await endAuction(fx, a.id);
    expect(await closer.closeOne(a.id)).toEqual({ auctionId: a.id, status: 'sold', price: '125000' });
    const [order] = await auctionOrders(a.id);
    return { ...a, asha, babu, chaya, order };
  }

  it('FR-AUC-14 a due auction is awarded to the leader with its order in the same transaction; a repeat changes nothing', async () => {
    const a = await auction();
    const [asha, babu, watcher] = [await member(), await member(), await member()];
    await babu.bid(a.id, '120000');
    await asha.bid(a.id, '150000');
    await endAuction(fx, a.id);
    const s = io(new URL(t.url('/')).origin, { path: '/socket.io', transports: ['websocket'], extraHeaders: { cookie: watcher.cookie, origin }, reconnection: false, forceNew: true });
    sockets.push(s);
    await new Promise<void>((resolve) => s.once('connect', () => resolve()));
    expect(await s.emitWithAck('join', { room: `auction:${a.id}` })).toEqual({ ok: true });
    const closedMsg = new Promise((resolve) => s.once('auction.closed', resolve));

    expect(await closer.closeDue()).toBeGreaterThanOrEqual(1);
    expect(await closedMsg).toEqual({ auctionId: a.id, status: 'sold', finalPrice: '125000' });
    const [order] = await auctionOrders(a.id);
    expect(order).toMatchObject({ kind: 'auction', buyer_id: asha.userId, item_price: '125000', status: 'awaiting_payment' });
    expect(await one(`SELECT status, winner_id, final_price::text AS price FROM auctions.auctions WHERE listing_id = $1`, [a.id]))
      .toEqual({ status: 'awarded', winner_id: asha.userId, price: '125000' });
    expect(await listing(a.id)).toMatchObject({ status: 'active', quantity_available: 0, quantity_reserved: 1 });
    expect(await events('auctions.auction.awarded', a.id)).toEqual([
      { auctionId: a.id, listingId: a.id, sellerId: a.seller.userId, winnerId: asha.userId, price: '125000', orderId: order.id },
    ]);
    expect(await one(`SELECT count(*)::int AS n FROM audit.events WHERE action = 'auctions.auction.awarded' AND object_id = $1`, [a.id])).toEqual({ n: 1 });

    // the winner is told their order; the others are not; the public state shows the auction closed
    expect(await asha.status(a.id)).toMatchObject({ orderId: order.id, secondChanceOffer: null });
    expect(await babu.status(a.id)).toMatchObject({ orderId: null, secondChanceOffer: null });
    const state = (await (await watcher.call('GET', `/auctions/${a.id}/state`)).json()) as Record<string, unknown>;
    expect(state).toMatchObject({ status: 'awarded', price: '125000', minimumBid: null });

    expect(await closer.closeOne(a.id)).toBeNull();
    expect(await auctionOrders(a.id)).toHaveLength(1);
  });

  it('FR-AUC-09 an auction without bids, or whose reserve is not met, ends unsold and its listing ended_unsold', async () => {
    const empty = await auction();
    const reserve = await auction({ reserve: '200000' });
    await (await member()).bid(reserve.id, '150000');
    await endAuction(fx, empty.id);
    await endAuction(fx, reserve.id);
    expect(await closer.closeOne(empty.id)).toEqual({ auctionId: empty.id, status: 'unsold', price: null });
    expect(await closer.closeOne(reserve.id)).toEqual({ auctionId: reserve.id, status: 'unsold', price: null });
    for (const [a, reason] of [[empty, 'no_bids'], [reserve, 'reserve_not_met']] as const) {
      expect(await listing(a.id)).toMatchObject({ status: 'ended_unsold', quantity_available: 1, quantity_reserved: 0 });
      expect(await events('auctions.auction.unsold', a.id)).toEqual([{ auctionId: a.id, listingId: a.id, sellerId: a.seller.userId, reason }]);
      expect(await events('listings.listing.ended_unsold', a.id)).toHaveLength(1);
      expect(await auctionOrders(a.id)).toEqual([]);
    }
  });

  it('DV-17 an auction is not closed within the grace after its end, nor while its listing is held for review', async () => {
    const recent = await auction();
    await (await member()).bid(recent.id, '100000');
    await endAuction(fx, recent.id, '500 milliseconds');
    expect(await closer.closeOne(recent.id)).toBeNull();
    expect(await one(`SELECT status FROM auctions.auctions WHERE listing_id = $1`, [recent.id])).toEqual({ status: 'open' });

    const held = await auction();
    await fx.query(`UPDATE listings.listings SET seller_visible = true WHERE id = $1`, [held.id]);
    await fx.query(`UPDATE listings.listings SET status = 'removed' WHERE id = $1`, [held.id]);
    await endAuction(fx, held.id);
    await closer.closeDue();
    expect(await one(`SELECT status FROM auctions.auctions WHERE listing_id = $1`, [held.id])).toEqual({ status: 'open' });
  });

  it('DC-13 when the order cannot be created the award is rolled back and retried on the next run', async () => {
    const a = await auction();
    const asha = await member();
    await asha.bid(a.id, '130000');
    await endAuction(fx, a.id);
    const port = t.app.get<AuctionOrders>(AUCTION_ORDERS);
    const spy = jest.spyOn(port, 'createAuctionOrder').mockRejectedValueOnce(new Error('orders unavailable'));
    try {
      await expect(closer.closeOne(a.id)).rejects.toThrow('orders unavailable');
      expect(await one(`SELECT status, winner_id FROM auctions.auctions WHERE listing_id = $1`, [a.id])).toEqual({ status: 'open', winner_id: null });
      expect(await listing(a.id)).toMatchObject({ quantity_available: 1, quantity_reserved: 0 });
      expect(await events('auctions.auction.awarded', a.id)).toEqual([]);
    } finally {
      spy.mockRestore();
    }
    expect(await closer.closeOne(a.id)).toMatchObject({ status: 'sold', price: '100000' });
    expect(await auctionOrders(a.id)).toHaveLength(1);
  });

  it('FR-AUC-15 an unpaid win: a strike, then offers down the bidders until none is left and the listing ends unsold', async () => {
    const w = await won();
    await leaveUnpaid(w.order.id);
    expect(await one(`SELECT count(*)::int AS n FROM auctions.strikes WHERE user_id = $1 AND order_id = $2`, [w.asha.userId, w.order.id])).toEqual({ n: 1 });

    // Babu is offered the item at his highest bid; only he sees the offer
    const offer = (await w.babu.status(w.id)).secondChanceOffer!;
    expect(offer).toMatchObject({ price: '120000' });
    expect(Date.parse(offer.expiresAt)).toBeGreaterThan(Date.now() + 23 * 3_600_000); // CP-11, 24 hours
    expect((await w.chaya.status(w.id)).secondChanceOffer).toBeNull();
    expect(await events('auctions.offer.made', w.id)).toEqual([expect.objectContaining({ offerId: offer.id, userId: w.babu.userId, price: '120000' })]);

    // a redelivered payment_expired gives no second strike and no second offer
    await secondChance.onPaymentExpired({ aggregateId: w.order.id, payload: { kind: 'auction', listingId: w.id, buyerId: w.asha.userId } });
    expect(await one(`SELECT count(*)::int AS n FROM auctions.second_chance_offers WHERE auction_id = $1`, [w.id])).toEqual({ n: 1 });

    // Babu declines: Chaya is offered at her highest bid; her offer expires: nobody is left
    expect(await (await w.babu.decide(w.id, offer.id, 'decline')).json()).toEqual({ offerId: offer.id, status: 'declined', orderId: null });
    const chayaOffer = (await w.chaya.status(w.id)).secondChanceOffer!;
    expect(chayaOffer).toMatchObject({ price: '110000' });
    await fx.query(`UPDATE auctions.second_chance_offers SET expires_at = now() - interval '1 second' WHERE id = $1`, [chayaOffer.id]);
    expect(await secondChance.expireDue()).toBeGreaterThanOrEqual(1);
    expect(await events('auctions.offer.expired', w.id)).toEqual([{ offerId: chayaOffer.id, auctionId: w.id, userId: w.chaya.userId }]);
    expect(await listing(w.id)).toMatchObject({ status: 'ended_unsold', quantity_available: 1, quantity_reserved: 0 });
    expect(await events('listings.listing.ended_unsold', w.id)).toHaveLength(1);
  });

  it('FR-AUC-15 an accepted offer becomes a second_chance order; unpaid, it is a strike too and the next bidder is offered', async () => {
    const w = await won();
    await leaveUnpaid(w.order.id);
    const offer = (await w.babu.status(w.id)).secondChanceOffer!;
    const r = await w.babu.decide(w.id, offer.id, 'accept');
    expect(r.status).toBe(200);
    const accepted = (await r.json()) as { status: string; orderId: string };
    expect(accepted.status).toBe('accepted');
    const [, second] = await auctionOrders(w.id);
    expect(second).toMatchObject({ id: accepted.orderId, kind: 'second_chance', buyer_id: w.babu.userId, item_price: '120000', status: 'awaiting_payment' });
    expect(await w.babu.status(w.id)).toMatchObject({ orderId: accepted.orderId, secondChanceOffer: null });

    await leaveUnpaid(accepted.orderId);
    expect(await one(`SELECT count(*)::int AS n FROM auctions.strikes WHERE user_id = $1`, [w.babu.userId])).toEqual({ n: 1 }); // Decisions log, U3-05
    expect((await w.chaya.status(w.id)).secondChanceOffer).toMatchObject({ price: '110000' });
  });

  it('FR-AUC-15 only the offered bidder decides, once, while the offer is open, and only if they may buy', async () => {
    const w = await won();
    await leaveUnpaid(w.order.id);
    const offer = (await w.babu.status(w.id)).secondChanceOffer!;
    expect((await w.chaya.decide(w.id, offer.id, 'accept')).status).toBe(404);
    expect((await w.babu.decide(w.id, randomUUID(), 'accept')).status).toBe(404);
    expect((await w.babu.decide(w.id, 'not-a-uuid', 'accept')).status).toBe(404);
    expect((await w.babu.decide(w.id, offer.id, 'maybe')).status).toBe(400);
    await fx.query(`UPDATE identity.users SET account_status = 'suspended' WHERE id = $1`, [w.babu.userId]);
    expect((await w.babu.decide(w.id, offer.id, 'accept')).status).toBe(403);
    await fx.query(`UPDATE identity.users SET account_status = 'active' WHERE id = $1`, [w.babu.userId]);
    await fx.query(`UPDATE auctions.second_chance_offers SET expires_at = now() - interval '1 second' WHERE id = $1`, [offer.id]);
    const late = await w.babu.decide(w.id, offer.id, 'accept');
    expect(late.status).toBe(409);
    expect((await late.json()).type).toBe('/problems/offer-closed');
    expect(await auctionOrders(w.id)).toHaveLength(1);
  });

  it('FR-AUC-16 a second unpaid win within CP-12 restricts bidding, the bidder is told, and their next bid is refused', async () => {
    const first = await won();
    await leaveUnpaid(first.order.id);
    const second = await auction();
    await first.asha.bid(second.id, '130000');
    await endAuction(fx, second.id);
    await closer.closeOne(second.id);
    const [order] = await auctionOrders(second.id);
    await leaveUnpaid(order.id);
    expect(await events('auctions.bidder.restricted', second.id)).toEqual([
      expect.objectContaining({ userId: first.asha.userId, reason: 'non_payment_strikes' }),
    ]);
    // nobody else bid on the second auction: it ends unsold
    expect(await listing(second.id)).toMatchObject({ status: 'ended_unsold', quantity_available: 1 });
    const third = await auction();
    const r = await first.asha.call('POST', `/auctions/${third.id}/bids`, { maximum: '100000' });
    expect(r.status).toBe(422);
    expect((await r.json()).errors[0].reason).toBe('bidder_restricted');
  });

  it('I-14 when the winner pays, the held unit is sold and the listing is sold', async () => {
    const w = await won();
    expect((await w.asha.call('PUT', `/orders/${w.order.id}/fulfilment`, { fulfilment: 'self_pickup' })).status).toBe(200);
    const start = await w.asha.call('POST', `/orders/${w.order.id}/payments`, { provider: 'bkash' });
    expect(start.status).toBe(201);
    const page = new URL(((await start.json()) as { redirectUrl: string }).redirectUrl);
    const form = await fetch(t.url(page.pathname.replace('/api/v1', '') + page.search), {
      method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'outcome=succeeded',
    });
    const cb = new URL(form.headers.get('location')!);
    expect((await fetch(t.url(cb.pathname.replace('/api/v1', '') + cb.search), { redirect: 'manual' })).status).toBe(303);
    await deliver();
    expect(await listing(w.id)).toEqual({ status: 'sold', quantity_available: 0, quantity_reserved: 0, quantity_sold: 1 });
    expect(await events('listings.listing.sold', w.id)).toHaveLength(1);
  });
});
