import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { CLOCK, Clock } from '../../../kernel/clock';
import { TbConfig } from '../../../kernel/config/config';
import { TB_CONFIG } from '../../../kernel/config/config.provider';
import { CONFIG_PORT, ConfigPort } from '../../../kernel/config-port';
import { IdempotencyKeys } from '../../../kernel/http/idempotency';
import { Problem } from '../../../kernel/http/problems';
import { AUDIT_SERVICE, AuditServicePort } from '../../identity/ports';
import type { ListingSnapshot } from '../../listings/ports';
import { signState, stateValid } from '../adapters/callback-state';
import { AttemptRef, PaymentProvider, ProviderId, ProviderUnavailable, VerifiedResult } from '../adapters/payment-provider';
import { Escrow, EscrowHistory, JournalEntry, JournalLine, Order, OrdersOutboxEvent, PaymentAttempt, ReconciliationIssue, Refund } from '../db/entities';

// Payment (docs/design/02_orders_payments.pdf sections 5.5 and 7.1; FR-PAY-01 to FR-PAY-05, SEC-PAY-03 to 07).
//
// start: the attempt (amount = the order's total, never the client's) and its idempotency key are committed
// before the provider is called (SEC-PAY-07); the first attempt extends the checkout hold once, to its own
// expiry (DV-11). The provider's page takes the PIN, OTP or card; nothing of it reaches this server.
//
// confirm: every route ends here with a VerifiedResult, a signed webhook or the provider's own answer to a
// query, never the browser's word. The event is recorded first in payments.provider_events, whose unique key
// makes a replay a no-op (SEC-PAY-04). Then one transaction locks the order and the attempt (DC-14) and, if
// the payment matches (amount, BDT, reference: FR-PAY-03), marks the order paid with its fulfilment deadline,
// holds the money in escrow, posts the journal entry and writes orders.order.paid (I-19) and the audit entry.
// A mismatched, late or duplicate payment is accepted as money in and owed straight back: the attempt is
// succeeded_rejected or succeeded_duplicate, a full refund is created (U2-05 sends it), and an issue raised
// for the operators where the design asks for one.
export const PAYMENT_PROVIDERS = Symbol('PAYMENT_PROVIDERS');
export type ProviderRegistry = Partial<Record<ProviderId, PaymentProvider>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ATTEMPT_LIFETIME_MS = 15 * 60_000; // DV-11
const STRIPE_MIN_SESSION_MS = 31 * 60_000; // Stripe Checkout sessions last at least 30 minutes (Decisions log, U2-03)
const FULFILMENT: Record<string, { step: 'meetup_handover' | 'courier_pickup' | 'credentials_delivered'; cp: string }> = {
  self_pickup: { step: 'meetup_handover', cp: 'CP-15' },
  courier: { step: 'courier_pickup', cp: 'CP-16' },
  game_account: { step: 'credentials_delivered', cp: 'CP-22' },
};

export type Outcome = 'paid' | 'failed' | 'pending' | 'rejected' | 'duplicate' | 'late' | 'already-processed' | 'no-change';

@Injectable()
export class PaymentService {
  private readonly log = new Logger('PaymentService');

