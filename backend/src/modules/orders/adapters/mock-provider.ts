import type Redis from 'ioredis';
import type { AttemptRef, PaymentProvider, ProviderId, VerifiedResult } from './payment-provider';

// The simulated providers of PAYMENT_MODE=mock (C-2; Decisions log, U2-03). Each of bKash, Nagad and Stripe
// is played by this adapter: its "provider side" is a Redis record per attempt holding the amount it was
// asked to collect and the outcome the buyer chose on the mock payment page (MockPayController). Like the
// real ones, a browser callback is never trusted: the server asks the adapter, which reads its own record.
const TTL_SECONDS = 24 * 60 * 60;
export const mockKey = (attemptId: string) => `mockpay:${attemptId}`;

export interface MockRecord {
  amount: string;
  status: 'pending' | 'succeeded' | 'failed';
  /** Tests may make the provider report another amount (FR-PAY-03). */
  paidAmount?: string;
}

export class MockProvider implements PaymentProvider {
  readonly confirmation = 'callback' as const;

  constructor(
    readonly id: ProviderId,
    private readonly redis: Redis,
    private readonly pageUrl: (attemptId: string) => string,
  ) {}

  async createPayment(a: AttemptRef): Promise<{ providerPaymentId: string; redirectUrl: string }> {
    const record: MockRecord = { amount: a.amount.toString(), status: 'pending' };
    await this.redis.set(mockKey(a.id), JSON.stringify(record), 'EX', TTL_SECONDS, 'NX');
    return { providerPaymentId: `mock_${this.id}_${a.id}`, redirectUrl: this.pageUrl(a.id) };
  }

  async redirectUrl(a: AttemptRef): Promise<string> {
    return this.pageUrl(a.id);
  }

  async query(a: AttemptRef): Promise<VerifiedResult> {
    const raw = await this.redis.get(mockKey(a.id));
    const r: MockRecord = raw ? JSON.parse(raw) : { amount: a.amount.toString(), status: 'failed' };
    return {
      eventId: `mock:${a.id}:${r.status}`,
      eventType: `mock.payment.${r.status}`,
      providerPaymentId: `mock_${this.id}_${a.id}`,
      providerTxnId: r.status === 'succeeded' ? `mocktxn_${a.id.slice(0, 8)}` : undefined,
      status: r.status,
      amount: BigInt(r.paidAmount ?? r.amount),
      currency: 'BDT',
      merchantReference: a.id,
      verifiedBy: 'query',
      payload: raw ?? '{}',
    };
  }

  /** What the buyer did on the mock page; only a pending payment can be decided. */
  static async decide(redis: Redis, attemptId: string, outcome: 'succeeded' | 'failed'): Promise<boolean> {
    const raw = await redis.get(mockKey(attemptId));
    if (!raw) return false;
    const r = JSON.parse(raw) as MockRecord;
    if (r.status !== 'pending') return false;
    await redis.set(mockKey(attemptId), JSON.stringify({ ...r, status: outcome }), 'EX', TTL_SECONDS);
    return true;
  }
}
