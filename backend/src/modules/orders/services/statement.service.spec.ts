import { Problem } from '../../../kernel/http/problems';
import { StatementService } from './statement.service';

// StatementService (U2-06): who sees what on a receipt, and the statements page, with the database faked.
// The SQL itself runs in test/api/statements.spec.ts.
describe('StatementService', () => {
  const at = new Date('2026-11-10T09:00:00Z');
  const order = {
    id: 'o1', buyer_id: 'B', seller_id: 'S', kind: 'fixed_price', title: 'Lamp', quantity: 1, unit_price: '1000000', item_price: '1000000', delivery_fee: '15000',
    total: '1015000', status: 'closed', created_at: at, paid_at: at, closed_at: at, cancelled_at: null,
  };
  const settlement = {
    order_id: 'o1', title: 'Lamp', created_at: at, amount_collected: '1015000', item_price: '1000000', delivery_fee: '15000', commission: '50000', commission_bps: 500,
    courier_payout: '13500', delivery_margin: '1500', delivery_margin_bps: 1000, seller_payout: '950000', refund_total: '0', cursor_at: '2026-11-10T09:00:00.000000Z',
  };
  const payout = { id: 'p1', order_id: 'o1', amount: '950000', status: 'sent', simulated: true, created_at: at, sent_at: at };

  /** A fake DataSource answering by the table the SQL reads. */
  function fake(t: { orders?: unknown[]; settlements?: unknown[]; attempts?: unknown[]; refunds?: unknown[]; payouts?: unknown[] }) {
    const query = jest.fn(async (sql: string, _params?: unknown[]) => {
      if (sql.includes('FROM payments.settlements')) return t.settlements ?? [];
      if (sql.includes('FROM orders.orders')) return t.orders ?? [];
      if (sql.includes('FROM payments.attempts')) return t.attempts ?? [];
      if (sql.includes('FROM payments.refunds')) return t.refunds ?? [];
      if (sql.includes('FROM payments.payouts')) return t.payouts ?? [];
      throw new Error(`unexpected ${sql}`);
    });
    const ledger = { owed: jest.fn(async () => 950_000n) };
    return { svc: new StatementService({ query } as never, ledger as never), query, ledger };
  }

  it('FR-PAY-21 a receipt is answered only to the parties; anyone else gets not-found', async () => {
    const { svc } = fake({ orders: [order] });
    await expect(svc.receipt('o1', 'X')).rejects.toThrow(Problem);
    await expect(fake({}).svc.receipt('o1', 'B')).rejects.toThrow(Problem);
  });

  it('FR-PAY-21 the buyer sees payments, refunds and the refund total, not the commission', async () => {
    const { svc } = fake({
      orders: [order], settlements: [settlement],
      attempts: [{ id: 'a1', provider: 'bkash', amount: '1015000', status: 'succeeded', confirmed_at: at }, { id: 'a2', provider: 'stripe', amount: '1015000', status: 'succeeded_duplicate', confirmed_at: at }],
      refunds: [{ id: 'r1', attempt_id: 'a2', amount: '1015000', reason: 'duplicate_payment', status: 'succeeded', created_at: at, completed_at: at }],
    });
    const r = await svc.receipt('o1', 'B');
    expect(r).toMatchObject({ role: 'buyer', order: { id: 'o1', total: '1015000', cancelledAt: null }, settlement: { amountCollected: '1015000', refundTotal: '0' } });
    if (r.role !== 'buyer') throw new Error('buyer expected');
    expect(r.payments.map((p) => p.accepted)).toEqual([true, false]);
    expect(r.refunds[0]).toMatchObject({ attemptId: 'a2', reason: 'duplicate_payment', completedAt: at.toISOString() });
    expect(JSON.stringify(r)).not.toContain('commission');
    const unpaid = await fake({ orders: [{ ...order, status: 'awaiting_payment', paid_at: null, closed_at: null }] }).svc.receipt('o1', 'B');
    expect(unpaid).toMatchObject({ order: { paidAt: null, closedAt: null }, payments: [], refunds: [], settlement: null });
  });

  it('FR-PAY-13 the seller sees the itemised settlement and its payout', async () => {
    const r = await fake({ orders: [order], settlements: [settlement], payouts: [payout] }).svc.receipt('o1', 'S');
    expect(r).toMatchObject({
      role: 'seller',
      settlement: { commission: '50000', courierPayout: '13500', deliveryMargin: '1500', sellerPayout: '950000', settledAt: at.toISOString() },
      payouts: [{ id: 'p1', status: 'sent', sentAt: at.toISOString() }],
    });
    expect(await fake({ orders: [order] }).svc.receipt('o1', 'S')).toMatchObject({ settlement: null, payouts: [] });
  });

  it('FR-PAY-21 statements: each settlement with its payout, what is owed, and a cursor after 50', async () => {
    const many = Array.from({ length: 51 }, (_, i) => ({ ...settlement, order_id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}` }));
    many[0] = { ...many[0], order_id: 'o1' };
    const { svc, ledger, query } = fake({ settlements: many, payouts: [payout] });
    const page = await svc.statements('S');
    expect(page.items).toHaveLength(50);
    expect(page.items[0].payout).toMatchObject({ id: 'p1' });
    expect(page.items[1].payout).toBeNull();
    expect(page.owed).toBe('950000');
    expect(ledger.owed).toHaveBeenCalledWith('seller_payable', 'S');
    expect(page.nextCursor).not.toBeNull();
    await svc.statements('S', page.nextCursor!);
    expect(query.mock.calls[2][1]).toEqual(['S', '2026-11-10T09:00:00.000000Z', many[49].order_id]);
    const empty = await fake({}).svc.statements('S');
    expect(empty).toEqual({ items: [], owed: '950000', nextCursor: null });
  });
});
