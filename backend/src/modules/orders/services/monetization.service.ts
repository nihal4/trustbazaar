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
import { FeaturedPurchase, OrdersOutboxEvent, PaymentAttempt, Subscription } from '../db/entities';
import type { ProStatusQuery } from '../ports';
import { FailureHandler, PAYMENT_PROVIDERS, PaymentService, ProviderRegistry, SubjectHandler } from './payment.service';
import { randomUUID } from 'crypto';

// MonetizationService (docs/design/02_orders_payments.pdf section 5.14; FR-MON-02, FR-MON-05 to FR-MON-08; U2-06):
// featured listings, Pro Seller subscriptions, and ProStatusQuery ("is this seller Pro?").
//  - POST /listings/{id}/feature: the seller of an active listing buys a CP-37 period (24 or 48 hours). CP-37's
//    fee_poisha is the price of 24 hours, 48 hours cost twice that (Decisions log); while it is null the purchase
//    answers feature-off. The purchase and its featured_listing attempt are committed before the provider is called,
//    as for an order (SEC-PAY-07), and a repeat with the same Idempotency-Key gives the same attempt (I-52).
//  - Confirmation (PaymentService.applySubject, a SubjectHandler registered here): the period starts now, or when
//    the listing's current period ends, so two purchases run one after the other. payments.featured.started tells
//    Listings to show the label. A purchase for a listing no longer active, or one already started, is refunded.
//  - The monetization job (every 5 minutes): periods past their end are marked ended_at with
//    payments.featured.ended, once each; attempts past their expiry are asked of the provider, then expired.
//
// Pro Seller (Decisions log, 2026-11-17): every month is paid through a subscription attempt at CP-48's price, by card
// or wallet alike (agreed with the user; Stripe's recurring billing is left for later).
//  - POST /me/subscription: a first payment starts an active subscription for a month; paying again while it is
//    active or past due adds a month to its end (or to now, if later). Cancelling (DELETE) keeps Pro until the paid
//    month ends; subscribing again within it simply undoes the cancellation, without a payment.
//  - The job: an active subscription whose month ended unpaid becomes past_due (failed_renewals 1) and the seller is
//    reminded to pay; a second missed month, or a failed renewal payment, makes it lapsed (FR-MON-08).
//  - isPro: active, or cancelled with the paid month still running. A past-due seller is on standard terms until paying.
//    It is read when an order is created (FR-MON-02), at publication against CP-28 and for the Pro badge.

const ATTEMPT_LIFETIME_MS = 15 * 60_000; // DV-11
const STRIPE_MIN_SESSION_MS = 31 * 60_000; // as for orders (Decisions log, U2-03)
const BATCH = 200;

type Cp37 = { periods: string[]; fee_poisha: number | null };
type Cp48 = { monthly_poisha: number | null };

export interface SubscriptionView {
  id: string;
  status: Subscription['status'];
  provider: ProviderId;
  currentPeriodEnd: string;
  cancelledAt: string | null;
  failedRenewals: number;
}

/** The same day of the next month (UTC); the 31st of January gives the 3rd of March, as JavaScript counts. */
export const addMonth = (d: Date) => {
  const n = new Date(d);
  n.setUTCMonth(n.getUTCMonth() + 1);
  return n;
};
const view = (s: Subscription): SubscriptionView => ({
  id: s.id,
  status: s.status,
  provider: s.provider,
  currentPeriodEnd: s.currentPeriodEnd.toISOString(),
  cancelledAt: s.cancelledAt?.toISOString() ?? null,
  failedRenewals: s.failedRenewals,
});

@Injectable()
export class MonetizationService implements OnModuleInit, ProStatusQuery {
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

