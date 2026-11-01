import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { CLOCK, Clock } from '../../../kernel/clock';
import { AUDIT_SERVICE, AuditServicePort } from '../../identity/ports';
import { ProviderUnavailable } from '../adapters/payment-provider';
import { Order, OrdersOutboxEvent, PaymentAttempt, ReconciliationIssue, Refund } from '../db/entities';
import { post } from './ledger';
import { PAYMENT_PROVIDERS, ProviderRegistry } from './payment.service';

// The refund worker (docs/design/02_orders_payments.pdf sections 5.9 and 5.12; FR-PAY-12, FR-PAY-16, SEC-PAY-07).
// A refund row is created, with its own idempotency key and ledger entry, by the decision that causes it
// (EscrowService.settle, PaymentService for duplicate, late and mismatched payments). This sends it: one
// refund per transaction, taken with FOR UPDATE SKIP LOCKED so several instances never send the same one,
// to the provider of the original payment with the refund's idempotency key, so a retry after a timeout can
// never refund twice. Success posts "refund paid out"; a provider that takes it for later marks it sent; a
// failure is retried on the DV-13 schedule (8 attempts over about a day); then, or when the provider cannot
// refund at all, it becomes manual_required, an operator issue is raised and Notifications tells the buyer.
// U2-07 runs processDue every 30 seconds.
export const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000, 3_600_000, 3 * 3_600_000, 6 * 3_600_000, 12 * 3_600_000]; // DV-13
export const MAX_REFUND_ATTEMPTS = RETRY_DELAYS_MS.length;
const BATCH = 20;

export type RefundOutcome = 'succeeded' | 'sent' | 'retry' | 'manual_required';

@Injectable()
export class RefundService {
  private readonly log = new Logger('RefundService');

  constructor(
    private readonly db: DataSource,
    @Inject(PAYMENT_PROVIDERS) private readonly providers: ProviderRegistry,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditServicePort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Sends the refunds that are due; returns how each ended. */
  async processDue(): Promise<RefundOutcome[]> {
    const outcomes: RefundOutcome[] = [];
    for (let i = 0; i < BATCH; i++) {
      const outcome = await this.db.transaction(async (m) => {
        const [due] = (await m.query(
          `SELECT id FROM payments.refunds WHERE status IN ('pending', 'failed') AND next_attempt_at <= $1 ORDER BY next_attempt_at LIMIT 1 FOR UPDATE SKIP LOCKED`,
          [this.clock.now()],
        )) as { id: string }[];
        return due ? this.send(m, due.id) : null;
      });
      if (!outcome) break;
      outcomes.push(outcome);
    }
    return outcomes;
  }

  private async send(m: EntityManager, refundId: string): Promise<RefundOutcome> {
    const r = await m.getRepository(Refund).findOneByOrFail({ id: refundId });
    const a = await m.getRepository(PaymentAttempt).findOneByOrFail({ id: r.attemptId });
    const adapter = this.providers[a.provider];
    const now = this.clock.now();
    if (!adapter) return this.manual(m, r, 'manual_refund_required', `no ${a.provider} adapter in this payment mode`);
    let result;
    try {
      result = await adapter.refund({
        attempt: { id: a.id, provider: a.provider, orderId: a.orderId ?? '', amount: BigInt(a.amount), idempotencyKey: a.idempotencyKey, providerPaymentId: a.providerPaymentId, expiresAt: a.expiresAt },
        providerTxnId: a.providerTxnId, amount: BigInt(r.amount), idempotencyKey: r.idempotencyKey,
      });
    } catch (err) {
      if (!(err instanceof ProviderUnavailable)) throw err;
      const made = r.attemptsMade + 1;
      if (made >= MAX_REFUND_ATTEMPTS) return this.manual(m, r, 'refund_failed', err.message, made);
      await m.getRepository(Refund).update({ id: r.id }, { status: 'failed', attemptsMade: made, nextAttemptAt: new Date(now.getTime() + RETRY_DELAYS_MS[made - 1]) });
      this.log.warn(`refund ${r.id} attempt ${made} failed: ${err.message}`);
      return 'retry';
    }
    if (result.status === 'unsupported') return this.manual(m, r, 'manual_refund_required', `${a.provider} cannot refund this payment`);
    if (result.status === 'pending') {
      await m.getRepository(Refund).update({ id: r.id }, { status: 'sent', providerRefundId: result.providerRefundId ?? null, attemptsMade: r.attemptsMade + 1 });
      return 'sent'; // confirmed later by reconciliation (U2-07)
    }
    await m.getRepository(Refund).update({ id: r.id }, { status: 'succeeded', providerRefundId: result.providerRefundId ?? null, attemptsMade: r.attemptsMade + 1, completedAt: now });
    const buyer = r.orderId ? (await m.getRepository(Order).findOneBy({ id: r.orderId }))?.buyerId ?? a.payerId : a.payerId;
    await post(m, 'refund_paid', r.orderId, r.id, `refund ${r.reason} paid out by ${a.provider}`, [['buyer_refund_payable', buyer, BigInt(r.amount)], ['provider_clearing', null, -BigInt(r.amount)]]);
    await m.getRepository(OrdersOutboxEvent).insert({ eventType: 'payments.refund.succeeded', aggregateId: r.orderId ?? r.id, payload: { refundId: r.id, orderId: r.orderId, buyerId: buyer, amount: r.amount, reason: r.reason } });
    await this.audit.record({ actorType: 'system', action: 'payments.refund.succeeded', objectType: 'refund', objectId: r.id, after: { amount: r.amount, provider: a.provider } }, m);
    return 'succeeded';
  }

  /** FR-PAY-12: an operator takes over, and the buyer is told when to expect the money. */
  private async manual(m: EntityManager, r: Refund, kind: 'refund_failed' | 'manual_refund_required', detail: string, made = r.attemptsMade): Promise<RefundOutcome> {
    await m.getRepository(Refund).update({ id: r.id }, { status: 'manual_required', attemptsMade: made });
    await m.getRepository(ReconciliationIssue).insert({ kind, orderId: r.orderId, attemptId: r.attemptId, refundId: r.id, detail: { reason: r.reason, amount: r.amount, detail } });
    await m.getRepository(OrdersOutboxEvent).insert({ eventType: 'payments.refund.manual_required', aggregateId: r.orderId ?? r.id, payload: { refundId: r.id, orderId: r.orderId, amount: r.amount } });
    this.log.error(`refund ${r.id} needs an operator: ${detail}`);
    return 'manual_required';
  }
}
