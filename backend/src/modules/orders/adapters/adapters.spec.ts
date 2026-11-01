import { createHmac } from 'crypto';
import type Redis from 'ioredis';
import type { TbConfig } from '../../../kernel/config/config';
import { Secret } from '../../../kernel/config/config';
import { signState, stateValid } from './callback-state';
import { MockProvider, mockKey } from './mock-provider';
import { ProviderUnavailable } from './payment-provider';
import { buildProviders } from './providers';
import { formEncode, StripeProvider, StripeSignatureError, verifyStripeSignature } from './stripe-provider';

const attempt = { id: '11111111-1111-4111-8111-111111111111', provider: 'stripe' as const, orderId: 'o1', amount: 150000n, idempotencyKey: 'idem-1', providerPaymentId: 'cs_test_1', expiresAt: new Date('2026-11-01T12:31:00Z') };

function fakeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    set: async (k: string, v: string, ...a: string[]) => {
      if (a.includes('NX') && store.has(k)) return null;
      store.set(k, v);
      return 'OK';
    },
    get: async (k: string) => store.get(k) ?? null,
  };
}

describe('Stripe signature (SEC-PAY-03)', () => {
  const secret = 'whsec_x';
  const body = Buffer.from('{"id":"evt_1"}');
  const sig = (t: number, s = secret, b = body) => `t=${t},v1=${createHmac('sha256', s).update(`${t}.`).update(b).digest('hex')}`;

  it('SEC-PAY-03 a matching v1 within the tolerance passes; any other refusal names its reason', () => {
    expect(() => verifyStripeSignature(body, sig(1000), secret, 300, 1100)).not.toThrow();
    expect(() => verifyStripeSignature(body, `t=1000,v1=00,${sig(1000).split(',')[1]}`, secret, 300, 1000)).not.toThrow(); // one of several v1
    const cases: [string | undefined, number, string][] = [
      [undefined, 1000, 'no signature'],
      ['v1=abc', 1000, 'malformed signature header'],
      [sig(1000), 1301, 'timestamp outside the tolerance'],
      [sig(1000, 'whsec_other'), 1000, 'signature does not match'],
      [sig(1000).replace(/v1=.*/, 'v1=zz'), 1000, 'signature does not match'],
    ];
    for (const [header, now, reason] of cases) expect(() => verifyStripeSignature(body, header, secret, 300, now)).toThrow(new StripeSignatureError(reason));
  });
});