  /** Registers what the payment service needs to take money for featuring a listing and for a subscription. */
  onModuleInit(): void {
    this.payments.registerSubject('featured_listing', this.startFeatured);
    this.payments.registerSubject('subscription', this.paySubscription, this.renewalFailed);
    // section 5.13: end featured periods; process renewals and lapses
    this.jobs.register({
      name: 'payments.monetization',
      intervalMs: 5 * 60_000,
      run: async () => (await this.endFeatured()) + (await this.processSubscriptions()) + (await this.expireAttempts()),
    });
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
        const {
          identifiers: [p],
        } = await m.getRepository(FeaturedPurchase).insert({ listingId, sellerId, hours, fee: fee.toString() });
        const {
          identifiers: [a],
        } = await m.getRepository(PaymentAttempt).insert({
          purpose: 'featured_listing',
          subjectId: p.id as string,
          payerId: sellerId,
          provider,
          amount: fee.toString(),
          expiresAt: this.expiry(provider, now),
        });
        await m.getRepository(FeaturedPurchase).update({ id: p.id as string }, { attemptId: a.id as string });
        return { attempt: await m.getRepository(PaymentAttempt).findOneByOrFail({ id: a.id as string }), title: l.title };
      });
      await this.payments.openAttempt(attempt, `TrustBazaar featured listing, ${hours} hours: ${title}`);
      return attempt.id;
    });
    const a = await this.db.getRepository(PaymentAttempt).findOneByOrFail({ id });
    if (a.payerId !== sellerId || a.purpose !== 'featured_listing')
      throw new Problem('validation-failed', { errors: [{ field: 'Idempotency-Key', reason: 'reused' }] });
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
    const [{ last }] = (await m.query(`SELECT max(ends_at) AS last FROM payments.featured_purchases WHERE listing_id = $1 AND ends_at > $2 AND id <> $3`, [
      p.listingId,
      now,
      p.id,
    ])) as { last: Date | null }[];
    const startsAt = last && last > now ? last : now;
    const endsAt = new Date(startsAt.getTime() + p.hours * 3_600_000);
    await m.getRepository(FeaturedPurchase).update({ id: p.id }, { startsAt, endsAt });
    await m.getRepository(OrdersOutboxEvent).insert({
      eventType: 'payments.featured.started',
      aggregateId: p.id,
      payload: {
        purchaseId: p.id,
        listingId: p.listingId,
        sellerId: p.sellerId,
        hours: p.hours,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
      },
    });
    await this.audit.record(
      {
        actorType: 'provider',
        action: 'payments.featured.started',
        objectType: 'listing',
        objectId: p.listingId,
        after: { purchaseId: p.id, hours: p.hours, startsAt, endsAt },
      },
      m,
    );
    return { accepted: true, account: 'revenue_featured', memo: `featured listing ${p.listingId}, ${p.hours} hours` };
  };

  /** The monetization job: end the periods past their end (payments.featured.ended, once each). */
  async endFeatured(): Promise<number> {
    const now = this.clock.now();
    const due = (await this.db.query(`SELECT id FROM payments.featured_purchases WHERE ends_at <= $1 AND ended_at IS NULL ORDER BY ends_at LIMIT ${BATCH}`, [
      now,
    ])) as { id: string }[];
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
          eventType: 'payments.featured.ended',
          aggregateId: id,
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
      const [, count] = (await this.db.query(`UPDATE payments.attempts SET status = 'expired' WHERE id = $1 AND status IN ('created', 'redirected')`, [
        a.id,
      ])) as [unknown, number];
      n += count;
    }
    return n;
  }

  // ---------------------------------------------------------------- Pro Seller (FR-MON-02, FR-MON-06 to FR-MON-08)

  /** ProStatusQuery. */
  async isPro(userId: string, tx?: EntityManager): Promise<boolean> {
    const rows = (await (tx ?? this.db.manager).query(
      `SELECT 1 FROM payments.subscriptions WHERE user_id = $1 AND status IN ('active', 'cancelled') AND current_period_end > $2 LIMIT 1`,
      [userId, this.clock.now()],
    )) as unknown[];
    return rows.length > 0;
  }

  /** GET /me/subscription: the latest subscription, whether the user is Pro now, and the price of a month. */
  async mySubscription(userId: string) {
    const s = await this.db.getRepository(Subscription).findOne({ where: { userId }, order: { createdAt: 'DESC' } });
    const price = (await this.params.current()).get<Cp48>('CP-48').monthly_poisha;
    return { subscription: s ? view(s) : null, pro: await this.isPro(userId), monthlyPrice: price === null ? null : String(price) };
  }

  /** POST /me/subscription: pay a month (first or next), or undo a cancellation within the paid month. */
  async subscribe(
    userId: string,
    provider: ProviderId,
    idempotencyKey: string | undefined,
  ): Promise<
    | { resumed: true; subscription: SubscriptionView }
    | ({ resumed: false; subscriptionId: string; renewal: boolean } & Awaited<ReturnType<PaymentService['startView']>>)
  > {
    if (!this.providers[provider]) throw new Problem('feature-off', { errors: [{ field: 'provider', reason: 'not-available-in-this-mode' }] });
    const resumed = await this.db.transaction(async (m) => {
      await this.lockUser(m, userId);
      const s = await this.latest(m, userId);
      if (!s || s.status !== 'cancelled' || s.currentPeriodEnd <= this.clock.now()) return null;
      await m.getRepository(Subscription).update({ id: s.id }, { status: 'active', cancelledAt: null });
      await this.changed(m, { ...s, status: 'active', cancelledAt: null }, 'resumed');
      return view({ ...s, status: 'active', cancelledAt: null });
    });
    if (resumed) return { resumed: true, subscription: resumed };
    const price = (await this.params.current()).get<Cp48>('CP-48').monthly_poisha;
    if (price === null || price <= 0) throw new Problem('feature-off', { errors: [{ field: 'subscription', reason: 'pro-price-not-set' }] });
    const { id } = await this.idempotency.once('subscription', userId, idempotencyKey, async () => {
      const attempt = await this.db.transaction(async (m) => {
        await this.lockUser(m, userId);
        const live = await m.getRepository(Subscription).findOne({
          where: [
            { userId, status: 'active' },
            { userId, status: 'past_due' },
          ],
        });
        const {
          identifiers: [a],
        } = await m.getRepository(PaymentAttempt).insert({
          purpose: 'subscription',
          subjectId: live?.id ?? randomUUID(),
          payerId: userId,
          provider,
          amount: String(price),
          expiresAt: this.expiry(provider, this.clock.now()),
        });
        return m.getRepository(PaymentAttempt).findOneByOrFail({ id: a.id as string });
      });
      await this.payments.openAttempt(attempt, 'TrustBazaar Pro Seller, one month');
      return attempt.id;
    });
    const a = await this.db.getRepository(PaymentAttempt).findOneByOrFail({ id });
    if (a.payerId !== userId || a.purpose !== 'subscription')
      throw new Problem('validation-failed', { errors: [{ field: 'Idempotency-Key', reason: 'reused' }] });
    const renewal = (await this.db.getRepository(Subscription).countBy({ id: a.subjectId! })) > 0;
    return { resumed: false, subscriptionId: a.subjectId!, renewal, ...(await this.payments.startView(id)) };
  }

  /** DELETE /me/subscription: no renewal; Pro stays until the paid month ends (FR-MON-08). */
  async cancel(userId: string): Promise<SubscriptionView> {
    return this.db.transaction(async (m) => {
      await this.lockUser(m, userId);
      const s = await m.getRepository(Subscription).findOne({
        where: [
          { userId, status: 'active' },
          { userId, status: 'past_due' },
        ],
      });
      if (!s) throw new Problem('not-found');
      const now = this.clock.now();
      await m.getRepository(Subscription).update({ id: s.id }, { status: 'cancelled', cancelledAt: now });
      const after = { ...s, status: 'cancelled' as const, cancelledAt: now };
      await this.changed(m, after, 'cancelled');
      return view(after);
    });
  }

  /** The SubjectHandler of subscription payments: a month is added, to a new or the paid-for subscription. */
  readonly paySubscription: SubjectHandler = async (m, attempt, now) => {
    const userId = attempt.payerId;
    await this.lockUser(m, userId);
    const s = await m.getRepository(Subscription).findOne({ where: { id: attempt.subjectId! }, lock: { mode: 'pessimistic_write' } });
    const other = (await m.query(`SELECT 1 FROM payments.subscriptions WHERE user_id = $1 AND status IN ('active', 'past_due') AND id <> $2`, [
      userId,
      attempt.subjectId,
    ])) as unknown[];
    if (other.length) return { accepted: false, reason: 'another-subscription-live' };
    let after: Subscription;
    if (s) {
      const end = addMonth(s.currentPeriodEnd > now ? s.currentPeriodEnd : now);
      await m
        .getRepository(Subscription)
        .update({ id: s.id }, { status: 'active', currentPeriodEnd: end, failedRenewals: 0, cancelledAt: null, provider: attempt.provider });
      after = { ...s, status: 'active', currentPeriodEnd: end, failedRenewals: 0, cancelledAt: null, provider: attempt.provider };
    } else {
      await m
        .getRepository(Subscription)
        .insert({ id: attempt.subjectId!, userId, status: 'active', currentPeriodEnd: addMonth(now), provider: attempt.provider });
      after = await m.getRepository(Subscription).findOneByOrFail({ id: attempt.subjectId! });
    }
    await this.changed(m, after, s ? 'renewed' : 'started');
    return { accepted: true, account: 'revenue_subscription', memo: `Pro Seller month to ${after.currentPeriodEnd.toISOString().slice(0, 10)}` };
  };

  /** A failed renewal payment of a past-due subscription counts toward the lapse (FR-MON-08). */
  readonly renewalFailed: FailureHandler = async (m, attempt) => {
    await m.query(`UPDATE payments.subscriptions SET failed_renewals = failed_renewals + 1 WHERE id = $1 AND status = 'past_due'`, [attempt.subjectId]);
  };

  /** The monetization job: months that ended unpaid make subscriptions past due; a second miss lapses them. */
  async processSubscriptions(): Promise<number> {
    const now = this.clock.now();
    const due = (await this.db.query(
      `SELECT id FROM payments.subscriptions
        WHERE (status = 'active' AND current_period_end <= $1)
           OR (status = 'past_due' AND (failed_renewals >= 2 OR current_period_end + interval '1 month' <= $1))
        ORDER BY current_period_end LIMIT ${BATCH}`,
      [now],
    )) as { id: string }[];
    let n = 0;
    for (const { id } of due) {
      const done = await this.db.transaction(async (m: EntityManager) => {
        const s = await m.getRepository(Subscription).findOne({ where: { id }, lock: { mode: 'pessimistic_write', onLocked: 'skip_locked' } });
        if (!s) return false;
        if (s.status === 'active' && s.currentPeriodEnd <= now) {
          await m.getRepository(Subscription).update({ id }, { status: 'past_due', failedRenewals: 1 });
          await this.changed(m, { ...s, status: 'past_due', failedRenewals: 1 }, 'renewal_due');
          return true;
        }
        if (s.status === 'past_due' && (s.failedRenewals >= 2 || addMonth(s.currentPeriodEnd) <= now)) {
          await m.getRepository(Subscription).update({ id }, { status: 'lapsed' });
          await this.changed(m, { ...s, status: 'lapsed' }, 'lapsed');
          return true;
        }
        return false;
      });
      if (done) n++;
    }
    return n;
  }

  private async changed(m: EntityManager, s: Subscription, change: 'started' | 'renewed' | 'resumed' | 'cancelled' | 'renewal_due' | 'lapsed') {
    const price = change === 'renewal_due' ? (await this.params.current()).get<Cp48>('CP-48').monthly_poisha : null;
    await m.getRepository(OrdersOutboxEvent).insert({
      eventType: 'payments.subscription.changed',
      aggregateId: s.id,
      payload: {
        subscriptionId: s.id,
        userId: s.userId,
        status: s.status,
        change,
        currentPeriodEnd: s.currentPeriodEnd.toISOString(),
        ...(price !== null ? { amount: String(price) } : {}),
      },
    });
    await this.audit.record(
      {
        actorType: change === 'cancelled' || change === 'resumed' ? 'user' : change === 'started' || change === 'renewed' ? 'provider' : 'system',
        actorId: change === 'cancelled' || change === 'resumed' ? s.userId : null,
        action: `payments.subscription.${change}`,
        objectType: 'subscription',
        objectId: s.id,
        after: { status: s.status, currentPeriodEnd: s.currentPeriodEnd },
      },
      m,
    );
  }

  /** One subscription change per user at a time (subscribe, pay, cancel). */
  private async lockUser(m: EntityManager, userId: string) {
    await m.query(`SELECT pg_advisory_xact_lock(hashtextextended('payments.subscription:' || $1, 0))`, [userId]);
  }

  private latest(m: EntityManager, userId: string) {
    return m.getRepository(Subscription).findOne({ where: { userId }, order: { createdAt: 'DESC' } });
  }

  private expiry(provider: ProviderId, now: Date): Date {
    const stripeWebhook = provider === 'stripe' && this.providers.stripe?.confirmation === 'webhook';
    return new Date(now.getTime() + (stripeWebhook ? STRIPE_MIN_SESSION_MS : ATTEMPT_LIFETIME_MS));
  }
}
