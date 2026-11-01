// The payment provider adapters (docs/design/02_orders_payments.pdf section 3.2). The rest of the unit never
// sees a provider's own API: it starts a payment, and it accepts a payment only as a VerifiedResult, which an
// adapter produces from a signed webhook or from its own query to the provider, never from the browser.
export type ProviderId = 'bkash' | 'nagad' | 'stripe';

export interface AttemptRef {
  id: string; // also the merchant reference sent to the provider
  provider: ProviderId;
  orderId: string;
  amount: bigint; // poisha, computed on the server (SEC-PAY-06)
  idempotencyKey: string;
  providerPaymentId: string | null;
  expiresAt: Date;
}

export interface VerifiedResult {
  eventId: string; // the provider's event id, or a derived id for a query result (provider_events)
  eventType: string;
  providerPaymentId: string;
  providerTxnId?: string;
  status: 'succeeded' | 'failed' | 'pending';
  amount: bigint;
  currency: string;
  merchantReference: string; // = attempt id
  verifiedBy: 'signature' | 'query';
  payload: string; // what was verified, for its hash in provider_events
}

export interface PaymentProvider {
  readonly id: ProviderId;
  /** How confirmation arrives: a signed webhook (Stripe) or a browser callback followed by a query. */
  readonly confirmation: 'webhook' | 'callback';
  createPayment(a: AttemptRef, urls: { returnUrl: string; cancelUrl: string; callbackUrl: string; title: string }): Promise<{ providerPaymentId: string; redirectUrl: string }>;
  /** The provider's page again, for a repeated start request (I-52). */
  redirectUrl(a: AttemptRef): Promise<string>;
  /** Reconciliation, expiry checks and browser callbacks: the provider's own answer. */
  query(a: AttemptRef): Promise<VerifiedResult>;
  /**
   * FR-PAY-12: a refund to the original payment, with the refund's own idempotency key (SEC-PAY-07).
   * 'pending' means the provider accepted it and will confirm later; 'unsupported' sends it to an operator.
   * Throws ProviderUnavailable when the provider cannot be reached (retried by the worker).
   */
  refund(r: { attempt: AttemptRef; providerTxnId: string | null; amount: bigint; idempotencyKey: string }): Promise<{ status: 'succeeded' | 'pending' | 'unsupported'; providerRefundId?: string }>;
}

export class ProviderUnavailable extends Error {}
