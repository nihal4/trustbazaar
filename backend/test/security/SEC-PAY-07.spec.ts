import { randomUUID } from 'crypto';
import type Redis from 'ioredis';
import { REDIS } from '../../src/kernel/redis.provider';
import { MockProvider } from '../../src/modules/orders/adapters/mock-provider';
import { SimulatedPayoutProvider } from '../../src/modules/orders/adapters/payout-provider';
import { pendingOrder, suite } from './setup';

// SEC-PAY-07: every payment, refund and payout request to a provider carries an idempotency key unique to that
// operation, so a retry never charges, refunds or pays twice.
const s = suite();

describe('SEC-PAY-07 idempotency keys', () => {
  it('SEC-PAY-07 starting a payment again with the same key gives the same attempt, not a second charge', async () => {
    const o = await pendingOrder(s);
    const key = randomUUID();
    const one = (await (await o.buyer.b.post(`/orders/${o.orderId}/payments`, { provider: 'bkash' }, { 'idempotency-key': key })).json()) as { attemptId: string };
    const two = (await (await o.buyer.b.post(`/orders/${o.orderId}/payments`, { provider: 'bkash' }, { 'idempotency-key': key })).json()) as { attemptId: string };
    expect(two.attemptId).toBe(one.attemptId);
    expect(await s.fx.query(`SELECT 1 FROM payments.attempts WHERE order_id = $1`, [o.orderId])).toHaveLength(1);
  });

  it('SEC-PAY-07 the provider port takes a key for every refund and payout, and a retried key does nothing new', async () => {
    const provider = new MockProvider('bkash', s.t.app.get<Redis>(REDIS), (id) => `/mock-provider/${id}`);
    const key = randomUUID();
    const first = await provider.refund({ amount: 50_000n, idempotencyKey: key });
    const again = await provider.refund({ amount: 50_000n, idempotencyKey: key });
    const other = await provider.refund({ amount: 50_000n, idempotencyKey: randomUUID() });
    expect(other.providerRefundId).not.toBe(first.providerRefundId);
    expect(again.providerRefundId).toBe(first.providerRefundId);
    const payouts = new SimulatedPayoutProvider();
    const p1 = await payouts.send({ idempotencyKey: key });
    const p2 = await payouts.send({ idempotencyKey: key });
    expect(p2.ref).toBe(p1.ref);
  });

  it('SEC-PAY-07 the stored refunds and payouts carry their key, unique per operation', async () => {
    for (const [table, column] of [['payments.attempts', 'idempotency_key'], ['payments.refunds', 'idempotency_key'], ['payments.payouts', 'idempotency_key']]) {
      const [schema, name] = table.split('.');
      const cols = await s.fx.query(`SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`, [schema, name, column]);
      expect(cols).toHaveLength(1);
      const unique = await s.fx.query(
        `SELECT 1 FROM pg_indexes WHERE schemaname = $1 AND tablename = $2 AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%' || $3 || '%'`, [schema, name, column]);
      expect(unique.length).toBeGreaterThan(0);
    }
  });
});