  constructor(
    private readonly db: DataSource,
    private readonly idempotency: IdempotencyKeys,
    @Inject(PAYMENT_PROVIDERS) private readonly providers: ProviderRegistry,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditServicePort,
    @Inject(CONFIG_PORT) private readonly params: ConfigPort,
    @Inject(TB_CONFIG) private readonly config: TbConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // ---------------------------------------------------------------- start (FR-PAY-01)

  async start(buyerId: string, orderId: string, provider: ProviderId, idempotencyKey: string | undefined) {
    const adapter = this.providers[provider];
    if (!adapter) throw new Problem('feature-off', { errors: [{ field: 'provider', reason: 'not-available-in-this-mode' }] }); // bKash, Nagad: U2-09
    const { id } = await this.idempotency.once('payment', buyerId, idempotencyKey, async () => {
      const attempt = await this.db.transaction(async (m) => {
        const o = await m.getRepository(Order).findOne({ where: { id: orderId }, lock: { mode: 'pessimistic_write' } });
        if (!o || (o.buyerId !== buyerId && o.sellerId !== buyerId)) throw new Problem('not-found');
        if (o.buyerId !== buyerId) throw new Problem('forbidden');
        const now = this.clock.now();
        if (o.status !== 'awaiting_payment' || o.paymentDueAt <= now) throw new Problem('order-state');
        if (!o.fulfilment) throw new Problem('order-state', { errors: [{ field: 'fulfilment', reason: 'choose-before-paying' }] });
        const earlier = await m.getRepository(PaymentAttempt).countBy({ orderId });
        const expiresAt = new Date(now.getTime() + (provider === 'stripe' && adapter.confirmation === 'webhook' ? STRIPE_MIN_SESSION_MS : ATTEMPT_LIFETIME_MS));
        const { identifiers } = await m.getRepository(PaymentAttempt).insert({
          purpose: 'order', orderId, payerId: buyerId, provider, amount: o.total, expiresAt,
        });
        // DV-11: the first attempt extends the hold once, so a buyer on the provider's page is not cancelled
        if (earlier === 0 && expiresAt > o.paymentDueAt) await m.getRepository(Order).update({ id: orderId }, { paymentDueAt: expiresAt });
        return m.getRepository(PaymentAttempt).findOneByOrFail({ id: identifiers[0].id as string });
      });
      // the attempt and its idempotency key are committed before the provider is called (SEC-PAY-07)
      const order = await this.db.getRepository(Order).findOneByOrFail({ id: orderId });
      try {
        const r = await adapter.createPayment(this.ref(attempt), {
          ...this.urls(orderId, attempt.id, provider),
          title: `TrustBazaar order: ${(order.listingSnapshot as ListingSnapshot).title}`,
        });
        await this.db.getRepository(PaymentAttempt).update({ id: attempt.id }, { providerPaymentId: r.providerPaymentId, status: 'redirected' });
      } catch (err) {
        if (!(err instanceof ProviderUnavailable)) throw err;
        this.log.warn(`payment attempt ${attempt.id}: ${err.message}`);
        await this.db.getRepository(PaymentAttempt).update({ id: attempt.id }, { status: 'failed', failureCode: 'provider_unavailable' });
        throw new Problem('provider-unavailable', { retryAfter: 30 });
      }
      return attempt.id;
    });
    const a = await this.db.getRepository(PaymentAttempt).findOneByOrFail({ id });
    if (a.status !== 'redirected') throw new Problem('order-state', { errors: [{ field: 'attempt', reason: a.status }] });
    return { attemptId: a.id, provider: a.provider, amount: a.amount, expiresAt: a.expiresAt.toISOString(), redirectUrl: await this.providers[a.provider]!.redirectUrl(this.ref(a)) };
  }

  // ---------------------------------------------------------------- the routes into confirm

  /** bKash, Nagad and the mock: the browser comes back; its parameters are ignored and the provider asked (section 7.1). */
  async callback(provider: ProviderId, attemptId: string, state: string | undefined): Promise<{ orderId: string; outcome: Outcome }> {
    this.checkState(attemptId, state);
    const a = await this.db.getRepository(PaymentAttempt).findOneBy({ id: attemptId });
    const adapter = this.providers[provider];
    if (!a || a.provider !== provider || !adapter || adapter.confirmation !== 'callback') throw new Problem('not-found');
    const result = await adapter.query(this.ref(a));
    return { orderId: a.orderId!, outcome: await this.confirm(provider, result) };
  }

  /** Reconciliation and the expiry job (U2-07) ask the provider about an attempt in flight. */
  async reconcile(attemptId: string): Promise<Outcome> {
    const a = await this.db.getRepository(PaymentAttempt).findOneByOrFail({ id: attemptId });
    return this.confirm(a.provider, await this.providers[a.provider]!.query(this.ref(a)));
  }

  /** GET /payments/return: the status only; it never confirms anything (FR-PAY-02). */
  async status(attemptId: string): Promise<{ status: string }> {
    const a = await this.db.getRepository(PaymentAttempt).findOneBy({ id: attemptId });
    if (!a) throw new Problem('not-found');
    return { status: a.status };
  }

  /** The signed state in a callback URL (adapters/callback-state.ts). */
  signState(attemptId: string): string {
    return signState(this.config.secrets.callbackStateKey.reveal(), attemptId);
  }

  checkState(attemptId: string, state: string | undefined): void {
    if (!stateValid(this.config.secrets.callbackStateKey.reveal(), attemptId, state)) throw new Problem('link-invalid');
  }

  /** The mock provider's page (mock mode only): what it is asked to collect, and whether it is still open. */
  async mockAttempt(attemptId: string, state: string | undefined) {
    if (this.config.paymentMode !== 'mock') throw new Problem('not-found');
    this.checkState(attemptId, state);
    const a = await this.db.getRepository(PaymentAttempt).findOneBy({ id: attemptId });
    if (!a) throw new Problem('not-found');
    return { provider: a.provider, amount: a.amount, status: a.status, callbackUrl: this.urls(a.orderId!, a.id, a.provider).callbackUrl };
  }

  // ---------------------------------------------------------------- confirmation (FR-PAY-02 to FR-PAY-05)

  async confirm(provider: ProviderId, r: VerifiedResult): Promise<Outcome> {
    // the attempt named by the reference (= its id), else by the provider's payment id
    const repo = this.db.getRepository(PaymentAttempt);
    const byPaymentId =
      (UUID.test(r.merchantReference) ? await repo.findOneBy({ id: r.merchantReference }) : null) ??
      (r.providerPaymentId ? await repo.findOneBy({ provider, providerPaymentId: r.providerPaymentId }) : null);
    // SEC-PAY-04: the event first; a replay is a unique violation and has no effect
    const recorded: { id: string }[] = await this.db.query(
      `INSERT INTO payments.provider_events (provider, event_id, event_type, verified_by, attempt_id, payload_sha256)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (provider, event_id) DO NOTHING RETURNING id::text`,
      [provider, r.eventId, r.eventType, r.verifiedBy, byPaymentId?.id ?? null, createHash('sha256').update(r.payload).digest()],
    );
    if (recorded.length === 0) return 'already-processed';
    if (!byPaymentId || byPaymentId.provider !== provider) {
      await this.raise(this.db.manager, 'provider_disagrees', null, null, { provider, eventId: r.eventId, reference: r.merchantReference });
      await this.processed(recorded[0].id);
      return 'no-change';
    }
    const outcome = await this.db.transaction((m) => this.apply(m, byPaymentId.id, provider, r));
    await this.processed(recorded[0].id);
    return outcome;
  }

  private async apply(m: EntityManager, attemptId: string, provider: ProviderId, r: VerifiedResult): Promise<Outcome> {
    const pre = await m.getRepository(PaymentAttempt).findOneByOrFail({ id: attemptId });
    // DC-14: the order before the attempt
    const o = await m.getRepository(Order).findOne({ where: { id: pre.orderId! }, lock: { mode: 'pessimistic_write' } });
    const a = await m.getRepository(PaymentAttempt).findOne({ where: { id: attemptId }, lock: { mode: 'pessimistic_write' } });
    if (!o || !a) throw new Error(`attempt ${attemptId} lost its order`);
    if (a.status === 'succeeded' || a.status === 'succeeded_duplicate' || a.status === 'succeeded_rejected') return 'no-change'; // another event did it
    if (r.status === 'pending') return 'pending';
    const now = this.clock.now();
    if (r.status === 'failed') {
      if (a.status === 'created' || a.status === 'redirected') await m.getRepository(PaymentAttempt).update({ id: a.id }, { status: 'failed', failureCode: r.eventType.slice(0, 60) });
      return 'failed';
    }
    const ids = { providerPaymentId: r.providerPaymentId, providerTxnId: r.providerTxnId ?? null };
    // FR-PAY-03: the verified payment must be the one this attempt asked for
    const mismatch = r.amount !== BigInt(a.amount) || r.currency !== 'BDT' || r.merchantReference !== a.id;
    if (mismatch || o.status !== 'awaiting_payment') {
      const kind = mismatch ? 'amount_mismatch' : o.status === 'paid' || o.status === 'closed' ? 'duplicate_payment' : 'late_payment';
      const status = kind === 'duplicate_payment' ? 'succeeded_duplicate' : 'succeeded_rejected';
      await m.getRepository(PaymentAttempt).update({ id: a.id }, { ...ids, status, confirmedAt: now });
      const back = r.amount < BigInt(a.amount) ? r.amount : BigInt(a.amount); // never more than this attempt (refund cap)
      if (back > 0n) {
        const { identifiers } = await m.getRepository(Refund).insert({ attemptId: a.id, orderId: o.id, amount: back.toString(), reason: kind });
        // money in, owed straight back (section 4.3)
        await this.journal(m, 'payment_received', o.id, a.id, `${kind}: owed back`, [
          ['provider_clearing', null, back], ['buyer_refund_payable', o.buyerId, -back],
        ]);
        if (kind !== 'duplicate_payment') {
          await this.raise(m, kind, o.id, a.id, { verifiedAmount: r.amount.toString(), attemptAmount: a.amount, currency: r.currency, reference: r.merchantReference, refundId: identifiers[0].id, orderStatus: o.status });
        }
      }
      await this.audit.record({ actorType: 'provider', action: `payments.attempt.${status}`, objectType: 'payment_attempt', objectId: a.id, after: { kind, amount: r.amount.toString() } }, m);
      return kind === 'duplicate_payment' ? 'duplicate' : kind === 'late_payment' ? 'late' : 'rejected';
    }

    // the order is paid
    const values = await this.params.atVersion(o.paramsVersion); // FR-OPS-08: the order's own parameter version
    const f = FULFILMENT[o.fulfilment!];
    const due = new Date(now.getTime() + values.ms(f.cp));
    await m.getRepository(PaymentAttempt).update({ id: a.id }, { ...ids, status: 'succeeded', confirmedAt: now });
    await m.getRepository(Order).update({ id: o.id }, { status: 'paid', paidAt: now, fulfilmentStep: f.step, fulfilmentDueAt: due });
    await m.getRepository(Escrow).insert({ orderId: o.id, releasePolicy: o.itemKind === 'game_account' ? 'game_protection' : 'standard', amountCollected: o.total });
    await m.getRepository(EscrowHistory).insert({ orderId: o.id, fromState: null, toState: 'held', actorType: 'provider', reason: `payment ${a.id} confirmed by ${r.verifiedBy}`, relatedId: a.id });
    const total = BigInt(o.total);
    await this.journal(m, 'payment_received', o.id, a.id, `payment ${provider}`, [['provider_clearing', null, total], ['escrow_liability', o.id, -total]]);
    await m.getRepository(OrdersOutboxEvent).insert({
      eventType: 'orders.order.paid', aggregateId: o.id,
      // I-19 (Delivery), U3-02 (Listings: listingId and quantity), Unit 5 and Notifications
      payload: {
        orderId: o.id, kind: o.kind, itemKind: o.itemKind, listingId: o.listingId, quantity: o.quantity, buyerId: o.buyerId, sellerId: o.sellerId,
        fulfilment: o.fulfilment, fulfilmentStep: f.step, fulfilmentDueAt: due.toISOString(), deliveryQuoteId: o.deliveryQuoteId, total: o.total,
      },
    });
    await this.audit.record({ actorType: 'provider', action: 'orders.order.paid', objectType: 'order', objectId: o.id, after: { attemptId: a.id, provider, total: o.total, verifiedBy: r.verifiedBy } }, m);
    return 'paid';
  }

  // ---------------------------------------------------------------- helpers

  private async journal(m: EntityManager, kind: 'payment_received', orderId: string, sourceId: string, memo: string, lines: [string, string | null, bigint][]) {
    const { identifiers } = await m.getRepository(JournalEntry).insert({ kind, orderId, sourceId, memo });
    for (const [accountCode, partyId, amount] of lines) {
      await m.getRepository(JournalLine).insert({ entryId: identifiers[0].id as string, accountCode, partyId, amount: amount.toString() });
    }
  }

  private raise(m: EntityManager, kind: string, orderId: string | null, attemptId: string | null, detail: Record<string, unknown>) {
    return m.getRepository(ReconciliationIssue).insert({ kind, orderId, attemptId, detail });
  }

  private processed(eventRowId: string) {
    return this.db.query(`UPDATE payments.provider_events SET processed_at = now() WHERE id = $1`, [eventRowId]);
  }

  private ref(a: PaymentAttempt): AttemptRef {
    return { id: a.id, provider: a.provider, orderId: a.orderId!, amount: BigInt(a.amount), idempotencyKey: a.idempotencyKey, providerPaymentId: a.providerPaymentId, expiresAt: a.expiresAt };
  }

  private urls(orderId: string, attemptId: string, provider: ProviderId) {
    const back = `${this.config.publicOrigin}/orders/${orderId}?payment=${attemptId}`;
    return {
      returnUrl: back,
      cancelUrl: `${back}&cancelled=1`,
      callbackUrl: `${this.config.publicOrigin}/api/v1/callbacks/${provider}/${attemptId}?state=${this.signState(attemptId)}`,
    };
  }
}
