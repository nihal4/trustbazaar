import { Problem } from '../../../kernel/http/problems';
import { LedgerService } from './ledger.service';

// LedgerService (U2-06): balances and the revenue log's checks and paging, with the database faked.
describe('LedgerService', () => {
  const day = 86_400_000;
  const from = new Date('2026-11-01T00:00:00Z');
  const to = new Date('2026-11-02T00:00:00Z');
  const line = (entry: number, account: string, revenue: string) => ({
    entry_id: String(entry),
    created_at: new Date('2026-11-01T10:00:00Z'),
    kind: 'escrow_release',
    order_id: 'o',
    account_code: account,
    revenue,
  });

  it('FR-PAY-13 a balance sums one account, for one party or all; owed is the negated liability', async () => {
    const query = jest.fn(async () => [{ s: '-950000' }]);
    const l = new LedgerService({ manager: { query } } as never);
    expect(await l.balance('seller_payable', 'S')).toBe(-950_000n);
    expect(query).toHaveBeenLastCalledWith(expect.any(String), ['seller_payable', false, 'S']);
    await l.balance('revenue_commission');
    expect(query).toHaveBeenLastCalledWith(expect.any(String), ['revenue_commission', true, null]);
    expect(await l.owed('seller_payable', 'S')).toBe(950_000n);
    const m = { query: jest.fn(async () => [{ s: '7' }]) };
    expect(await l.balance('x', null, m as never)).toBe(7n);
    expect(m.query).toHaveBeenCalled();
  });

  it('FR-MON-09 the revenue log refuses empty, reversed or over-long ranges and malformed cursors', async () => {
    const l = new LedgerService({ query: jest.fn(async () => []) } as never);
    const reason = async (p: Promise<unknown>) => ((await p.catch((e: unknown) => e)) as Problem).problem;
    expect(await reason(l.revenueLog(to, from))).toBe('validation-failed');
    expect(await reason(l.revenueLog(from, from))).toBe('validation-failed');
    expect(await reason(l.revenueLog(from, new Date(from.getTime() + 367 * day)))).toBe('validation-failed');
    expect(await reason(l.revenueLog(from, to, '0'))).toBe('validation-failed');
    expect(await reason(l.revenueLog(from, to, '12a'))).toBe('validation-failed');
    expect(await l.revenueLog(from, new Date(from.getTime() + 366 * day), '')).toEqual({ items: [], totals: {}, nextCursor: null });
  });

  it('FR-MON-09 a page holds whole entries; the cursor is the last whole entry of the page', async () => {
    // ids that cross a digit boundary, and rows not in order: the page and the cursor go by the numeric id
    const rows = [line(100, 'revenue_commission', '50000'), line(100, 'revenue_delivery_margin', '1500')];
    for (let e = 99; e >= 51; e--) rows.push(line(e, 'revenue_commission', '100'));
    rows.unshift(line(9, 'revenue_commission', '100'));
    rows.push(line(9, 'revenue_delivery_margin', '10')); // the 51st entry: not on this page
    const query = jest
      .fn()
      .mockResolvedValueOnce(rows)
      .mockResolvedValueOnce([{ account_code: 'revenue_commission', total: '55000' }]);
    const l = new LedgerService({ query } as never);
    const page = await l.revenueLog(from, to, '101');
    expect(query.mock.calls[0][1]).toEqual([from, to, '101', 51]);
    expect(page.items).toHaveLength(51);
    expect(page.items.some((i) => i.entryId === '9')).toBe(false);
    expect(page.items[0]).toEqual({
      entryId: '100',
      createdAt: '2026-11-01T10:00:00.000Z',
      kind: 'escrow_release',
      orderId: 'o',
      account: 'revenue_commission',
      revenue: '50000',
    });
    expect(page.nextCursor).toBe('51');
    expect(page.totals).toEqual({ revenue_commission: '55000' });
  });
});
