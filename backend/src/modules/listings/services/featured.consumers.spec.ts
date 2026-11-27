import { FeaturedConsumers } from './featured.consumers';

// The featured label's consumers (U2-06) with the database faked; test/api/featured.spec.ts runs them on PostgreSQL.
describe('FeaturedConsumers', () => {
  it('FR-MON-05 started extends featured_until to the period end; ended clears it unless a later period moved it', async () => {
    const db = { query: jest.fn(async () => []) };
    const bus = { on: jest.fn() };
    const c = new FeaturedConsumers(db as never, bus as never);
    c.onModuleInit();
    expect(bus.on.mock.calls.map((x) => [x[0], x[1]])).toEqual([
      ['payments.featured.started', 'listings.featured'],
      ['payments.featured.ended', 'listings.featured'],
    ]);
    const e = (payload: Record<string, unknown>) => ({ outbox: 'orders', id: '1', type: 't', aggregateId: 'P', payload, createdAt: new Date(), attempt: 1 });
    await bus.on.mock.calls[0][2](e({ listingId: 'L', endsAt: '2026-11-18T10:00:00.000Z' }));
    expect(db.query).toHaveBeenLastCalledWith(expect.stringContaining('greatest(featured_until'), ['L', '2026-11-18T10:00:00.000Z']);
    await bus.on.mock.calls[1][2](e({ listingId: 'L', endsAt: '2026-11-18T10:00:00.000Z' }));
    expect(db.query).toHaveBeenLastCalledWith(expect.stringContaining('featured_until <= $2'), ['L', '2026-11-18T10:00:00.000Z']);
  });
});
