import { Problem } from '../../../kernel/http/problems';
import { ListingCommandsService } from './listing-commands.service';

// ListingsCommands with the database faked: only a listing held for review is approved or returned; a held auction's
// clock restarts; the history row and the published event. The same against PostgreSQL: test/api/ownership-review.spec.ts.
function setup(listing: Record<string, unknown> | undefined) {
  const query = jest.fn(async (sql: string, _p?: unknown[]) => (sql.includes('FOR UPDATE') ? (listing ? [listing] : []) : []));
  const insert = jest.fn(async (_row: unknown) => undefined);
  const m = { query, getRepository: () => ({ insert }) };
  const db = { transaction: jest.fn(async <R>(fn: (x: unknown) => Promise<R>) => fn(m)) };
  return { svc: new ListingCommandsService(db as never), query, insert, db, m };
}
const held = (format = 'fixed_price') => ({ seller_id: 'S', item_kind: 'game_account', sale_format: format, status: 'pending_review' });

describe('ListingCommandsService', () => {
  it('FR-LST-12 approveForPublication: pending_review to active, the history and listings.listing.published; a held auction\'s clock restarts', async () => {
    const s = setup(held('auction'));
    await s.svc.approveForPublication('L', 'st', 'ownership approved');
    expect(s.query.mock.calls.map(([q]) => q.split(' ').slice(0, 2).join(' '))).toEqual(['SELECT seller_id,', 'UPDATE listings.listings', 'UPDATE auctions.auctions']);
    expect(s.insert.mock.calls).toEqual([
      [{ listingId: 'L', fromStatus: 'pending_review', toStatus: 'active', actorType: 'staff', actorId: 'st', reason: 'ownership approved' }],
      [{ eventType: 'listings.listing.published', aggregateId: 'L', payload: { listingId: 'L', sellerId: 'S', itemKind: 'game_account', saleFormat: 'auction' } }],
    ]);
    const fixed = setup(held());
    await fixed.svc.approveForPublication('L', 'st', 'ok', fixed.m as never); // in the caller's transaction
    expect(fixed.db.transaction).not.toHaveBeenCalled();
    expect(fixed.query.mock.calls.some(([q]) => q.includes('auctions.auctions'))).toBe(false);
    await expect(setup({ ...held(), status: 'active' }).svc.approveForPublication('L', 'st', 'x')).rejects.toMatchObject({ problem: 'listing-state' });
    await expect(setup(undefined).svc.approveForPublication('L', 'st', 'x')).rejects.toBeInstanceOf(Problem);
  });

  it('FR-LST-12 returnToDraft: pending_review to draft with the history; anything else is left alone', async () => {
    const s = setup(held());
    expect(await s.svc.returnToDraft('L', 'st', 'rejected')).toBe(true);
    expect(s.insert).toHaveBeenCalledWith({ listingId: 'L', fromStatus: 'pending_review', toStatus: 'draft', actorType: 'staff', actorId: 'st', reason: 'rejected' });
    const active = setup({ ...held(), status: 'active' });
    expect(await active.svc.returnToDraft('L', 'st', 'rejected')).toBe(false);
    expect(active.insert).not.toHaveBeenCalled();
  });
});
