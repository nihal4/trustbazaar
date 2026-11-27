import { OrdersDataExport } from './data-export';

// Unit 2's export source (U7-11) with the database faked; on PostgreSQL in test/api/data-export.spec.ts.
describe('OrdersDataExport', () => {
  it('FR-PRV-03 every section is read for the user; account numbers and idempotency keys are left out', async () => {
    const sql: string[] = [];
    const out = await new OrdersDataExport({ query: jest.fn(async (q: string) => (sql.push(q), [])) } as never).exportFor('U');
    expect(Object.keys(out)).toEqual([
      'orders',
      'cancellationRequests',
      'payments',
      'refunds',
      'settlements',
      'payouts',
      'payoutAccounts',
      'termsAcceptances',
      'savedPaymentMethod',
      'subscriptions',
      'featuredPurchases',
    ]);
    expect(sql.join('\n')).toContain("'{account_number_enc,account_number_bidx,reviewed_by,user_id}'");
    expect(sql.filter((q) => q.includes('payments.attempts a WHERE')).join()).toContain('idempotency_key');
  });
});
