import { randomInt, randomUUID } from 'crypto';
import { Client } from 'pg';
import { io, Socket } from 'socket.io-client';
import { loadConfig } from '../../src/kernel/config/config';
import { startApp, TestApp } from '../support/app';
import { IdentityFixtures } from '../support/identity';

// U3-04: the bid engine over HTTP against PostgreSQL and Redis, through the security pipeline
// (docs/design/03_listings_auctions.pdf sections 3.1, 3.2, 5.2 to 5.4): the worked example, anti-sniping, the
// end of an auction, refusals, idempotency, the rate limit, hidden data and the live messages.
// Amounts in poisha; CP-08 here is 2 % with at least BDT 50 (5000), as in the design's worked example.

describe('auctions', () => {
  let t: TestApp;
  let fx: IdentityFixtures;
  let origin: string;
  let category: number;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    t = await startApp();
    fx = await IdentityFixtures.open();
    origin = loadConfig(process.env).publicOrigin;
    [{ id: category }] = await fx.query<{ id: number }>(
      `INSERT INTO listings.categories (slug, name_en, name_bn, item_kind) VALUES ($1, 'Cameras', 'ক্যামেরা', 'physical') RETURNING id`,
      [`cameras-${randomUUID().slice(0, 8)}`],
    );
  });
  afterAll(async () => {
    for (const s of sockets) s.disconnect();
    await fx?.close();
    await t?.close();
  });

  type Who = Awaited<ReturnType<typeof member>>;
  async function member(o: { kyc?: string; emailVerified?: boolean } = {}) {
    const userId = await fx.user(o);
    const sid = await fx.session({ userId });
    const ip = `203.0.113.${randomInt(1, 255)}, 198.51.100.${randomInt(1, 255)}`;
    const headers = () => ({ ...fx.headers(sid, userId, 'user'), 'x-forwarded-for': ip });
    const call = (method: string, path: string, body?: unknown, extra: Record<string, string> = {}) =>
      fetch(t.url(path), {
        method,
        headers: { ...headers(), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...extra },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const bid = (auction: string, maximum: string, key?: string) =>
      call('POST', `/auctions/${auction}/bids`, { maximum }, key ? { 'idempotency-key': key } : {});
    return { userId, sid, call, bid, cookie: fx.headers(sid, userId, 'user').cookie };
  }
  const guest = (method: string, path: string, body?: unknown) =>
    fetch(t.url(path), {
      method,
      headers: { origin, 'x-forwarded-for': `192.0.2.${randomInt(1, 255)}, 10.3.${randomInt(0, 255)}.${randomInt(1, 255)}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  /** An active auction listing, open since a minute ago unless said otherwise. */
  async function auction(o: { start?: string; reserve?: string; endsIn?: string; startedAgo?: string; window?: string; extension?: string } = {}) {
    const seller = await member();
    const [{ id }] = await fx.query<{ id: string }>(
      `INSERT INTO listings.listings (seller_id, item_kind, sale_format, category_id, title, description, condition, no_visible_defects,
                                      fulfilment_options, area_district, approx_lat, approx_lng, status, published_at)
       VALUES ($1, 'physical', 'auction', $2, 'Old film camera', 'A working film camera with its leather case.', 'used', true,
               'pickup_only', 'Dhaka', 23.81, 90.41, 'draft', null) RETURNING id`,
      [seller.userId, category],
    );
    // published as the database allows it: two photos first (listings.check_publishable)
    for (const position of [1, 2]) {
      await fx.query(
        `INSERT INTO listings.listing_photos (listing_id, position, storage_key, width, height) VALUES ($1, $2, $3, 800, 600)`,
        [id, position, randomUUID().replace(/-/g, '')],
      );
    }
    await fx.query(`UPDATE listings.listings SET status = 'active', published_at = now() WHERE id = $1`, [id]);
    await fx.query(
      `INSERT INTO auctions.auctions (listing_id, seller_id, start_price, reserve_price, inc_bps, inc_min, snipe_window, snipe_extension,
                                      starts_at, original_end_at, end_at)
       VALUES ($1, $2, $3, $4, 200, 5000, $5::interval, $6::interval, now() - $7::interval, now() + $8::interval, now() + $8::interval)`,
      [id, seller.userId, o.start ?? '100000', o.reserve ?? null, o.window ?? '2 minutes', o.extension ?? '2 minutes', o.startedAgo ?? '1 minute', o.endsIn ?? '1 day'],
    );
    return { id, seller };
  }
  const state = async (id: string) => (await (await guest('GET', `/auctions/${id}/state`)).json()) as Record<string, unknown>;
  const refusal = async (r: Response) => {
    const body = (await r.json()) as { type: string; errors?: { reason: string; minimum?: string; until?: string }[] };
    return { status: r.status, type: body.type, ...(body.errors?.[0] ?? {}) };
  };

  function connect(cookie: string): Promise<Socket> {
    const s = io(new URL(t.url('/')).origin, { path: '/socket.io', transports: ['websocket'], extraHeaders: { cookie, origin }, reconnection: false, forceNew: true });
    sockets.push(s);
    return new Promise((resolve, reject) => {
      s.once('connect', () => resolve(s));
      s.once('connect_error', reject);
    });
  }
  const next = (s: Socket, event: string, ms = 1500) =>
    new Promise<unknown>((resolve) => {
      const timer = setTimeout(() => resolve('none'), ms);
      s.once(event, (p: unknown) => {
        clearTimeout(timer);
        resolve(p);
      });
    });

  it('FR-AUC-06 the worked example: proxy answers, the tie to the earlier maximum, raising one\'s own maximum', async () => {
    const { id } = await auction();
    const [asha, babu, chaya] = [await member(), await member(), await member()];
    const placed = async (u: Who, max: string) => {
      const r = await u.bid(id, max);
      expect(r.status).toBe(201);
      return (await r.json()) as { outcome: string; yourMaximum: string; state: Record<string, unknown> };
    };

    expect(await placed(asha, '150000')).toMatchObject({ outcome: 'leading', yourMaximum: '150000', state: { price: '100000', leaderAlias: 1, bidCount: 1, minimumBid: '105000' } });
    expect(await refusal(await babu.bid(id, '104900'))).toEqual({ status: 422, type: '/problems/bid-refused', field: 'maximum', reason: 'below_minimum', minimum: '105000' });
    expect(await placed(babu, '120000')).toMatchObject({ outcome: 'outbid', state: { price: '125000', leaderAlias: 1 } });
    expect(await placed(babu, '150000')).toMatchObject({ outcome: 'outbid', state: { price: '150000', leaderAlias: 1 } });
    expect(await placed(chaya, '200000')).toMatchObject({ outcome: 'leading', state: { price: '155000', leaderAlias: 3 } });
    const raised = await placed(chaya, '250000');
    expect(raised).toMatchObject({ outcome: 'raised_own_max', yourMaximum: '250000', state: { price: '155000', bidCount: 5 } });

    // FR-AUC-13: aliases and the amounts shown, newest first; the leader's maximum never appears
    const history = (await (await guest('GET', `/auctions/${id}/bids`)).json()) as { items: Record<string, unknown>[] };
    expect(history.items.map((b) => [b.bidderAlias, b.amount, b.leading])).toEqual([
      [3, '155000', true], [3, '155000', true], [2, '150000', false], [2, '120000', false], [1, '100000', true],
    ]);
    const s = await state(id);
    expect(s).toMatchObject({ status: 'open', price: '155000', bidCount: 5, leaderAlias: 3, minimumBid: '160000', hasReserve: false, reserveMet: true });
    expect(s.seq).toBe((raised.state.seq as number));
    const shown = JSON.stringify([history, s]);
    for (const hidden of ['200000', '250000', asha.userId, babu.userId, chaya.userId]) expect(shown).not.toContain(hidden);
  });

  it('FR-AUC-08 my-status shows a bidder their own maximum and lead, and nobody else\'s', async () => {
    const { id } = await auction();
    const [asha, babu] = [await member(), await member()];
    expect((await asha.bid(id, '180000')).status).toBe(201);
    expect(await (await asha.call('GET', `/auctions/${id}/my-status`)).json()).toEqual({ hasBid: true, yourMaximum: '180000', leading: true, yourAlias: 1 });
    expect(await (await babu.call('GET', `/auctions/${id}/my-status`)).json()).toEqual({ hasBid: false, yourMaximum: null, leading: false, yourAlias: null });
    expect((await guest('GET', `/auctions/${id}/my-status`)).status).toBe(401);
  });

  it('FR-AUC-09 the price rises to the reserve once the leader\'s maximum reaches it; the reserve itself is never shown', async () => {
    const { id } = await auction({ reserve: '140000' });
    const [asha, babu] = [await member(), await member()];
    expect((await asha.bid(id, '130000')).status).toBe(201);
    expect(await state(id)).toMatchObject({ price: '100000', hasReserve: true, reserveMet: false });
    expect((await babu.bid(id, '160000')).status).toBe(201);
    const s = await state(id);
    expect(s).toMatchObject({ price: '140000', hasReserve: true, reserveMet: true, leaderAlias: 2 });
    expect(s).not.toHaveProperty('reservePrice');
    const page = (await (await guest('GET', `/listings/${id}`)).json()) as { auction: Record<string, unknown> };
    expect(page.auction).toMatchObject({ price: '140000', currentPrice: '140000', reserveMet: true, seq: s.seq, minimumBid: s.minimumBid });
    expect(page.auction).not.toHaveProperty('reservePrice');
  });

  it('FR-AUC-05 a bid inside the window extends the end to receipt plus the extension; one outside does not', async () => {
    const early = await auction({ endsIn: '1 hour', window: '2 minutes', extension: '3 minutes' });
    const before = Date.parse((await state(early.id)).endAt as string);
    expect((await (await member()).bid(early.id, '100000')).status).toBe(201);
    expect(Date.parse((await state(early.id)).endAt as string)).toBe(before);

    const late = await auction({ endsIn: '30 seconds', window: '2 minutes', extension: '3 minutes' });
    const u = await member();
    const r = (await (await u.bid(late.id, '100000')).json()) as { state: { endAt: string; serverTime: string } };
    const [{ received }] = await fx.query<{ received: Date }>(`SELECT received_at AS received FROM auctions.bids WHERE auction_id = $1`, [late.id]);
    expect(Date.parse(r.state.endAt)).toBe(received.getTime() + 3 * 60_000);
    const [{ extended }] = await fx.query<{ extended: Date }>(`SELECT extended_to AS extended FROM auctions.bids WHERE auction_id = $1`, [late.id]);
    expect(extended.getTime()).toBe(Date.parse(r.state.endAt));
  });

  it('FR-AUC-04 a bid received after the end is refused: auction_ended', async () => {
    const { id } = await auction({ startedAgo: '2 hours', endsIn: '-1 minute' });
    expect(await refusal(await (await member()).bid(id, '100000'))).toMatchObject({ status: 422, reason: 'auction_ended' });
    expect((await state(id)).bidCount).toBe(0);
  });

  it('FR-AUC-02 refusals keep stable codes: the seller, a lower own maximum, a restricted bidder, a closed auction', async () => {
    const { id, seller } = await auction();
    expect(await refusal(await seller.bid(id, '200000'))).toMatchObject({ status: 422, reason: 'seller_cannot_bid' });

    const asha = await member();
    expect((await asha.bid(id, '150000')).status).toBe(201);
    expect(await refusal(await asha.bid(id, '150000'))).toMatchObject({ status: 422, reason: 'max_not_higher' });

    const struck = await member();
    await fx.query(`INSERT INTO auctions.bidding_restrictions (user_id, until, reason) VALUES ($1, now() + interval '7 days', 'test strikes')`, [struck.userId]);
    const r = await refusal(await struck.bid(id, '300000'));
    expect(r).toMatchObject({ status: 422, reason: 'bidder_restricted' });
    expect(Date.parse(r.until!)).toBeGreaterThan(Date.now() + 6 * 86_400_000);

    await fx.query(`UPDATE auctions.auctions SET status = 'cancelled', closed_at = now() WHERE listing_id = $1`, [id]);
    expect(await refusal(await (await member()).bid(id, '300000'))).toMatchObject({ status: 422, reason: 'auction_not_open' });
    expect((await state(id)).minimumBid).toBeNull();
  });

  it('FR-AUC-02 only verified, signed-in users may bid; bad amounts and unknown or hidden auctions are refused', async () => {
    const { id, seller } = await auction();
    expect((await guest('POST', `/auctions/${id}/bids`, { maximum: '100000' })).status).toBe(401);
    expect((await (await member({ kyc: 'pending_review' })).bid(id, '100000')).status).toBe(403);
    expect((await (await member({ emailVerified: false })).bid(id, '100000')).status).toBe(403);

    const u = await member();
    for (const maximum of ['0', '12.5', '-100', '১০০০০০', 'abc', '99999999999999999']) expect((await u.bid(id, maximum)).status).toBe(400);
    expect((await u.call('POST', `/auctions/${id}/bids`, { maximum: 100000 })).status).toBe(400);
    expect((await u.bid(randomUUID(), '100000')).status).toBe(404);
    expect((await u.bid('not-a-uuid', '100000')).status).toBe(404);

    // SEC-SDL-09: a hidden seller's auction is not found, for bids, state and history alike
    await fx.query(`UPDATE listings.listings SET seller_visible = false WHERE id = $1`, [id]);
    expect((await u.bid(id, '100000')).status).toBe(404);
    expect((await guest('GET', `/auctions/${id}/state`)).status).toBe(404);
    expect((await guest('GET', `/auctions/${id}/bids`)).status).toBe(404);
    expect((await seller.call('GET', `/auctions/${id}/state`)).status).toBe(200);
    expect((await state(id)).bidCount).toBeUndefined();
  });

  it('I-53 a bid repeated with the same Idempotency-Key is placed once and answers the first outcome', async () => {
    const { id } = await auction();
    const u = await member();
    const key = `bid-${randomUUID()}`;
    const first = await u.bid(id, '120000', key);
    expect(first.status).toBe(201);
    const a = (await first.json()) as { bidId: string; state: { seq: number; serverTime: string } };
    expect(a.state.seq).toEqual(expect.any(Number));
    expect(Date.parse(a.state.serverTime)).not.toBeNaN();
    const again = await u.bid(id, '120000', key);
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ bidId: a.bidId, outcome: 'leading', yourMaximum: '120000' });
    expect((await state(id)).bidCount).toBe(1);
    expect((await u.bid(id, '120000', 'bad key!')).status).toBe(400);
  });

  it('FR-AUC-17 bids are limited per user per auction (CP-35); another auction is not affected', async () => {
    const [one, two] = [await auction(), await auction()];
    const u = await member();
    for (let i = 0; i < 10; i++) expect((await u.bid(one.id, String(100000 + i * 10000))).status).toBe(201);
    const limited = await u.bid(one.id, '900000');
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await u.bid(two.id, '100000')).status).toBe(201);
    expect((await state(one.id)).bidCount).toBe(10);
  });

  it('DV-18 a bid that cannot get the auction\'s lock within a second is answered "try again"', async () => {
    const { id } = await auction();
    const holder = new Client({ connectionString: process.env.DATABASE_URL });
    await holder.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT 1 FROM auctions.auctions WHERE listing_id = $1 FOR UPDATE', [id]);
      const r = await (await member()).bid(id, '100000');
      expect(r.status).toBe(409);
      expect((await r.json()).type).toBe('/problems/auction-busy');
      expect(r.headers.get('retry-after')).toBe('1');
    } finally {
      await holder.query('ROLLBACK');
      await holder.end();
    }
    expect((await state(id)).bidCount).toBe(0);
  });

  it('FR-AUC-12 the room gets auction.state with seq; only the previous leader gets auction.outbid; the history event is written', async () => {
    const { id } = await auction();
    const [asha, babu, watcher] = [await member(), await member(), await member()];
    const [sa, sb, sw] = [await connect(asha.cookie), await connect(babu.cookie), await connect(watcher.cookie)];
    expect(await sw.emitWithAck('join', { room: `auction:${id}` })).toEqual({ ok: true });

    let msg = next(sw, 'auction.state');
    expect((await asha.bid(id, '120000')).status).toBe(201);
    const first = (await msg) as Record<string, unknown>;
    expect(first).toMatchObject({ auctionId: id, price: '100000', leaderAlias: 1, bidCount: 1 });

    msg = next(sw, 'auction.state');
    const outbidAsha = next(sa, 'auction.outbid');
    const outbidBabu = next(sb, 'auction.outbid', 700);
    expect((await babu.bid(id, '200000')).status).toBe(201);
    const second = (await msg) as Record<string, unknown>;
    expect(second).toMatchObject({ price: '125000', leaderAlias: 2 });
    expect(second.seq as number).toBeGreaterThan(first.seq as number);
    expect(await outbidAsha).toEqual({ auctionId: id, price: '125000', seq: second.seq });
    expect(await outbidBabu).toBe('none');
    expect(JSON.stringify(second)).not.toContain('200000');

    const events = await fx.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM auctions.outbox WHERE event_type = 'auctions.bid.outbid' AND aggregate_id = $1`, [id],
    );
    expect(events.map((e) => e.payload)).toEqual([expect.objectContaining({ auctionId: id, userId: asha.userId, price: '125000' })]);
  });
});
