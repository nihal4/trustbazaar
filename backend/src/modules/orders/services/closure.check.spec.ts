import { OrdersClosureCheck } from './closure.check';

// Unit 2's AccountClosureCheck (U1-09) with the database faked; on PostgreSQL in test/api/account-closure.spec.ts.
describe('OrdersClosureCheck', () => {
  const check = (r: Record<string, boolean>) => {
    const checks = { register: jest.fn() };
    const c = new OrdersClosureCheck({ manager: { query: async () => [r] } } as never, checks as never);
    c.onModuleInit();
    expect(checks.register).toHaveBeenCalledWith(c);
    return c;
  };

  it('FR-ACC-11 an open order or a balance owed refuses closure; money still due to the user holds only the erasure', async () => {
    const all = { open_order: true, owed: true, payout: true, refund: true };
    expect(await check(all).blockers('U', 'closure')).toEqual(['open-order', 'balance-owed']);
    expect(await check(all).blockers('U', 'erasure')).toEqual(['open-order', 'balance-owed', 'payout-pending', 'refund-pending']);
    expect(await check({ open_order: false, owed: false, payout: false, refund: false }).blockers('U', 'erasure')).toEqual([]);
  });
});
