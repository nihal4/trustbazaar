import { pendingOrder, problem, suite } from './setup';

// SEC-PAY-06: amounts, currency and order references are computed on the server; an amount sent by the client is ignored
// (here: refused as an unknown field, SEC-INP-01, so it cannot even be sent).
const s = suite();

describe('SEC-PAY-06 server-side amounts', () => {
  it('SEC-PAY-06 a payment started with an amount, a currency or another order\'s reference in the body is refused', async () => {
    const o = await pendingOrder(s);
    for (const extra of [{ amount: '100' }, { currency: 'USD' }, { orderId: '00000000-0000-4000-8000-000000000000' }, { total: '1' }]) {
      const p = await problem(await o.buyer.b.post(`/orders/${o.orderId}/payments`, { provider: 'bkash', ...extra }));
      expect(p.status).toBe(400);
      expect(p.errors as unknown as string[]).toEqual([`property ${Object.keys(extra)[0]} should not exist`]);
    }
  });

  it('SEC-PAY-06 the attempt, the provider page and the ledger use the order total the server worked out', async () => {
    const o = await pendingOrder(s, 1_234_500);
    expect(o.total).toBe('1234500');
    const a = (await (await o.buyer.b.post(`/orders/${o.orderId}/payments`, { provider: 'nagad' })).json()) as { attemptId: string; amount: string; redirectUrl: string };
    expect(a.amount).toBe('1234500');
    const [row] = await s.fx.query(`SELECT amount, order_id FROM payments.attempts WHERE id = $1`, [a.attemptId]);
    expect(row).toEqual({ amount: '1234500', order_id: o.orderId });
    const page = new URL(a.redirectUrl);
    expect(await (await fetch(s.t.url(page.pathname.replace('/api/v1', '') + page.search))).text()).toContain('BDT 12,345.00');
  });

  it('SEC-PAY-06 an order cannot be created with a price, and its total follows the listing', async () => {
    const o = await pendingOrder(s, 900_000);
    const [row] = await s.fx.query(`SELECT unit_price, total FROM orders.orders WHERE id = $1`, [o.orderId]);
    expect(row).toEqual({ unit_price: '900000', total: '900000' });
  });
});
