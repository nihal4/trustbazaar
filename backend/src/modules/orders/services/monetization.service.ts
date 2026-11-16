import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { CLOCK, Clock } from '../../../kernel/clock';
import { CONFIG_PORT, ConfigPort } from '../../../kernel/config-port';
import { IdempotencyKeys } from '../../../kernel/http/idempotency';
import { JobRunner } from '../../../kernel/jobs/job-runner';
import { Problem } from '../../../kernel/http/problems';
import { AUDIT_SERVICE, AuditServicePort } from '../../identity/ports';
import { LISTINGS_PORT, ListingsPort } from '../../listings/ports';
import type { ProviderId } from '../adapters/payment-provider';
import { FeaturedPurchase, OrdersOutboxEvent, PaymentAttempt } from '../db/entities';
import { PAYMENT_PROVIDERS, PaymentService, ProviderRegistry, SubjectHandler } from './payment.service';

// MonetizationService (docs/design/02_orders_payments.pdf section 5.14; FR-MON-05; U2-06). This part: featured
// listings. Pro Seller subscriptions and ProStatusQuery follow in the third part.
//  - POST /listings/{id}/feature: the seller of an active listing buys a CP-37 period (24 or 48 hours). CP-37's
//    fee_poisha is the price of 24 hours, 48 hours cost twice that (Decisions log); while it is null the purchase
//    answers feature-off. The purchase and its featured_listing attempt are committed before the provider is called,
//    as for an order (SEC-PAY-07), and a repeat with the same Idempotency-Key gives the same attempt (I-52).
//  - Confirmation (PaymentService.applySubject, a SubjectHandler registered here): the period starts now, or when
//    the listing's current period ends, so two purchases run one after the other. payments.featured.started tells
//    Listings to show the label. A purchase for a listing no longer active, or one already started, is refunded.
//  - The monetization job (every 5 minutes): periods past their end are marked ended_at with
//    payments.featured.ended, once each; attempts past their expiry are asked of the provider, then expired.

export const FEATURE_HOURS = [24, 48] as const;
const ATTEMPT_LIFETIME_MS = 15 * 60_000; // DV-11
const STRIPE_MIN_SESSION_MS = 31 * 60_000; // as for orders (Decisions log, U2-03)
const BATCH = 200;

type Cp37 = { periods: string[]; fee_poisha: number | null };

@Injectable()
export class MonetizationService implements OnModuleInit {
  private readonly log = new Logger('MonetizationService');

  constructor(
    private readonly db: DataSource,
    private readonly payments: PaymentService,
    private readonly idempotency: IdempotencyKeys,
    @Inject(PAYMENT_PROVIDERS) private readonly providers: ProviderRegistry,
    @Inject(LISTINGS_PORT) private readonly listings: ListingsPort,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditServicePort,
    @Inject(CONFIG_PORT) private readonly params: ConfigPort,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly jobs: JobRunner,
  ) {}

  onModuleInit(): void {
    this.payments.registerSubject('featured_listing', this.startFeatured);
    // section 5.13: end featured periods; process renewals and lapses (the third part adds those)
    this.jobs.register({ name: 'payments.monetization', intervalMs: 5 * 60_000, run: async () => (await this.endFeatured()) + (await this.expireAttempts()) });
  }

  // ---------------------------------------------------------------- featured listings (FR-MON-05)

  /** The CP-37 fee of a period, or null while the parameter has no fee. */
  async featureFee(hours: number): Promise<bigint | null> {
    const cp = (await this.params.current()).get<Cp37>('CP-37');
    if (!cp.periods.includes(`${hours} hours`)) throw new Problem('validation-failed', { errors: [{ field: 'hours', reason: 'not-a-cp-37-period' }] });
    return cp.fee_poisha === null ? null : (BigInt(cp.fee_poisha) * BigInt(hours)) / 24n;
  }

  /** POST /listings/{id}/feature. */
  async feature(sellerId: string, listingId: string, hours: number, provider: ProviderId, idempotencyKey: string | undefined) {
    if (!this.providers[provider]) throw new Problem('feature-off', { errors: [{ field: 'provider', reason: 'not-available-in-this-mode' }] });
    const fee = await this.featureFee(hours);
    if (fee === null || fee <= 0n) throw new Problem('feature-off', { errors: [{ field: 'hours', reason: 'featured-fee-not-set' }] });
    const { id } = await this.idempotency.once('feature', sellerId, idempotencyKey, async () => {
      const { attempt, title } = await this.db.transaction(async (m) => {
        const l = await this.listings.snapshot(listingId, m);
        if (l.sellerId !== sellerId) throw new Problem('not-found');
        if (l.status !== 'active') throw new Problem('listing-state', { errors: [{ field: 'listing', reason: 'not-active' }] });
        const now = this.clock.now();
        const { identifiers: [p] } = await m.getRepository(FeaturedPurchase).insert({ listingId, sellerId, hours, fee: fee.toString() });
        const { identifiers: [a] } = await m.getRepository(PaymentAttempt).insert({
          purpose: 'featured_listing', subjectId: p.id as string, payerId: sellerId, provider, amount: fee.toString(), expiresAt: this.expiry(provider, now),
        });
        await m.getRepository(FeaturedPurchase).update({ id: p.id as string }, { attemptId: a.id as string });
        return { attempt: await m.getRepository(PaymentAttempt).findOneByOrFail({ id: a.id as string }), title: l.title };
      });
      await this.payments.openAttempt(attempt, `TrustBazaar featured listing, ${hours} hours: ${title}`);
      return attempt.id;
    });
    const a = await this.db.getRepository(PaymentAttempt).findOneByOrFail({ id });
    if (a.payerId !== sellerId || a.purpose !== 'featured_listing') throw new Problem('validation-failed', { errors: [{ field: 'Idempotency-Key', reason: 'reused' }] });
    return { purchaseId: a.subjectId, hours, ...(await this.payments.startView(id)) };
  }

