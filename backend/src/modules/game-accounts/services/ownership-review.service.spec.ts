import { QueryFailedError } from 'typeorm';
import { Problem } from '../../../kernel/http/problems';
import { ClaimConsumers } from '../consumers/claim.consumers';
import { OwnershipReviewService } from './ownership-review.service';

// U5-02 with the database, Units 1 and 3 and the parameters faked: what each decision asks of Unit 3, and how the
// database's refusals reach the operator. The same against PostgreSQL: test/api/ownership-review.spec.ts.

const T = new Date('2026-12-01T10:00:00Z');
const dbError = (message: string, code = '23514') => new QueryFailedError('q', [], Object.assign(new Error(message), { code }));
const staffP = { type: 'staff', staffId: 'st', sessionId: 's', role: 'operator' } as const;

function setup(answer: (sql: string) => unknown, o: { cp36?: boolean; conflict?: boolean } = {}) {
  const query = jest.fn(async (sql: string, _p?: unknown[]) => {
    const r = answer(sql);
    if (r instanceof Error) throw r;
    return r;
  });
  const db = { query, transaction: async <R>(fn: (m: unknown) => Promise<R>) => fn({ query }) };
  const listings = { approveForPublication: jest.fn(async () => undefined), returnToDraft: jest.fn(async () => true) };
  const vault = { signedLink: jest.fn(async () => ({ url: '/files/x', expiresAt: T.toISOString() })) };
  const audit = { record: jest.fn(async (_e: unknown, _m?: unknown) => undefined) };
  const staff = {
    assertNoConflict: jest.fn(async () => {
      if (o.conflict) throw new Problem('conflict-of-interest');
    }),
  };
  const params = { current: async () => ({ get: () => o.cp36 ?? true }) };
  const svc = new OwnershipReviewService(db as never, listings as never, vault as never, audit as never, staff as never, params as never);
  return { svc, query, listings, vault, audit, staff };
}
const failure = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: Problem) => (e.extra?.errors as { reason: string }[] | undefined)?.[0]?.reason ?? e.problem,
  );
const proof = (status: string) => (q: string) =>
  q.includes('review_proof') ? [{ status }] : q.includes('SELECT p.listing_id') ? [{ listing_id: 'L', seller_id: 'S' }] : [];

