import { QueryFailedError } from 'typeorm';
import type { IdempotencyKeys } from '../../../kernel/http/idempotency';
import { Problem } from '../../../kernel/http/problems';
import type { LivePort } from '../../../kernel/live/live';
import type { IdentityQuery, RateLimiterPort } from '../../identity/ports';
import { Bid } from '../db/entities';
import { BidService, fromPlaceBid } from './bid.service';
import type { ListingService } from './listing.service';

// Unit tests of BidService over stand-ins: the gates before the lock, the mapping of place_bid's refusals, the
// live messages and the outbox event after a bid. The rules themselves run in PostgreSQL; test/api/auctions.spec.ts
// checks them end to end.

const AUCTION = '6f1c2a3e-1111-4a5b-8c9d-000000000001';
const ASHA = '6f1c2a3e-2222-4a5b-8c9d-000000000002';
const BABU = '6f1c2a3e-3333-4a5b-8c9d-000000000003';

const pgError = (code: string, message: string) => new QueryFailedError('SELECT', [], Object.assign(new Error(message), { code }));
const problemOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e as Problem;
  }
  throw new Error('no problem thrown');
};

const STATE_ROW = {
  listing_id: AUCTION, status: 'open', start_price: '100000', current_price: '125000', bid_count: 2, end_at: new Date('2026-11-20T10:00:00Z'),
  version: '7', has_reserve: true, reserve_met: false, leader_alias: 1, minimum_bid: '130000', server_time: new Date('2026-11-19T10:00:00Z'),
};

function setup(o: { placed?: Record<string, unknown>; placeError?: Error; bids?: Record<string, unknown>[] } = {}) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const outbox: unknown[] = [];
  const query = async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (sql.includes('auctions.place_bid')) {
      if (o.placeError) throw o.placeError;
      return [o.placed ?? { bid_id: '41', outcome: 'leading', price: '125000', leader_alias: 1, end_at: new Date(), extended: false, previous_leader: null, version: '7' }];
    }
    if (sql.includes('FROM auctions.auctions a') && sql.includes('LEFT JOIN')) return [STATE_ROW];
    if (sql.includes('auctions.replay')) {
      return [{ bid_id: '42', received_at: new Date('2026-11-19T09:00:00Z'), alias_no: 2, shown_amount: '120000', is_leading: false }];
    }
    if (sql.includes('a.leader_id = $2')) return [{ leading: true, maximum: '150000', alias: 1 }];
    return [];
  };
  const bids = o.bids ?? [{ id: '41', auctionId: AUCTION, bidderId: ASHA, outcome: 'leading', maxAmount: '150000' }];
  const manager = {
    query,
    getRepository: () => ({ insert: async (row: unknown) => void outbox.push(row) }),
  };
  const db = {
    query,
    transaction: async (fn: (m: typeof manager) => Promise<void>) => fn(manager),
    getRepository: (e: unknown) => {
      if (e !== Bid) throw new Error('unexpected repository');
      return { findOneBy: async (w: Record<string, unknown>) => bids.find((b) => Object.entries(w).every(([k, v]) => b[k] === v)) ?? null };
    },
  };
  const identity = { assertCanTransact: jest.fn(async () => undefined) };
  const limiter = { consume: jest.fn(async () => undefined), define: jest.fn() };
  const listings = { visible: jest.fn(async () => ({})) };
  const live = { toRoom: jest.fn(), toUser: jest.fn(), endSession: jest.fn() };
  const stored = new Map<string, string>();
  const idempotency = {
    once: jest.fn(async (_s: string, _u: string, key: string | undefined, create: () => Promise<string>) => {
      if (key && stored.has(key)) return { id: stored.get(key)!, repeated: true };
      const id = await create();
      if (key) stored.set(key, id);
      return { id, repeated: false };
    }),
  };
  const service = new BidService(
    db as never, listings as unknown as ListingService, idempotency as unknown as IdempotencyKeys,
    identity as unknown as IdentityQuery, limiter as unknown as RateLimiterPort, live as unknown as LivePort,
  );
  return { service, calls, outbox, identity, limiter, listings, live };
}

