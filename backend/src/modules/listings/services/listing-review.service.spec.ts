import { QueryFailedError } from 'typeorm';
import type { OutboxEvent } from '../../../kernel/events/event-bus';
import { Problem } from '../../../kernel/http/problems';
import { ListingReviewService } from './listing-review.service';

// U3-08 with the database, Unit 1 and the commands faked: what each staff action asks for, its refusals and audit,
// and the visibility recomputed from Unit 1's answer. The same against PostgreSQL: test/api/listing-review.spec.ts.
function setup(answer: (sql: string) => unknown = () => [], o: { canList?: boolean | Error; returned?: boolean } = {}) {
  const query = jest.fn(async (sql: string, _p?: unknown[]) => {
    const r = answer(sql);
    if (r instanceof Error) throw r;
    return r;
  });
  const insert = jest.fn(async (_r: unknown) => undefined);
  const m = { query, getRepository: () => ({ insert }) };
  const db = { query, transaction: async <R>(fn: (x: unknown) => Promise<R>) => fn(m) };
  const commands = {
    approveForPublication: jest.fn(async () => undefined),
    returnToDraft: jest.fn(async () => o.returned ?? true),
    remove: jest.fn(async () => undefined),
  };
  const handlers = new Map<string, (e: OutboxEvent) => Promise<void>>();
  const bus = { on: (type: string, _n: string, h: (e: OutboxEvent) => Promise<void>) => void handlers.set(type, h) };
  const identity = {
    assertCanTransact: jest.fn(async () => {
      if (o.canList instanceof Error) throw o.canList;
      if (o.canList === false) throw new Problem('transaction-not-allowed');
    }),
  };
  const audit = { record: jest.fn(async (_e: unknown, _m?: unknown) => undefined) };
  const svc = new ListingReviewService(db as never, commands as never, bus as never, identity as never, audit as never);
  return { svc, query, insert, commands, handlers, audit, identity };
}
const failure = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: Problem) => (e.extra?.errors as { reason: string }[] | undefined)?.[0]?.reason ?? e.problem,
  );
const listing =
  (kind = 'physical') =>
  (q: string) =>
    q.startsWith('SELECT seller_id, item_kind, title') ? [{ seller_id: 'S', item_kind: kind, title: 'Watch' }] : [];
const REASON = 'A clear reason for the seller.';

describe('ListingReviewService', () => {
  it('FR-LST-11 approve publishes through ListingsCommands; return tells the seller; both audited; game accounts go to Unit 5', async () => {
    const a = setup(listing());
    expect(await a.svc.review('st', 'L', 'approve', ` ${REASON} `, { ip: '1.2.3.4' })).toEqual({ status: 'active' });
    expect(a.commands.approveForPublication).toHaveBeenCalledWith('L', 'st', REASON, expect.anything());
    expect(a.audit.record.mock.calls[0][0]).toMatchObject({ action: 'listings.listing.approved', objectId: 'L', reason: REASON, sourceIp: '1.2.3.4' });
    const r = setup(listing());
    expect(await r.svc.review('st', 'L', 'return', REASON)).toEqual({ status: 'draft' });
    expect(r.insert.mock.calls[0][0]).toMatchObject({ eventType: 'listings.listing.returned', payload: { listingId: 'L', sellerId: 'S', reason: REASON } });
    expect(await failure(setup(listing(), { returned: false }).svc.review('st', 'L', 'return', REASON))).toBe('listing-state');
    expect(await failure(setup(listing('game_account')).svc.review('st', 'L', 'approve', REASON))).toBe('use-the-ownership-review');
    expect(await failure(setup().svc.review('st', 'L', 'approve', REASON))).toBe('not-found');
    expect(await failure(setup(listing()).svc.review('st', 'L', 'approve', 'short'))).toBe('too-short');
  });

  it('FR-LST-12 removal goes through ListingsCommands with the reason, audited', async () => {
    const s = setup();
    expect(await s.svc.remove('st', 'L', REASON)).toEqual({ status: 'removed' });
    expect(s.commands.remove).toHaveBeenCalledWith('L', 'st', REASON, expect.anything());
    expect(s.audit.record.mock.calls[0][0]).toMatchObject({ action: 'listings.listing.removed', reason: REASON });
    expect(await failure(s.svc.remove('st', 'L', 'x'))).toBe('too-short');
  });

  it('FR-LST-11 screening terms: listed, added in lower case once, deleted; each change audited', async () => {
    const T = new Date('2026-12-01T10:00:00Z');
    expect(await setup(() => [{ id: 1, term: 'replica', severity: 'high_risk', added_by: 'st', added_at: T }]).svc.terms()).toEqual({
      items: [{ id: 1, term: 'replica', severity: 'high_risk', addedBy: 'st', addedAt: T.toISOString() }],
    });
    const add = setup(() => [{ id: 7 }]);
    expect(await add.svc.addTerm('st', '  Fake   GOLD ', 'prohibited')).toEqual({ id: 7, term: 'fake gold', severity: 'prohibited' });
    expect(add.audit.record.mock.calls[0][0]).toMatchObject({ action: 'listings.screening_term.added', after: { id: 7, term: 'fake gold' } });
    expect(await failure(setup().svc.addTerm('st', 'x', 'prohibited'))).toBe('length');
    expect(
      await failure(setup(() => new QueryFailedError('q', [], Object.assign(new Error('dup'), { code: '23505' }))).svc.addTerm('st', 'fake', 'prohibited')),
    ).toBe('taken');
    await expect(
      setup(() => new QueryFailedError('q', [], Object.assign(new Error('x'), { code: 'XX000' }))).svc.addTerm('st', 'fake', 'prohibited'),
    ).rejects.toBeInstanceOf(QueryFailedError);
    const del = setup(() => [[{ term: 'fake', severity: 'prohibited' }], 1]);
    await del.svc.deleteTerm('st', 7);
    expect(del.audit.record.mock.calls[0][0]).toMatchObject({ action: 'listings.screening_term.deleted', before: { id: 7, term: 'fake' } });
    expect(await failure(setup(() => [[], 0]).svc.deleteTerm('st', 8))).toBe('not-found');
  });

  it('I-45 FR-TNS-05 a seller\'s listings follow Unit 1\'s answer to "may this user list?" on each identity and sanction event', async () => {
    const e = (type: string): OutboxEvent => ({
      outbox: 'identity',
      id: '1',
      type,
      aggregateId: 'S',
      payload: { userId: 'S' },
      createdAt: new Date(),
      attempt: 1,
    });
    const hide = setup(() => [[], 3], { canList: false });
    expect(await hide.svc.onSellerChanged(e('identity.account.suspended'))).toBe(3);
    expect(hide.query.mock.calls[0][1]).toEqual(['S', false]);
    const show = setup(() => [[], 2]);
    expect(await show.svc.onSellerChanged({ ...e('trust.sanction.lifted'), payload: {} })).toBe(2);
    expect(show.query.mock.calls[0][1]).toEqual(['S', true]);
    await expect(setup(() => [[], 0], { canList: new Error('down') }).svc.onSellerChanged(e('identity.kyc.revoked'))).rejects.toThrow('down');
    show.svc.onModuleInit();
    expect([...show.handlers.keys()]).toEqual([
      'identity.kyc.verified',
      'identity.kyc.revoked',
      'identity.account.suspended',
      'identity.account.reinstated',
      'trust.sanction.applied',
      'trust.sanction.lifted',
    ]);
    await show.handlers.get('identity.kyc.verified')!(e('identity.kyc.verified'));
    expect(show.identity.assertCanTransact).toHaveBeenLastCalledWith('S', 'list');
  });
});