  /** The SubjectHandler of featured_listing payments, in the confirming transaction (attempt locked). */
  readonly startFeatured: SubjectHandler = async (m, attempt, now) => {
    const p = await m.getRepository(FeaturedPurchase).findOne({ where: { id: attempt.subjectId! }, lock: { mode: 'pessimistic_write' } });
    if (!p) throw new Error(`featured purchase ${attempt.subjectId} missing`);
    if (p.startsAt) return { accepted: false, reason: 'already-started' };
    const l = await this.listings.snapshot(p.listingId, m).catch(() => null);
    if (!l || l.status !== 'active') return { accepted: false, reason: 'listing-not-active' };
    // a period already running (or queued) for the listing: this one follows it
    const [{ last }] = (await m.query(
      `SELECT max(ends_at) AS last FROM payments.featured_purchases WHERE listing_id = $1 AND ends_at > $2 AND id <> $3`,
      [p.listingId, now, p.id],
    )) as { last: Date | null }[];
    const startsAt = last && last > now ? last : now;
    const endsAt = new Date(startsAt.getTime() + p.hours * 3_600_000);
    await m.getRepository(FeaturedPurchase).update({ id: p.id }, { startsAt, endsAt });
    await m.getRepository(OrdersOutboxEvent).insert({
      eventType: 'payments.featured.started', aggregateId: p.id,
      payload: { purchaseId: p.id, listingId: p.listingId, sellerId: p.sellerId, hours: p.hours, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() },
    });
    await this.audit.record({ actorType: 'provider', action: 'payments.featured.started', objectType: 'listing', objectId: p.listingId, after: { purchaseId: p.id, hours: p.hours, startsAt, endsAt } }, m);
    return { accepted: true, account: 'revenue_featured', memo: `featured listing ${p.listingId}, ${p.hours} hours` };
  };

  /** The monetization job: end the periods past their end (payments.featured.ended, once each). */
  async endFeatured(): Promise<number> {
    const now = this.clock.now();
    const due = (await this.db.query(
      `SELECT id FROM payments.featured_purchases WHERE ends_at <= $1 AND ended_at IS NULL ORDER BY ends_at LIMIT ${BATCH}`,
      [now],
    )) as { id: string }[];
    let n = 0;
    for (const { id } of due) {
      const ended = await this.db.transaction(async (m: EntityManager) => {
        const rows = (await m.query(
          `SELECT id, listing_id, seller_id, ends_at FROM payments.featured_purchases WHERE id = $1 AND ended_at IS NULL AND ends_at <= $2 FOR UPDATE SKIP LOCKED`,
          [id, now],
        )) as { id: string; listing_id: string; seller_id: string; ends_at: Date }[];
        if (!rows.length) return false;
        const p = rows[0];
        await m.getRepository(FeaturedPurchase).update({ id }, { endedAt: now });
        await m.getRepository(OrdersOutboxEvent).insert({
          eventType: 'payments.featured.ended', aggregateId: id,
          payload: { purchaseId: id, listingId: p.listing_id, sellerId: p.seller_id, endsAt: p.ends_at.toISOString() },
        });
        return true;
      });
      if (ended) n++;
    }
    return n;
  }

  /**
   * The monetization job: featured-listing and subscription attempts past their expiry are asked of the provider
   * first, so a payment that succeeded without a callback is confirmed; what is still in flight then expires.
   */
  async expireAttempts(): Promise<number> {
    const due = (await this.db.query(
      `SELECT id, provider FROM payments.attempts WHERE purpose <> 'order' AND status IN ('created', 'redirected') AND expires_at <= $1 ORDER BY expires_at LIMIT ${BATCH}`,
      [this.clock.now()],
    )) as { id: string; provider: ProviderId }[];
    let n = 0;
    for (const a of due) {
      if (!this.providers[a.provider]) continue; // no adapter in this mode: left for an operator
      try {
        await this.payments.reconcile(a.id);
      } catch (e) {
        this.log.warn(`attempt ${a.id} could not be queried: ${(e as Error).message}`);
        continue;
      }
      const [, count] = (await this.db.query(`UPDATE payments.attempts SET status = 'expired' WHERE id = $1 AND status IN ('created', 'redirected')`, [a.id])) as [unknown, number];
      n += count;
    }
    return n;
  }

  private expiry(provider: ProviderId, now: Date): Date {
    const stripeWebhook = provider === 'stripe' && this.providers.stripe?.confirmation === 'webhook';
    return new Date(now.getTime() + (stripeWebhook ? STRIPE_MIN_SESSION_MS : ATTEMPT_LIFETIME_MS));
  }
}
