import { parameterValues } from '../../../kernel/config-port';
import { Problem } from '../../../kernel/http/problems';
import { FeaturedPurchase, OrdersOutboxEvent, Subscription } from '../db/entities';
import { addMonth, MonetizationService } from './monetization.service';

// MonetizationService (U2-06), featured listings, with its collaborators faked. The flows against PostgreSQL,
// the mock provider and Listings' consumer are in test/api/featured.spec.ts.
describe('MonetizationService (featured listings)', () => {
  const NOW = new Date('2026-11-17T10:00:00Z');
  function setup(o: { fee?: number | null; price?: number | null; providers?: Record<string, unknown> } = {}) {
    const values = parameterValues({
      'CP-37': { periods: ['24 hours', '48 hours'], fee_poisha: o.fee === undefined ? 10_000 : o.fee },
      'CP-48': { monthly_poisha: o.price === undefined ? 50_000 : o.price },
    });
    const params = { current: async () => values };
    const payments = { registerSubject: jest.fn(), reconcile: jest.fn(async () => 'pending'), openAttempt: jest.fn(), startView: jest.fn() };
    const jobs = { register: jest.fn() };
    const listings = { snapshot: jest.fn() };
    const audit = { record: jest.fn() };
    const repos = new Map<unknown, { findOne: jest.Mock; update: jest.Mock; insert: jest.Mock; findOneByOrFail?: jest.Mock; countBy?: jest.Mock }>([
      [FeaturedPurchase, { findOne: jest.fn(), update: jest.fn(), insert: jest.fn() }],
      [OrdersOutboxEvent, { findOne: jest.fn(), update: jest.fn(), insert: jest.fn() }],
      [Subscription, { findOne: jest.fn(), update: jest.fn(), insert: jest.fn(), findOneByOrFail: jest.fn(), countBy: jest.fn() } as never],
    ]);
    const m = { getRepository: (e: unknown) => repos.get(e)!, query: jest.fn(async () => [{ last: null }]) };
    const db = {
      query: jest.fn(async () => [] as unknown[]),
      transaction: async (cb: (x: typeof m) => unknown) => cb(m),
      manager: m,
      getRepository: (e: unknown) => repos.get(e)!,
    };
    const svc = new MonetizationService(
      db as never,
      payments as never,
      { once: jest.fn() } as never,
      (o.providers ?? { bkash: { confirmation: 'callback' } }) as never,
      listings as never,
      audit as never,
      params as never,
      { now: () => NOW },
      jobs as never,
    );
    return { svc, payments, jobs, listings, repos, m, db, audit };
  }
  const problem = async (p: Promise<unknown>) => ((await p.catch((e: unknown) => e)) as Problem).problem;

  it('FR-MON-05 registers the featured handler and the 5-minute monetization job', async () => {
    const s = setup();
    s.svc.onModuleInit();
    expect(s.payments.registerSubject).toHaveBeenCalledWith('featured_listing', s.svc.startFeatured);
    expect(s.payments.registerSubject).toHaveBeenCalledWith('subscription', s.svc.paySubscription, s.svc.renewalFailed);
    expect(s.jobs.register).toHaveBeenCalledWith(expect.objectContaining({ name: 'payments.monetization', intervalMs: 300_000 }));
    expect(await s.jobs.register.mock.calls[0][0].run()).toBe(0);
  });

  it('FR-MON-05 the CP-37 fee is the price of 24 hours; 48 cost twice; unset fees and missing providers are feature-off', async () => {
    const s = setup();
    expect(await s.svc.featureFee(24)).toBe(10_000n);
    expect(await s.svc.featureFee(48)).toBe(20_000n);
    expect(await problem(s.svc.featureFee(12))).toBe('validation-failed');
    expect(await setup({ fee: null }).svc.featureFee(24)).toBeNull();
    expect(await problem(setup({ fee: null }).svc.feature('S', 'L', 24, 'bkash', undefined))).toBe('feature-off');
    expect(await problem(setup({ fee: 0 }).svc.feature('S', 'L', 24, 'bkash', undefined))).toBe('feature-off');
    expect(await problem(s.svc.feature('S', 'L', 24, 'nagad', undefined))).toBe('feature-off');
  });

  it('FR-MON-05 a payment for a period already started, or a listing gone or not active, is not accepted', async () => {
    const s = setup();
    const purchases = s.repos.get(FeaturedPurchase)!;
    const attempt = { subjectId: 'P' } as never;
    purchases.findOne.mockResolvedValueOnce({ id: 'P', startsAt: NOW });
    expect(await s.svc.startFeatured(s.m as never, attempt, NOW)).toEqual({ accepted: false, reason: 'already-started' });
    purchases.findOne.mockResolvedValueOnce({ id: 'P', startsAt: null, listingId: 'L' });
    s.listings.snapshot.mockRejectedValueOnce(new Problem('not-found'));
    expect(await s.svc.startFeatured(s.m as never, attempt, NOW)).toEqual({ accepted: false, reason: 'listing-not-active' });
    purchases.findOne.mockResolvedValueOnce({ id: 'P', startsAt: null, listingId: 'L' });
    s.listings.snapshot.mockResolvedValueOnce({ status: 'sold' });
    expect(await s.svc.startFeatured(s.m as never, attempt, NOW)).toEqual({ accepted: false, reason: 'listing-not-active' });
    purchases.findOne.mockResolvedValueOnce(null);
    await expect(s.svc.startFeatured(s.m as never, attempt, NOW)).rejects.toThrow('missing');
  });

  it('FR-MON-05 a period starts now, or at the end of the one running; the started event carries both times', async () => {
    const s = setup();
    const purchases = s.repos.get(FeaturedPurchase)!;
    const outbox = s.repos.get(OrdersOutboxEvent)!;
    s.listings.snapshot.mockResolvedValue({ status: 'active' });
    purchases.findOne.mockResolvedValue({ id: 'P', startsAt: null, listingId: 'L', sellerId: 'S', hours: 24 });
    expect(await s.svc.startFeatured(s.m as never, { subjectId: 'P' } as never, NOW)).toEqual({
      accepted: true,
      account: 'revenue_featured',
      memo: 'featured listing L, 24 hours',
    });
    expect(purchases.update).toHaveBeenLastCalledWith({ id: 'P' }, { startsAt: NOW, endsAt: new Date('2026-11-18T10:00:00Z') });
    const running = new Date('2026-11-17T20:00:00Z');
    s.m.query.mockResolvedValueOnce([{ last: running }] as never);
    await s.svc.startFeatured(s.m as never, { subjectId: 'P' } as never, NOW);
    expect(purchases.update).toHaveBeenLastCalledWith({ id: 'P' }, { startsAt: running, endsAt: new Date('2026-11-18T20:00:00Z') });
    expect(outbox.insert).toHaveBeenLastCalledWith(
      expect.objectContaining({ eventType: 'payments.featured.started', payload: expect.objectContaining({ startsAt: running.toISOString() }) }),
    );
  });

  it('FR-MON-07 expired attempts: no adapter is left for an operator; a failed query waits for the next run', async () => {
    const s = setup();
    s.db.query.mockResolvedValueOnce([
      { id: 'A', provider: 'stripe' },
      { id: 'B', provider: 'bkash' },
    ]);
    s.payments.reconcile.mockRejectedValueOnce(new Error('down'));
    expect(await s.svc.expireAttempts()).toBe(0);
    expect(s.payments.reconcile).toHaveBeenCalledTimes(1);
    expect(s.payments.reconcile).toHaveBeenCalledWith('B');
  });

  // ---------------------------------------------------------------- Pro Seller
  const sub = (x: Record<string, unknown> = {}) => ({
    id: 'SUB',
    userId: 'U',
    status: 'active',
    provider: 'bkash',
    currentPeriodEnd: new Date('2026-12-01T00:00:00Z'),
    cancelledAt: null,
    failedRenewals: 0,
    createdAt: NOW,
    ...x,
  });

  it('FR-MON-06 a month is the same day of the next month', () => {
    expect(addMonth(new Date('2026-11-17T10:00:00Z')).toISOString()).toBe('2026-12-17T10:00:00.000Z');
  });

  it('FR-MON-06 isPro reads active or cancelled subscriptions whose month runs; the view shows the price', async () => {
    const s = setup({ price: null });
    s.m.query.mockResolvedValueOnce([{}] as never);
    expect(await s.svc.isPro('U')).toBe(true);
    expect(s.m.query).toHaveBeenLastCalledWith(expect.stringContaining("status IN ('active', 'cancelled')"), ['U', NOW]);
    s.m.query.mockResolvedValueOnce([] as never);
    expect(await s.svc.isPro('U', s.m as never)).toBe(false);
    s.repos.get(Subscription)!.findOne.mockResolvedValueOnce(null);
    s.m.query.mockResolvedValueOnce([] as never);
    expect(await s.svc.mySubscription('U')).toEqual({ subscription: null, pro: false, monthlyPrice: null });
  });

  it('FR-MON-06 subscribing needs a provider in this mode and a CP-48 price; cancelling needs a live subscription', async () => {
    expect(await problem(setup().svc.subscribe('U', 'nagad', undefined))).toBe('feature-off');
    const unset = setup({ price: null });
    unset.repos.get(Subscription)!.findOne.mockResolvedValue(null);
    expect(await problem(unset.svc.subscribe('U', 'bkash', undefined))).toBe('feature-off');
    const s = setup();
    s.repos.get(Subscription)!.findOne.mockResolvedValue(null);
    expect(await problem(s.svc.cancel('U'))).toBe('not-found');
  });

  it('FR-MON-06 a cancelled subscription within its month resumes without a payment', async () => {
    const s = setup();
    s.repos.get(Subscription)!.findOne.mockResolvedValue(sub({ status: 'cancelled', cancelledAt: NOW }));
    expect(await s.svc.subscribe('U', 'bkash', undefined)).toEqual({
      resumed: true,
      subscription: expect.objectContaining({ status: 'active', cancelledAt: null }),
    });
    expect(s.repos.get(Subscription)!.update).toHaveBeenCalledWith({ id: 'SUB' }, { status: 'active', cancelledAt: null });
    expect(s.repos.get(OrdersOutboxEvent)!.insert).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ change: 'resumed' }) }));
    expect(s.audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'payments.subscription.resumed', actorType: 'user', actorId: 'U' }), s.m);
  });

  it('FR-MON-07 a payment adds a month to the end or to now; another live subscription refuses it', async () => {
    const s = setup();
    const subs = s.repos.get(Subscription)!;
    const attempt = { payerId: 'U', subjectId: 'SUB', provider: 'nagad' } as never;
    s.m.query.mockResolvedValueOnce([] as never).mockResolvedValueOnce([{}] as never);
    expect(await s.svc.paySubscription(s.m as never, attempt, NOW)).toEqual({ accepted: false, reason: 'another-subscription-live' });
    subs.findOne.mockResolvedValueOnce(sub());
    s.m.query.mockResolvedValueOnce([] as never).mockResolvedValueOnce([] as never);
    expect(await s.svc.paySubscription(s.m as never, attempt, NOW)).toMatchObject({ accepted: true, account: 'revenue_subscription' });
    expect(subs.update).toHaveBeenLastCalledWith(
      { id: 'SUB' },
      expect.objectContaining({ status: 'active', currentPeriodEnd: new Date('2027-01-01T00:00:00Z'), provider: 'nagad' }),
    );
    subs.findOne.mockResolvedValueOnce(sub({ status: 'past_due', currentPeriodEnd: new Date('2026-11-01T00:00:00Z') }));
    s.m.query.mockResolvedValueOnce([] as never).mockResolvedValueOnce([] as never);
    await s.svc.paySubscription(s.m as never, attempt, NOW);
    expect(subs.update).toHaveBeenLastCalledWith(
      { id: 'SUB' },
      expect.objectContaining({ currentPeriodEnd: new Date('2026-12-17T10:00:00Z'), failedRenewals: 0 }),
    );
    subs.findOne.mockResolvedValueOnce(null);
    subs.findOneByOrFail!.mockResolvedValueOnce(sub({ currentPeriodEnd: new Date('2026-12-17T10:00:00Z') }));
    s.m.query.mockResolvedValueOnce([] as never).mockResolvedValueOnce([] as never);
    expect(await s.svc.paySubscription(s.m as never, attempt, NOW)).toMatchObject({ memo: 'Pro Seller month to 2026-12-17' });
    expect(subs.insert).toHaveBeenCalledWith({
      id: 'SUB',
      userId: 'U',
      status: 'active',
      currentPeriodEnd: new Date('2026-12-17T10:00:00Z'),
      provider: 'nagad',
    });
    await s.svc.renewalFailed(s.m as never, attempt, NOW);
    expect(s.m.query).toHaveBeenLastCalledWith(expect.stringContaining('failed_renewals + 1'), ['SUB']);
  });

  it('FR-MON-08 the job: past due at the end of an unpaid month, lapsed after a second miss; others are left', async () => {
    const s = setup();
    const subs = s.repos.get(Subscription)!;
    s.db.query.mockResolvedValueOnce([{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }]);
    subs.findOne
      .mockResolvedValueOnce(sub({ id: 'A', currentPeriodEnd: new Date('2026-11-17T09:00:00Z') }))
      .mockResolvedValueOnce(sub({ id: 'B', status: 'past_due', failedRenewals: 2, currentPeriodEnd: new Date('2026-11-10T00:00:00Z') }))
      .mockResolvedValueOnce(sub({ id: 'C', status: 'past_due', failedRenewals: 1, currentPeriodEnd: new Date('2026-11-10T00:00:00Z') }))
      .mockResolvedValueOnce(null);
    expect(await s.svc.processSubscriptions()).toBe(2);
    expect(subs.update.mock.calls).toEqual([
      [{ id: 'A' }, { status: 'past_due', failedRenewals: 1 }],
      [{ id: 'B' }, { status: 'lapsed' }],
    ]);
    expect(s.repos.get(OrdersOutboxEvent)!.insert.mock.calls[0][0]).toMatchObject({ payload: { change: 'renewal_due', amount: '50000' } });
    expect(s.audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'payments.subscription.lapsed', actorType: 'system' }), s.m);
  });
});