describe('fromPlaceBid', () => {
  it('FR-AUC-02 below_minimum is 422 bid-refused with the minimum', () => {
    const p = problemOf(() => fromPlaceBid(pgError('P0001', 'below_minimum: bid must be at least 105000')));
    expect(p.problem).toBe('bid-refused');
    expect(p.extra.errors).toEqual([{ field: 'maximum', reason: 'below_minimum', minimum: '105000' }]);
  });

  it.each(['max_not_higher: new maximum must exceed your current maximum', 'auction_ended', 'auction_not_open', 'auction_not_open: listing not available', 'seller_cannot_bid'])(
    'FR-AUC-02 the refusal "%s" keeps its stable code',
    (message) => {
      const p = problemOf(() => fromPlaceBid(pgError('P0001', message)));
      expect(p.problem).toBe('bid-refused');
      expect((p.extra.errors as { reason: string }[])[0].reason).toBe(message.split(/[: ]/)[0]);
    },
  );

  it('FR-AUC-16 a restricted bidder is told until when', () => {
    const p = problemOf(() => fromPlaceBid(pgError('P0001', 'bidder_restricted until 2026-11-20 10:00:00.5+06')));
    expect(p.extra.errors).toEqual([{ field: 'maximum', reason: 'bidder_restricted', until: '2026-11-20T04:00:00.500Z' }]);
  });

  it('DV-18 a lock wait that ran out is 409 auction-busy with Retry-After 1', () => {
    const p = problemOf(() => fromPlaceBid(pgError('55P03', 'canceling statement due to lock timeout')));
    expect(p.problem).toBe('auction-busy');
    expect(p.extra.retryAfter).toBe(1);
  });

  it('FR-AUC-02 an unknown auction is not-found; anything else is passed on', () => {
    expect(problemOf(() => fromPlaceBid(pgError('P0001', 'auction_not_found'))).problem).toBe('not-found');
    const other = pgError('23505', 'duplicate key');
    expect(() => fromPlaceBid(other)).toThrow(other);
    expect(() => fromPlaceBid(pgError('P0001', 'something else'))).toThrow(QueryFailedError);
  });
});

