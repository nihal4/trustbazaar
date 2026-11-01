import { randomUUID } from 'crypto';

// The payout adapter (docs/design/02_orders_payments.pdf section 3.2; FR-PAY-19, NFR-CMP-05). No
// disbursement sandbox is assumed (SRS OI-4): the simulated adapter records a reference and every payout
// is marked simulated. A real adapter replaces it behind the same interface, without other changes.
export interface PayoutDestination {
  kind: 'bkash_wallet' | 'nagad_wallet' | 'bank';
  walletE164: string | null;
  bankName: string | null;
  routingNumber: string | null;
  accountLast4: string | null;
}

export interface PayoutProvider {
  send(p: { payoutId: string; amount: bigint; destination: PayoutDestination; idempotencyKey: string }): Promise<{ status: 'sent' | 'failed'; ref?: string }>;
}

export const PAYOUT_PROVIDER = Symbol('PAYOUT_PROVIDER');

export class SimulatedPayoutProvider implements PayoutProvider {
  private readonly refs = new Map<string, string>();

  /** The same idempotency key gives the same reference, as a real provider would (SEC-PAY-07). */
  async send(p: { idempotencyKey: string }): Promise<{ status: 'sent'; ref: string }> {
    const ref = this.refs.get(p.idempotencyKey) ?? `simpayout_${randomUUID()}`;
    this.refs.set(p.idempotencyKey, ref);
    return { status: 'sent', ref };
  }
}
