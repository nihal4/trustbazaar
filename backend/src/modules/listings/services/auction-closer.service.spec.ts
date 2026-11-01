import type { LivePort } from '../../../kernel/live/live';
import type { AuditServicePort } from '../../identity/ports';
import type { AuctionOrders } from '../adapters/orders';
import { AuctionCloser, CLOSE_GRACE } from './auction-closer.service';

// Unit tests of AuctionCloser over a scripted stand-in for the database: what each outcome of close_if_due leads
// to, and that one failing auction does not stop the others. test/api/auction-close.spec.ts runs it on PostgreSQL.

const A = '7a1c2a3e-1111-4a5b-8c9d-000000000001';
const B = '7a1c2a3e-1111-4a5b-8c9d-000000000002';

function setup(o: { due?: string[]; claimed?: boolean; outcome?: Record<string, string>; held?: boolean; bidCount?: number } = {}) {
  const sql: string[] = [];
  const inserted: unknown[] = [];
  const query = async (q: string, p: unknown[] = []) => {
    sql.push(q);
    if (q.includes('a.end_at + $1::interval <= now()')) return (o.due ?? [A]).map((id) => ({ id }));
    if (q.includes('FOR UPDATE OF a SKIP LOCKED')) return o.claimed === false ? [] : [{ '?column?': 1 }];
    if (q.includes('close_if_due')) return [{ status: o.outcome?.[p[0] as string] ?? 'awarded' }];
    if (q.includes('winner_id, final_price')) return [{ seller_id: 'seller', winner_id: 'asha', price: '125000' }];
    if (q.includes('quantity_available = quantity_available - 1')) return o.held === false ? [] : [{ id: p[0] }];
    if (q.includes('bid_count, current_price')) return [{ seller_id: 'seller', bid_count: o.bidCount ?? 0, price: null }];
    if (q.includes('FROM listings.listings WHERE id = $1 FOR UPDATE')) return [{ seller_id: 'seller', item_kind: 'physical', status: 'active' }];
    return [];
  };
  const manager = { query, getRepository: () => ({ insert: async (row: unknown) => void inserted.push(row) }) };
  const db = { query, transaction: async (fn: (m: typeof manager) => unknown) => fn(manager) };
  const orders = { createAuctionOrder: jest.fn(async () => ({ id: 'order-1' })) };
  const audit = { record: jest.fn(async () => undefined) };
  const live = { toRoom: jest.fn(), toUser: jest.fn(), endSession: jest.fn() };
  const closer = new AuctionCloser(db as never, orders as unknown as AuctionOrders, audit as unknown as AuditServicePort, live as unknown as LivePort);
  return { closer, sql, inserted, orders, audit, live };
}

describe('AuctionCloser', () => {
  it('FR-AUC-14 an award holds the unit, creates the order in the same transaction, and announces the close', async () => {
    const t = setup();
    expect(await t.closer.closeDue()).toBe(1);
    expect(t.sql.find((q) => q.includes('close_if_due'))).toBeDefined();
    expect(t.orders.createAuctionOrder).toHaveBeenCalledWith({ listingId: A, winnerId: 'asha', price: 125000n, kind: 'auction' }, expect.anything());
    expect(t.inserted).toContainEqual(expect.objectContaining({
      eventType: 'auctions.auction.awarded', payload: expect.objectContaining({ winnerId: 'asha', price: '125000', orderId: 'order-1' }),
    }));
    expect(t.audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'auctions.auction.awarded', objectId: A }), expect.anything());
    expect(t.live.toRoom).toHaveBeenCalledWith(`auction:${A}`, 'auction.closed', { auctionId: A, status: 'sold', finalPrice: '125000' });
  });

  it.each([[0, 'no_bids'], [3, 'reserve_not_met']])('FR-AUC-09 unsold with %i bids: the listing ends unsold (%s)', async (bidCount, reason) => {
    const t = setup({ outcome: { [A]: 'unsold' }, bidCount });
    expect(await t.closer.closeOne(A)).toEqual({ auctionId: A, status: 'unsold', price: null });
    expect(t.sql.some((q) => q.includes(`SET status = 'ended_unsold'`))).toBe(true);
    expect(t.inserted).toContainEqual(expect.objectContaining({ eventType: 'auctions.auction.unsold', payload: expect.objectContaining({ reason }) }));
    expect(t.inserted).toContainEqual(expect.objectContaining({ eventType: 'listings.listing.ended_unsold' }));
    expect(t.orders.createAuctionOrder).not.toHaveBeenCalled();
  });

  it('NFR-REL-03 an auction another instance holds, or not due yet, is left alone', async () => {
    expect(await setup({ claimed: false }).closer.closeOne(A)).toBeNull();
    const t = setup({ outcome: { [A]: 'open' } });
    expect(await t.closer.closeOne(A)).toBeNull();
    expect(t.live.toRoom).not.toHaveBeenCalled();
  });

  it('DC-13 a failure on one auction is logged and the next is still closed', async () => {
    const t = setup({ due: [A, B] });
    t.orders.createAuctionOrder.mockRejectedValueOnce(new Error('orders unavailable'));
    expect(await t.closer.closeDue()).toBe(1);
    expect(t.live.toRoom).toHaveBeenCalledTimes(1);
    expect(t.live.toRoom).toHaveBeenCalledWith(`auction:${B}`, 'auction.closed', expect.anything());
  });

  it('DC-13 an award whose unit is not available is not committed', async () => {
    await expect(setup({ held: false }).closer.closeOne(A)).rejects.toThrow('not available');
  });

  it('DV-17 the close waits 2 seconds after the end; a live channel failure does not undo a close', async () => {
    expect(CLOSE_GRACE).toBe('2 seconds');
    const t = setup();
    t.live.toRoom.mockImplementation(() => {
      throw new Error('redis down');
    });
    expect(await t.closer.closeDue()).toBe(1);
  });
});