describe('BidService', () => {
  it('FR-AUC-02 the gates run before the lock: transact, CP-35 per user and auction, visible listing', async () => {
    const t = setup();
    const r = await t.service.place(ASHA, AUCTION, '150000', undefined);
    expect(t.identity.assertCanTransact).toHaveBeenCalledWith(ASHA, 'bid');
    expect(t.limiter.consume).toHaveBeenCalledWith('bid', `${ASHA}:${AUCTION}`);
    expect(t.listings.visible).toHaveBeenCalledWith(AUCTION, ASHA);
    expect(t.calls.find((c) => c.sql.includes('place_bid'))?.params).toEqual([AUCTION, ASHA, '150000']);
    expect(r).toEqual({
      bidId: '41', outcome: 'leading', yourMaximum: '150000', repeated: false,
      state: expect.objectContaining({ auctionId: AUCTION, price: '125000', leaderAlias: 1, minimumBid: '130000', seq: 7, serverTime: '2026-11-19T10:00:00.000Z' }),
    });
  });

  it('FR-AUC-02 an unverified or suspended bidder is refused before any database work', async () => {
    const t = setup();
    t.identity.assertCanTransact.mockRejectedValueOnce(new Problem('transaction-not-allowed'));
    await expect(t.service.place(BABU, AUCTION, '150000', undefined)).rejects.toMatchObject({ problem: 'transaction-not-allowed' });
    expect(t.limiter.consume).not.toHaveBeenCalled();
    expect(t.calls).toHaveLength(0);
  });

  it('FR-AUC-17 a bidder over the rate limit is refused with 429 and nothing is placed', async () => {
    const t = setup();
    t.limiter.consume.mockRejectedValueOnce(new Problem('rate-limited', { retryAfter: 30 }));
    await expect(t.service.place(BABU, AUCTION, '150000', undefined)).rejects.toMatchObject({ problem: 'rate-limited' });
    expect(t.calls).toHaveLength(0);
  });

  it('FR-AUC-12 a bid that takes the lead sends auction.outbid to the previous leader only, and writes the event', async () => {
    const t = setup({
      placed: { bid_id: '41', outcome: 'leading', price: '125000', leader_alias: 2, end_at: new Date(), extended: false, previous_leader: BABU, version: '7' },
    });
    await t.service.place(ASHA, AUCTION, '150000', undefined);
    expect(t.live.toRoom).toHaveBeenCalledWith(`auction:${AUCTION}`, 'auction.state', expect.objectContaining({ seq: 7, price: '125000' }));
    expect(t.live.toUser).toHaveBeenCalledTimes(1);
    expect(t.live.toUser).toHaveBeenCalledWith(BABU, 'auction.outbid', { auctionId: AUCTION, price: '125000', seq: 7 });
    expect(t.outbox).toEqual([
      { eventType: 'auctions.bid.outbid', aggregateId: AUCTION, payload: { auctionId: AUCTION, userId: BABU, price: '125000', bidId: '41' } },
    ]);
  });

  it.each([
    ['outbid', BABU],
    ['raised_own_max', ASHA],
    ['leading', null],
  ])('FR-AUC-12 no outbid notice when the outcome is %s (previous leader %s)', async (outcome, previous) => {
    const t = setup({ placed: { bid_id: '41', outcome, price: '125000', leader_alias: 1, end_at: new Date(), extended: false, previous_leader: previous, version: '7' } });
    await t.service.place(ASHA, AUCTION, '150000', undefined);
    expect(t.live.toRoom).toHaveBeenCalledTimes(1);
    expect(t.live.toUser).not.toHaveBeenCalled();
    expect(t.outbox).toEqual([]);
  });

  it('FR-AUC-11 a live channel failure does not fail a committed bid', async () => {
    const t = setup();
    t.live.toRoom.mockImplementation(() => {
      throw new Error('redis down');
    });
    await expect(t.service.place(ASHA, AUCTION, '150000', undefined)).resolves.toMatchObject({ bidId: '41' });
  });

  it('FR-AUC-02 a refusal from place_bid reaches the caller as bid-refused, and nothing is broadcast', async () => {
    const t = setup({ placeError: pgError('P0001', 'below_minimum: bid must be at least 130000') });
    await expect(t.service.place(BABU, AUCTION, '120000', undefined)).rejects.toMatchObject({ problem: 'bid-refused' });
    expect(t.live.toRoom).not.toHaveBeenCalled();
  });

  it('I-53 a repeat with the same Idempotency-Key answers the first outcome and places nothing', async () => {
    const t = setup();
    await t.service.place(ASHA, AUCTION, '150000', 'key-0123456789');
    const again = await t.service.place(ASHA, AUCTION, '150000', 'key-0123456789');
    expect(again).toMatchObject({ bidId: '41', outcome: 'leading', repeated: true });
    expect(t.calls.filter((c) => c.sql.includes('place_bid'))).toHaveLength(1);
    expect(t.live.toRoom).toHaveBeenCalledTimes(1);
  });

  it('I-53 a key reused for another auction names no bid there: not-found', async () => {
    const t = setup({ bids: [] });
    await expect(t.service.place(ASHA, AUCTION, '150000', undefined)).rejects.toMatchObject({ problem: 'not-found' });
  });

  it('FR-AUC-13 the history shows aliases and the amounts shown, newest first, without identities', async () => {
    const t = setup();
    expect(await t.service.history(AUCTION, undefined)).toEqual({
      items: [{ id: '42', bidderAlias: 2, amount: '120000', leading: false, at: '2026-11-19T09:00:00.000Z' }],
    });
    expect(t.listings.visible).toHaveBeenCalledWith(AUCTION, undefined);
  });

  it('FR-AUC-08 my-status shows the caller their own maximum', async () => {
    const t = setup();
    expect(await t.service.myStatus(AUCTION, ASHA)).toEqual({ hasBid: true, yourMaximum: '150000', leading: true, yourAlias: 1 });
  });

  it('FR-AUC-01 the state of an unknown auction is not-found', async () => {
    const t = setup();
    const s = await t.service.state(AUCTION, undefined);
    expect(s).toMatchObject({ status: 'open', hasReserve: true, reserveMet: false, endAt: '2026-11-20T10:00:00.000Z' });
    expect(s).not.toHaveProperty('reservePrice');
    expect(s).not.toHaveProperty('leaderMax');
    const empty = { query: async () => [] };
    await expect(new BidService(empty as never, t.listings as never, {} as never, {} as never, {} as never, {} as never).getPublicState(AUCTION))
      .rejects.toMatchObject({ problem: 'not-found' });
  });
});