describe('OwnershipReviewService', () => {
  it('FR-OPS-01 FR-GAM-03 the queue lists submitted proofs oldest first; the screenshot is a signed link for an operator without a conflict', async () => {
    const row = { id: 'P', listing_id: 'L', seller_id: 'S', name: 'CODM', platform: 'android', player_id: 'p1', submitted_at: T, expires_at: T };
    const s = setup(() => [row]);
    expect(await s.svc.queue()).toEqual({
      items: [
        {
          proofId: 'P',
          listingId: 'L',
          sellerId: 'S',
          game: 'CODM',
          platform: 'android',
          playerId: 'p1',
          submittedAt: T.toISOString(),
          codeExpiresAt: T.toISOString(),
        },
      ],
    });
    expect(s.query.mock.calls[0][1]).toEqual([200]);
    const shot = setup(() => [{ screenshot_key: 'v1.k', seller_id: 'S' }]);
    expect(await shot.svc.screenshot(staffP, 'P', { ip: '1.2.3.4' })).toEqual({ url: '/files/x', expiresAt: T.toISOString() });
    expect(shot.vault.signedLink).toHaveBeenCalledWith('v1.k', staffP, 'ownership proof review', { ip: '1.2.3.4' });
    expect(await failure(setup(() => [{ screenshot_key: null, seller_id: 'S' }]).svc.screenshot(staffP, 'P'))).toBe('not-found');
    expect(await failure(setup(() => [{ screenshot_key: 'v1.k', seller_id: 'S' }], { conflict: true }).svc.screenshot(staffP, 'P'))).toBe(
      'conflict-of-interest',
    );
  });

  it('FR-GAM-03 FR-GAM-04 approval publishes the listing through Unit 3, rejection returns it to draft, both audited in one transaction', async () => {
    const a = setup(proof('approved'));
    expect(await a.svc.review('st', 'P', { approve: true, liveCheck: 'matched' }, { ip: '1.2.3.4' })).toEqual({ status: 'approved' });
    expect(a.query.mock.calls.find(([q]) => q.includes('review_proof'))![1]).toEqual(['P', 'st', true, 'matched', null]);
    expect(a.listings.approveForPublication).toHaveBeenCalledWith('L', 'st', 'game-account ownership approved', expect.anything());
    expect(a.audit.record.mock.calls[0][0]).toMatchObject({ action: 'games.ownership.approved', objectId: 'L', sourceIp: '1.2.3.4' });
    const r = setup(proof('rejected'));
    await r.svc.reviewProof('P', 'st', false, 'not_matched', ' The code is not visible. ');
    expect(r.listings.returnToDraft).toHaveBeenCalledWith('L', 'st', 'game-account ownership rejected: The code is not visible.', expect.anything());
    expect(r.audit.record.mock.calls[0][0]).toMatchObject({ action: 'games.ownership.rejected', reason: 'The code is not visible.' });
    const inTx = setup(proof('approved'));
    const tx = { query: inTx.query };
    await inTx.svc.reviewProof('P', 'st', true, 'not_available', undefined, tx as never);
    expect(inTx.listings.approveForPublication).toHaveBeenCalledWith('L', 'st', 'game-account ownership approved', tx);
  });

  it("FR-GAM-03 FR-GAM-04 refusals: a reason, a matching live profile, CP-36, a conflict, the proof's state, an expired code, a claimed player ID", async () => {
    expect(await failure(setup(proof('rejected')).svc.review('st', 'P', { approve: false, liveCheck: 'matched', reason: 'short' }))).toBe('required');
    expect(await failure(setup(proof('approved')).svc.review('st', 'P', { approve: true, liveCheck: 'not_matched' }))).toBe('live-check-not-matched');
    expect(await failure(setup(proof('approved'), { cp36: false }).svc.review('st', 'P', { approve: true, liveCheck: 'matched' }))).toBe('feature-off');
    expect(await failure(setup(proof('approved'), { conflict: true }).svc.review('st', 'P', { approve: true, liveCheck: 'matched' }))).toBe(
      'conflict-of-interest',
    );
    expect(await failure(setup(() => []).svc.review('st', 'P', { approve: true, liveCheck: 'matched' }))).toBe('not-found');
    const refused = (message: string) => (q: string) => (q.includes('review_proof') ? dbError(message) : proof('approved')(q));
    const notAwaiting = setup(refused('proof is not awaiting review'));
    await expect(notAwaiting.svc.review('st', 'P', { approve: true, liveCheck: 'matched' })).rejects.toMatchObject({ problem: 'listing-state' });
    expect(
      await failure(
        setup(refused('ownership code has expired; the seller must request a new one')).svc.review('st', 'P', { approve: true, liveCheck: 'matched' }),
      ),
    ).toBe('code-expired');
    expect(
      await failure(
        setup(refused('this player ID is already listed, or its last sale is still protected')).svc.review('st', 'P', { approve: true, liveCheck: 'matched' }),
      ),
    ).toBe('player-id-claimed');
    await expect(setup(refused('something else')).svc.review('st', 'P', { approve: true, liveCheck: 'matched' })).rejects.toBeInstanceOf(QueryFailedError);
    const other = setup((q) => (q.includes('review_proof') ? new Error('down') : proof('approved')(q)));
    await expect(other.svc.review('st', 'P', { approve: true, liveCheck: 'matched' })).rejects.toThrow('down');
  });

  it('FR-GAM-04 a game-account listing that ends unsold, is cancelled or removed releases its claim; other listings are ignored', async () => {
    const s = setup(() => [[], 1]);
    expect(await s.svc.releaseForListing('L')).toBe(1);
    expect(s.query.mock.calls[0][1]).toEqual(['L']);
    const handlers = new Map<string, (e: unknown) => Promise<void>>();
    const bus = { on: jest.fn((type: string, _name: string, h: (e: unknown) => Promise<void>) => void handlers.set(type, h)) };
    const review = { releaseForListing: jest.fn(async () => 1) };
    new ClaimConsumers(bus as never, review as never).onModuleInit();
    expect([...handlers.keys()]).toEqual(['listings.listing.ended_unsold', 'listings.listing.cancelled', 'listings.listing.removed']);
    await handlers.get('listings.listing.cancelled')!({ aggregateId: 'A', payload: { itemKind: 'physical', listingId: 'A' } });
    await handlers.get('listings.listing.ended_unsold')!({ aggregateId: 'B', payload: { itemKind: 'game_account', listingId: 'B' } });
    await handlers.get('listings.listing.removed')!({ aggregateId: 'C', payload: { itemKind: 'game_account' } });
    expect(review.releaseForListing.mock.calls).toEqual([['B'], ['C']]);
  });
});
