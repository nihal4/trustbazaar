import type { AccountLinkSource } from '../../../kernel/links/account-links';
import { LinkedAccountsService } from './linked-accounts.service';

// U7-09: the daily linked-account check (FR-TNS-08) and the disputed sales for Unit 3's relisting flag (FR-TNS-02).
describe('LinkedAccountsService', () => {
  const AT = new Date('2026-11-17T08:00:00Z');
  const source = (pairs: Awaited<ReturnType<AccountLinkSource['pairs']>>): AccountLinkSource => ({ pairs: async () => pairs, linkedTo: async () => [] });

  it('FR-TNS-08 each pair becomes one linked_accounts signal about the later account, keyed by kind and the sorted pair', async () => {
    const inserted: unknown[][] = [];
    const db = { query: jest.fn(async (_sql: string, p: unknown[]) => (inserted.push(p), inserted.length === 2 ? [] : [{ id: 'S' }])) };
    const svc = new LinkedAccountsService(
      db as never,
      source([{ via: 'device', userId: 'b', linkedTo: 'a', at: AT }]),
      source([
        { via: 'payout_bank', userId: 'c', linkedTo: 'd', at: AT },
        { via: 'payout_wallet', userId: 'e', linkedTo: 'f', at: AT },
      ]),
      {} as never,
    );
    expect(await svc.check()).toBe(2); // the second pair was signalled before
    expect(inserted.map((p) => [p[0], p[1]])).toEqual([
      ['device:a:b', 'b'],
      ['payout_bank:c:d', 'c'],
      ['payout_wallet:e:f', 'e'],
    ]);
    expect(JSON.parse(inserted[0][2] as string)).toEqual({ via: 'device', userId: 'b', linkedTo: 'a', since: AT.toISOString() });
    expect(String(db.query.mock.calls[0][0])).toContain('ON CONFLICT ON CONSTRAINT signal_once DO NOTHING');
  });

  it("FR-TNS-02 DV-22 the listings of the seller's disputed orders in the window, newest dispute first, once each", async () => {
    const db = {
      query: jest.fn(async () => [
        { order_id: 'o1', opened_at: new Date('2026-11-15T00:00:00Z') },
        { order_id: 'o2', opened_at: new Date('2026-11-16T00:00:00Z') },
        { order_id: 'o3', opened_at: new Date('2026-11-14T00:00:00Z') },
      ]),
    };
    const orders = { getOrderForParty: jest.fn(async (id: string) => ({ listing: { id: id === 'o3' ? 'L2' : `L-${id}` } })) };
    const svc = new LinkedAccountsService(db as never, source([]), source([]), orders as never);
    expect(await svc.disputedListings('S', 7)).toEqual(['L-o2', 'L-o1', 'L2']);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('seller_id = $1'), ['S', 7]);
    expect(orders.getOrderForParty).toHaveBeenCalledWith('o2', 'S');
  });
});
