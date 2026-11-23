import { mockKey } from '../../src/modules/orders/adapters/mock-provider';
import { REDIS } from '../../src/kernel/redis.provider';
import type Redis from 'ioredis';
import { decideOnMockPage, pendingOrder, suite } from './setup';

// SEC-PAY-03: a provider's webhook or callback is accepted only after its signature, or the provider's equivalent
// verification query, has been checked with the current environment's secret. Stripe's signed webhook is proved in
// test/api/payments-stripe.spec.ts; here the wallet flow (bKash and Nagad, in mock mode): the browser's return to the
// callback is never believed by itself, the server asks the provider what happened.
const s = suite();
const callback = (path: string) => fetch(s.t.url(path.replace('/api/v1', '')), { redirect: 'manual' });
const statusOf = async (orderId: string) => (await s.fx.query<{ status: string }>(`SELECT status FROM orders.orders WHERE id = $1`, [orderId]))[0].status;

describe('SEC-PAY-03 provider callbacks are verified', () => {
  it('SEC-PAY-03 coming back to the callback without paying, even claiming success, does not pay the order', async () => {
    const o = await pendingOrder(s);
    const a = (await (await o.buyer.b.post(`/orders/${o.orderId}/payments`, { provider: 'bkash' })).json()) as { attemptId: string; redirectUrl: string };
    const state = new URL(a.redirectUrl).searchParams.get('state');
    for (const extra of ['', '&status=success', '&paymentID=forged&status=success&amount=1500000']) {
      const r = await callback(`/callbacks/bkash/${a.attemptId}?state=${state}${extra}`);
      expect(new URL(r.headers.get('location') ?? 'http://x/').searchParams.get('result')).not.toBe('paid');
    }
    expect(await statusOf(o.orderId)).toBe('awaiting_payment');
  });

  it('SEC-PAY-03 a callback whose signed state is forged or belongs to another attempt is refused', async () => {
    const o = await pendingOrder(s);
    const a = (await (await o.buyer.b.post(`/orders/${o.orderId}/payments`, { provider: 'nagad' })).json()) as { attemptId: string; redirectUrl: string };
    const other = await pendingOrder(s);
    const b = (await (await other.buyer.b.post(`/orders/${other.orderId}/payments`, { provider: 'nagad' })).json()) as { attemptId: string; redirectUrl: string };
    expect((await callback(`/callbacks/nagad/${a.attemptId}?state=forged`)).status).toBe(410);
    expect((await callback(`/callbacks/nagad/${a.attemptId}?state=${new URL(b.redirectUrl).searchParams.get('state')}`)).status).toBe(410);
  });

  it('SEC-PAY-03 once the provider says it was paid, the same callback pays the order', async () => {
    const o = await pendingOrder(s);
    const a = (await (await o.buyer.b.post(`/orders/${o.orderId}/payments`, { provider: 'bkash' })).json()) as { attemptId: string; redirectUrl: string };
    const cb = await decideOnMockPage(s, a.redirectUrl);
    const r = await callback(cb.pathname + cb.search);
    expect(new URL(r.headers.get('location')!).searchParams.get('result')).toBe('paid');
    expect(await statusOf(o.orderId)).toBe('paid');
  });

  it('SEC-PAY-03 what the provider recorded decides, not the browser: a recorded failure stays a failure', async () => {
    const o = await pendingOrder(s);
    const a = (await (await o.buyer.b.post(`/orders/${o.orderId}/payments`, { provider: 'bkash' })).json()) as { attemptId: string; redirectUrl: string };
    const cb = await decideOnMockPage(s, a.redirectUrl, 'failed');
    expect(JSON.parse((await s.t.app.get<Redis>(REDIS).get(mockKey(a.attemptId)))!)).toMatchObject({ status: 'failed' });
    await callback(cb.pathname + cb.search + '&status=success');
    expect(await statusOf(o.orderId)).toBe('awaiting_payment');
  });
});
