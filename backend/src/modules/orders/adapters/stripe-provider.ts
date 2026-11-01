import { createHmac, timingSafeEqual } from 'crypto';
import type { AttemptRef, PaymentProvider, VerifiedResult } from './payment-provider';
import { ProviderUnavailable } from './payment-provider';

// Stripe Checkout in test mode (docs/design/02_orders_payments.pdf section 3.2; SEC-PAY-01, 03, 04, 07).
// The card form is entirely on Stripe's hosted page, reached by redirect (SAQ A). A session carries the
// attempt id as client_reference_id, and every API call sends the attempt's idempotency key, so a retry
// after a timeout cannot create a second session. Confirmation is the checkout.session.completed webhook,
// verified with the Stripe-Signature header within the CP-32 tolerance (verifyStripeSignature).
const API = 'https://api.stripe.com/v1';

export type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

interface Session {
  id: string;
  url?: string | null;
  client_reference_id?: string | null;
  amount_total?: number | null;
  currency?: string | null;
  payment_status?: string;
  status?: string;
  payment_intent?: string | null;
}

/** application/x-www-form-urlencoded with Stripe's bracket notation for nested fields. */
export function formEncode(fields: Record<string, string | number>): string {
  return Object.entries(fields).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
}

export class StripeSignatureError extends Error {}

/**
 * SEC-PAY-03: the header is "t=<seconds>,v1=<hex>[,v1=...]"; the signature is HMAC-SHA256 of "<t>.<raw body>"
 * with the endpoint's signing secret. Refused when no v1 matches or the time is outside the tolerance.
 */
export function verifyStripeSignature(rawBody: Buffer, header: string | undefined, secret: string, toleranceSeconds: number, nowSeconds: number): void {
  if (!header) throw new StripeSignatureError('no signature');
  const parts = header.split(',').map((p) => p.split('='));
  const t = Number(parts.find(([k]) => k === 't')?.[1]);
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!Number.isInteger(t) || sigs.length === 0) throw new StripeSignatureError('malformed signature header');
  if (Math.abs(nowSeconds - t) > toleranceSeconds) throw new StripeSignatureError('timestamp outside the tolerance');
  const expected = createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest();
  const ok = sigs.some((s) => /^[0-9a-f]{64}$/.test(s) && timingSafeEqual(Buffer.from(s, 'hex'), expected));
  if (!ok) throw new StripeSignatureError('signature does not match');
}

const fromSession = (s: Session, eventId: string, eventType: string, verifiedBy: 'signature' | 'query', payload: string): VerifiedResult => ({
  eventId,
  eventType,
  providerPaymentId: s.id,
  providerTxnId: s.payment_intent ?? undefined,
  status: s.payment_status === 'paid' ? 'succeeded' : s.status === 'expired' ? 'failed' : 'pending',
  amount: BigInt(s.amount_total ?? 0),
  currency: (s.currency ?? '').toUpperCase(),
  merchantReference: s.client_reference_id ?? '',
  verifiedBy,
  payload,
});

export class StripeProvider implements PaymentProvider {
  readonly id = 'stripe' as const;
  readonly confirmation = 'webhook' as const;

  constructor(
    private readonly secretKey: string,
    private readonly fetch: Fetch,
  ) {}

  private async call(method: 'GET' | 'POST', path: string, idempotencyKey?: string, body?: string): Promise<Session> {
    let res;
    try {
      res = await this.fetch(`${API}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.secretKey}`,
          ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
          ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
        },
        body,
      });
    } catch (err) {
      throw new ProviderUnavailable(`stripe unreachable: ${(err as Error).message}`);
    }
    if (!res.ok) throw new ProviderUnavailable(`stripe answered ${res.status}`);
    return (await res.json()) as Session;
  }

  async createPayment(a: AttemptRef, urls: { returnUrl: string; cancelUrl: string; title: string }) {
    const s = await this.call(
      'POST',
      '/checkout/sessions',
      a.idempotencyKey,
      formEncode({
        mode: 'payment',
        client_reference_id: a.id,
        'metadata[attempt_id]': a.id,
        'metadata[order_id]': a.orderId,
        'line_items[0][quantity]': 1,
        'line_items[0][price_data][currency]': 'bdt',
        'line_items[0][price_data][unit_amount]': a.amount.toString(), // poisha: BDT has two decimals
        'line_items[0][price_data][product_data][name]': urls.title.slice(0, 120),
        success_url: urls.returnUrl,
        cancel_url: urls.cancelUrl,
        expires_at: Math.floor(a.expiresAt.getTime() / 1000), // at least 30 minutes ahead (Stripe's minimum; PaymentService)
      }),
    );
    if (!s.url) throw new ProviderUnavailable('stripe returned no checkout url');
    return { providerPaymentId: s.id, redirectUrl: s.url };
  }

  async redirectUrl(a: AttemptRef): Promise<string> {
    const s = await this.call('GET', `/checkout/sessions/${encodeURIComponent(a.providerPaymentId ?? '')}`);
    if (!s.url) throw new ProviderUnavailable('the checkout session has no url any more');
    return s.url;
  }

  async query(a: AttemptRef): Promise<VerifiedResult> {
    const s = await this.call('GET', `/checkout/sessions/${encodeURIComponent(a.providerPaymentId ?? '')}`);
    return fromSession(s, `query:${s.id}:${s.payment_status ?? s.status}`, 'checkout.session.query', 'query', JSON.stringify(s));
  }

  /** FR-PAY-12: Stripe's refunds API on the payment intent, with the refund's idempotency key. */
  async refund(r: { providerTxnId: string | null; amount: bigint; idempotencyKey: string }): Promise<{ status: 'succeeded' | 'pending' | 'unsupported'; providerRefundId?: string }> {
    if (!r.providerTxnId) return { status: 'unsupported' }; // no payment intent to refund: an operator handles it
    const res = (await this.call('POST', '/refunds', r.idempotencyKey, formEncode({ payment_intent: r.providerTxnId, amount: r.amount.toString() }))) as unknown as { id: string; status: string };
    if (res.status === 'failed' || res.status === 'canceled') throw new ProviderUnavailable(`stripe refund ${res.status}`);
    return { status: res.status === 'succeeded' ? 'succeeded' : 'pending', providerRefundId: res.id };
  }

  /** Reconciliation: a pending Stripe refund's current status. */
  async queryRefund(providerRefundId: string): Promise<'succeeded' | 'pending' | 'failed'> {
    const res = (await this.call('GET', `/refunds/${encodeURIComponent(providerRefundId)}`)) as unknown as { status: string };
    return res.status === 'succeeded' ? 'succeeded' : res.status === 'failed' || res.status === 'canceled' ? 'failed' : 'pending';
  }

  /** A verified webhook event as a result; null for event types this unit does not act on. */
  static fromEvent(raw: Buffer): VerifiedResult | null {
    const e = JSON.parse(raw.toString('utf8')) as { id: string; type: string; data: { object: Session } };
    if (e.type !== 'checkout.session.completed' && e.type !== 'checkout.session.async_payment_succeeded'
        && e.type !== 'checkout.session.async_payment_failed' && e.type !== 'checkout.session.expired') return null;
    const r = fromSession(e.data.object, e.id, e.type, 'signature', raw.toString('utf8'));
    if (e.type === 'checkout.session.async_payment_failed') r.status = 'failed';
    return r;
  }
}
