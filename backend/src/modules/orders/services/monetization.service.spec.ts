import { parameterValues } from '../../../kernel/config-port';
import { Problem } from '../../../kernel/http/problems';
import { FeaturedPurchase, OrdersOutboxEvent } from '../db/entities';
import { MonetizationService } from './monetization.service';

// MonetizationService (U2-06), featured listings, with its collaborators faked. The flows against PostgreSQL,
// the mock provider and Listings' consumer are in test/api/featured.spec.ts.
describe('MonetizationService (featured listings)', () => {
  const NOW = new Date('2026-11-17T10:00:00Z');
  function setup(o: { fee?: number | null; providers?: Record<string, unknown> } = {}) {
    const values = parameterValues({ 'CP-37': { periods: ['24 hours', '48 hours'], fee_poisha: o.fee === undefined ? 10_000 : o.fee } });
    const params = { current: async () => values };
    const payments = { registerSubject: jest.fn(), reconcile: jest.fn(async () => 'pending'), openAttempt: jest.fn(), startView: jest.fn() };
    const jobs = { register: jest.fn() };
    const listings = { snapshot: jest.fn() };
    const audit = { record: jest.fn() };
    const repos = new Map<unknown, { findOne: jest.Mock; update: jest.Mock; insert: jest.Mock }>([
      [FeaturedPurchase, { findOne: jest.fn(), update: jest.fn(), insert: jest.fn() }],
      [OrdersOutboxEvent, { findOne: jest.fn(), update: jest.fn(), insert: jest.fn() }],
    ]);
    const m = { getRepository: (e: unknown) => repos.get(e)!, query: jest.fn(async () => [{ last: null }]) };
    const db = { query: jest.fn(async () => [] as unknown[]), transaction: async (cb: (x: typeof m) => unknown) => cb(m) };
    const svc = new MonetizationService(
      db as never, payments as never, { once: jest.fn() } as never, (o.providers ?? { bkash: { confirmation: 'callback' } }) as never, listings as never,
      audit as never, params as never, { now: () => NOW }, jobs as never,
    );
    return { svc, payments, jobs, listings, repos, m, db, audit };
  }
  const problem = async (p: Promise<unknown>) => ((await p.catch((e: unknown) => e)) as Problem).problem;

  it('FR-MON-05 registers the featured handler and the 5-minute monetization job', async () => {
    const s = setup();
    s.svc.onModuleInit();
    expect(s.payments.registerSubject).toHaveBeenCalledWith('featured_listing', s.svc.startFeatured);
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
    expect(await s.svc.startFeatured(s.m as never, { subjectId: 'P' } as never, NOW)).toEqual({ accepted: true, account: 'revenue_featured', memo: 'featured listing L, 24 hours' });
    expect(purchases.update).toHaveBeenLastCalledWith({ id: 'P' }, { startsAt: NOW, endsAt: new Date('2026-11-18T10:00:00Z') });
    const running = new Date('2026-11-17T20:00:00Z');
    s.m.query.mockResolvedValueOnce([{ last: running }] as never);
    await s.svc.startFeatured(s.m as never, { subjectId: 'P' } as never, NOW);
    expect(purchases.update).toHaveBeenLastCalledWith({ id: 'P' }, { startsAt: running, endsAt: new Date('2026-11-18T20:00:00Z') });
    expect(outbox.insert).toHaveBeenLastCalledWith(expect.objectContaining({ eventType: 'payments.featured.started', payload: expect.objectContaining({ startsAt: running.toISOString() }) }));
  });

  it('FR-MON-07 expired attempts: no adapter is left for an operator; a failed query waits for the next run', async () => {
    const s = setup();
    s.db.query.mockResolvedValueOnce([{ id: 'A', provider: 'stripe' }, { id: 'B', provider: 'bkash' }]);
    s.payments.reconcile.mockRejectedValueOnce(new Error('down'));
    expect(await s.svc.expireAttempts()).toBe(0);
    expect(s.payments.reconcile).toHaveBeenCalledTimes(1);
    expect(s.payments.reconcile).toHaveBeenCalledWith('B');
  });
});