describe('StripeProvider (Checkout, test mode)', () => {
  const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json });

  it('SEC-PAY-07 a session is created with the attempt as reference and its idempotency key', async () => {
    const fetch = jest.fn(async () => ok({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' }));
    const p = new StripeProvider('sk_test_k', fetch);
    expect(await p.createPayment(attempt, { returnUrl: 'https://tb/r', cancelUrl: 'https://tb/c', title: 'Phone' })).toEqual({ providerPaymentId: 'cs_test_1', redirectUrl: 'https://checkout.stripe.com/c/pay/cs_test_1' });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect(init.headers).toMatchObject({ authorization: 'Bearer sk_test_k', 'idempotency-key': 'idem-1' });
    const form = new URLSearchParams(init.body);
    expect([form.get('client_reference_id'), form.get('line_items[0][price_data][unit_amount]'), form.get('line_items[0][price_data][currency]')]).toEqual([attempt.id, '150000', 'bdt']);
    expect(form.get('expires_at')).toBe(String(attempt.expiresAt.getTime() / 1000));
  });

  it('FR-PAY-16 an unreachable or refusing provider is ProviderUnavailable', async () => {
    const down = new StripeProvider('k', async () => Promise.reject(new Error('ECONNRESET')));
    await expect(down.query(attempt)).rejects.toBeInstanceOf(ProviderUnavailable);
    const refusing = new StripeProvider('k', async () => ({ ok: false, status: 401, json: async () => ({}) }));
    await expect(refusing.redirectUrl(attempt)).rejects.toThrow('stripe answered 401');
    const noUrl = new StripeProvider('k', async () => ok({ id: 'cs' }));
    await expect(noUrl.createPayment(attempt, { returnUrl: '', cancelUrl: '', title: '' })).rejects.toThrow('no checkout url');
    await expect(noUrl.redirectUrl(attempt)).rejects.toThrow('no url');
  });

  it('FR-PAY-15 a query reads the session: paid, expired or still open', async () => {
    const s = { id: 'cs_test_1', client_reference_id: attempt.id, amount_total: 150000, currency: 'bdt', payment_intent: 'pi_1' };
    for (const [state, status] of [[{ payment_status: 'paid' }, 'succeeded'], [{ status: 'expired', payment_status: 'unpaid' }, 'failed'], [{ status: 'open', payment_status: 'unpaid' }, 'pending']] as const) {
      const r = await new StripeProvider('k', async () => ok({ ...s, ...state })).query(attempt);
      expect(r).toMatchObject({ status, amount: 150000n, currency: 'BDT', merchantReference: attempt.id, verifiedBy: 'query', providerTxnId: 'pi_1' });
    }
    expect((await new StripeProvider('k', async () => ok({ id: 'cs', url: 'u' })).redirectUrl(attempt))).toBe('u');
    const bare = await new StripeProvider('k', async () => ok({ id: 'cs' })).query({ ...attempt, providerPaymentId: null });
    expect(bare).toMatchObject({ amount: 0n, currency: '', merchantReference: '', providerTxnId: undefined });
  });

  it('SEC-PAY-03 only the checkout events become results', () => {
    const ev = (type: string) => Buffer.from(JSON.stringify({ id: 'evt', type, data: { object: { id: 'cs', client_reference_id: 'a', amount_total: 1, currency: 'bdt', payment_status: 'unpaid', status: 'complete' } } }));
    expect(StripeProvider.fromEvent(ev('customer.created'))).toBeNull();
    expect(StripeProvider.fromEvent(ev('checkout.session.async_payment_failed'))!.status).toBe('failed');
    expect(StripeProvider.fromEvent(ev('checkout.session.completed'))).toMatchObject({ eventId: 'evt', verifiedBy: 'signature', status: 'pending' });
    expect(formEncode({ 'a[b]': 'x y', n: 1 })).toBe('a%5Bb%5D=x%20y&n=1');
  });
});

describe('MockProvider and the signed state (C-2)', () => {
  it('FR-PAY-02 the mock records the amount, takes one decision, and answers queries from its own record', async () => {
    const redis = fakeRedis();
    const p = new MockProvider('bkash', redis as unknown as Redis, (id) => `https://tb/mock/${id}`);
    const a = { ...attempt, provider: 'bkash' as const };
    expect(await p.createPayment(a)).toEqual({ providerPaymentId: `mock_bkash_${a.id}`, redirectUrl: `https://tb/mock/${a.id}` });
    expect(await p.redirectUrl(a)).toBe(`https://tb/mock/${a.id}`);
    expect((await p.query(a)).status).toBe('pending');
    expect(await MockProvider.decide(redis as unknown as Redis, a.id, 'succeeded')).toBe(true);
    expect(await MockProvider.decide(redis as unknown as Redis, a.id, 'failed')).toBe(false); // decided once
    expect(await p.query(a)).toMatchObject({ status: 'succeeded', amount: 150000n, eventId: `mock:${a.id}:succeeded`, providerTxnId: expect.any(String) });
    expect(await MockProvider.decide(redis as unknown as Redis, 'unknown', 'failed')).toBe(false);
    redis.store.delete(mockKey(a.id));
    expect((await p.query(a)).status).toBe('failed'); // the provider has no such payment
  });

  it('FR-PAY-02 the state is an HMAC of the attempt: another attempt\'s state does not fit', () => {
    const s = signState('key', 'a1');
    expect(stateValid('key', 'a1', s)).toBe(true);
    expect(stateValid('key', 'a2', s)).toBe(false);
    expect(stateValid('key', 'a1', undefined)).toBe(false);
  });

  it('C-2 mock mode simulates all three providers; sandbox mode uses Stripe test mode only', () => {
    const base = { publicOrigin: 'https://tb', secrets: { callbackStateKey: new Secret('CALLBACK_STATE_KEY', 'k') } };
    const mock = buildProviders({ ...base, paymentMode: 'mock', providers: {} } as unknown as TbConfig, fakeRedis() as unknown as Redis);
    expect(Object.keys(mock).sort()).toEqual(['bkash', 'nagad', 'stripe']);
    const sandbox = buildProviders({ ...base, paymentMode: 'sandbox', providers: { stripeSecretKey: new Secret('STRIPE_SECRET_KEY', 'sk_test_x') } } as unknown as TbConfig, fakeRedis() as unknown as Redis);
    expect(Object.keys(sandbox)).toEqual(['stripe']);
    expect(buildProviders({ ...base, paymentMode: 'sandbox', providers: {} } as unknown as TbConfig, fakeRedis() as unknown as Redis)).toEqual({});
  });
});
