import { QueryFailedError } from 'typeorm';
import { Problem } from '../../../kernel/http/problems';
import { ownershipCode, OwnershipService } from './ownership.service';

// U5-02 with the database, Unit 1, Unit 3 and the parameters faked: the code's form, and what each step refuses.
// The same against PostgreSQL: test/api/game-listing.spec.ts.

const NOW = new Date('2026-12-01T10:00:00Z');
const GAME = {
  id: 3,
  slug: 'pubg',
  name: 'PUBG Mobile',
  platforms: ['android', 'ios'],
  code_placement: 'the bio',
  publisher_note: 'No transfers.',
  active: true,
};
const dbError = (code: string, message = '') => new QueryFailedError('q', [], Object.assign(new Error(message), { code }));

type Answer = (sql: string, params: unknown[]) => unknown;
function setup(answer: Answer, o: { listing?: Record<string, unknown> | null; cp36?: boolean } = {}) {
  const query = jest.fn(async (sql: string, params: unknown[] = []) => {
    const r = answer(sql, params);
    if (r instanceof Error) throw r;
    return r;
  });
  const db = { query, transaction: async <T>(fn: (m: unknown) => Promise<T>) => fn({ query }) };
  const listing = o.listing === undefined ? { sellerId: 'S', itemKind: 'game_account', status: 'draft' } : o.listing;
  const listings = {
    snapshot: jest.fn(async () => {
      if (!listing) throw new Problem('not-found');
      return listing;
    }),
  };
  const vault = {
    store: jest.fn(async () => ({ key: 'v1.ownership_proof.k', sha256: 'ab'.repeat(32), mime: 'image/jpeg', size: 10 })),
    erase: jest.fn(async () => undefined),
  };
  const audit = { record: jest.fn(async (_e: unknown, _m?: unknown) => undefined) };
  const params = { current: async () => ({ get: (k: string) => (k === 'CP-36' ? (o.cp36 ?? true) : null) }) };
  const svc = new OwnershipService(db as never, listings as never, vault as never, audit as never, params as never, { now: () => NOW });
  const sql = (part: string) => query.mock.calls.filter(([q]) => String(q).includes(part));
  return { svc, query, vault, audit, sql };
}
const reason = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: Problem) => (e.extra?.errors as { reason: string }[] | undefined)?.[0]?.reason ?? e.problem,
  );

describe('ownershipCode', () => {
  it('FR-GAM-03 TB-XXXX-XXXX: 40 bits in Crockford base32, without I, L, O and U', () => {
    expect(ownershipCode(Buffer.from([0, 0, 0, 0, 0]))).toBe('TB-0000-0000');
    expect(ownershipCode(Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff]))).toBe('TB-ZZZZ-ZZZZ');
    expect(ownershipCode(Buffer.from([0x00, 0x00, 0x00, 0x00, 0x21]))).toBe('TB-0000-0011');
    for (let i = 0; i < 200; i++) expect(ownershipCode()).toMatch(/^TB-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  });
});

describe('OwnershipService', () => {
  it('FR-GAM-01 the catalogue: active games for everyone; administrators add and change them, audited', async () => {
    const s = setup((q) => {
      if (q.startsWith('SELECT * FROM game_accounts.games WHERE active')) return [GAME];
      if (q.startsWith('INSERT INTO game_accounts.games')) return [GAME];
      if (q.includes('FOR UPDATE')) return [GAME];
      if (q.startsWith('UPDATE game_accounts.games')) return [[{ ...GAME, active: false }], 1];
      return [];
    });
    expect(await s.svc.games()).toEqual({
      items: [{ id: 3, slug: 'pubg', name: 'PUBG Mobile', platforms: ['android', 'ios'], codePlacement: 'the bio', publisherNote: 'No transfers.' }],
    });
    expect(
      await s.svc.addGame('A', {
        slug: 'pubg',
        name: ' PUBG Mobile ',
        platforms: [' android', 'ios'],
        codePlacement: 'the bio',
        publisherNote: 'No transfers.',
      }),
    ).toMatchObject({ id: 3, active: true });
    expect(s.sql('INSERT INTO game_accounts.games')[0][1]).toEqual(['pubg', 'PUBG Mobile', ['android', 'ios'], 'the bio', 'No transfers.']);
    expect(await s.svc.updateGame('A', 3, { active: false })).toMatchObject({ active: false });
    expect(s.audit.record.mock.calls.map(([e]) => (e as { action: string }).action)).toEqual(['games.catalogue.added', 'games.catalogue.updated']);
    const dup = setup(() => dbError('23505'));
    expect(await reason(dup.svc.addGame('A', { slug: 'pubg', name: 'x', platforms: ['pc'], codePlacement: 'b', publisherNote: 'n' }))).toBe('taken');
    const other = setup(() => dbError('XX000'));
    await expect(other.svc.addGame('A', { slug: 'p', name: 'x', platforms: ['pc'], codePlacement: 'b', publisherNote: 'n' })).rejects.toBeInstanceOf(
      QueryFailedError,
    );
    expect(await reason(setup(() => []).svc.updateGame('A', 9, { active: false }))).toBe('not-found');
  });

  it("FR-GAM-01 FR-GAM-02 only the seller's own game-account listing, still editable, and only while CP-36 is on", async () => {
    const ok = () => [{ platforms: ['android'] }];
    expect(
      await reason(setup(ok, { cp36: false }).svc.setDetails('S', 'L', { gameId: 3, platform: 'android', playerId: 'p1', contents: 'c'.repeat(10) })),
    ).toBe('feature-off');
    expect(await reason(setup(ok, { listing: null }).svc.setDetails('S', 'L', { gameId: 3, platform: 'android', playerId: 'p1', contents: 'c' }))).toBe(
      'not-found',
    );
    expect(await reason(setup(ok).svc.setDetails('X', 'L', { gameId: 3, platform: 'android', playerId: 'p1', contents: 'c' }))).toBe('not-found');
    expect(
      await reason(
        setup(ok, { listing: { sellerId: 'S', itemKind: 'physical', status: 'draft' } }).svc.setDetails('S', 'L', {
          gameId: 3,
          platform: 'android',
          playerId: 'p1',
          contents: 'c',
        }),
      ),
    ).toBe('not-found');
    expect(
      await reason(
        setup(ok, { listing: { sellerId: 'S', itemKind: 'game_account', status: 'active' } }).svc.setDetails('S', 'L', {
          gameId: 3,
          platform: 'android',
          playerId: 'p1',
          contents: 'c',
        }),
      ),
    ).toBe('not-editable');
  });

  it('FR-GAM-02 details: an offered platform of an active game; fixed after the proof', async () => {
    const d = { gameId: 3, platform: 'android', playerId: ' 5123 4567 ', contents: ' Level 70, skins. ' };
    const row = { listing_id: 'L', game_id: 3, platform: 'android', player_id: '5123 4567', contents: 'Level 70, skins.' };
    const s = setup((q) => (q.includes('FROM game_accounts.games') ? [{ platforms: ['android'] }] : [row]));
    expect(await s.svc.setDetails('S', 'L', d)).toEqual({
      listingId: 'L',
      gameId: 3,
      platform: 'android',
      playerId: '5123 4567',
      contents: 'Level 70, skins.',
    });
    expect(s.sql('INSERT INTO game_accounts.details')[0][1]).toEqual(['L', 'S', 3, 'android', '5123 4567', 'Level 70, skins.']);
    expect(await reason(setup(() => []).svc.setDetails('S', 'L', d))).toBe('unknown');
    expect(await reason(setup(() => [{ platforms: ['ios'] }]).svc.setDetails('S', 'L', d))).toBe('not-offered');
    const fixed = setup((q) =>
      q.includes('FROM game_accounts.games')
        ? [{ platforms: ['android'] }]
        : dbError('23514', 'game and player ID are fixed once ownership proof is submitted'),
    );
    expect(await reason(fixed.svc.setDetails('S', 'L', d))).toBe('fixed-after-proof');
    const invalid = setup((q) => (q.includes('FROM game_accounts.games') ? [{ platforms: ['android'] }] : dbError('23514', 'violates check')));
    expect(await reason(invalid.svc.setDetails('S', 'L', d))).toBe('invalid');
  });

  it('FR-GAM-03 a code needs the details; it replaces an unused one, not one under review', async () => {
    expect(await reason(setup(() => []).svc.issueCode('S', 'L'))).toBe('game-details-missing');
    const placement = [{ code_placement: 'the bio' }];
    const review = setup((q) => (q.includes('JOIN game_accounts.games') ? placement : q.includes('FOR UPDATE') ? [{ id: 'P', status: 'submitted' }] : []));
    expect(await reason(review.svc.issueCode('S', 'L'))).toBe('proof-under-review');
    let taken = 0;
    const s = setup((q) => {
      if (q.includes('JOIN game_accounts.games')) return placement;
      if (q.includes('FOR UPDATE')) return [{ id: 'P', status: 'issued' }];
      if (q.startsWith('INSERT INTO game_accounts.ownership_proofs') && taken++ === 0) return dbError('23505'); // a code taken twice: try again
      return [];
    });
    const c = await s.svc.issueCode('S', 'L');
    expect(c).toEqual({ code: expect.stringMatching(/^TB-/), expiresAt: new Date(NOW.getTime() + 7 * 86_400_000).toISOString(), placement: 'the bio' });
    expect(s.sql("SET status = 'expired'")).toHaveLength(1);
    expect(s.sql('INSERT INTO game_accounts.ownership_proofs')).toHaveLength(2);
    expect(s.sql('ROLLBACK TO SAVEPOINT')).toHaveLength(1);
    const broken = setup((q) =>
      q.includes('JOIN game_accounts.games') ? placement : q.startsWith('INSERT INTO game_accounts.ownership_proofs') ? dbError('XX000') : [],
    );
    await expect(broken.svc.issueCode('S', 'L')).rejects.toBeInstanceOf(QueryFailedError);
  });

  it('FR-GAM-03 the proof: on a listing held for review, an image, for an unexpired code; a file refused meanwhile is erased', async () => {
    const img = { buffer: Buffer.from('x'), mimetype: 'image/png' };
    const held = { listing: { sellerId: 'S', itemKind: 'game_account', status: 'pending_review' } };
    expect(await reason(setup(() => []).svc.submitProof('S', 'L', img))).toBe('not-submitted-for-review'); // a draft
    expect(await reason(setup(() => [], held).svc.submitProof('S', 'L', { buffer: Buffer.from('x'), mimetype: 'application/pdf' }))).toBe('type');
    expect(await reason(setup(() => [], held).svc.submitProof('S', 'L', img))).toBe('no-code');
    expect(await reason(setup(() => [{ id: 'P', expires_at: new Date(NOW.getTime() - 1) }], held).svc.submitProof('S', 'L', img))).toBe('code-expired');
    const s = setup(
      (q) => (q.startsWith('SELECT id, expires_at') ? [{ id: 'P', expires_at: new Date(NOW.getTime() + 1000) }] : [[{ submitted_at: NOW }], 1]),
      held,
    );
    expect(await s.svc.submitProof('S', 'L', img)).toEqual({ status: 'submitted', submittedAt: NOW.toISOString() });
    expect(s.vault.store).toHaveBeenCalledWith({ purpose: 'ownership_proof', ownerId: 'S', bytes: expect.any(Uint8Array) });
    const race = setup((q) => (q.startsWith('SELECT id, expires_at') ? [{ id: 'P', expires_at: new Date(NOW.getTime() + 1000) }] : [[], 0]), held);
    expect(await reason(race.svc.submitProof('S', 'L', img))).toBe('no-code');
    expect(race.vault.erase).toHaveBeenCalledWith('v1.ownership_proof.k');
  });

  it("FR-GAM-03 the seller's view: details and the latest proof, an unused code past its time shown as expired, a rejection with its reason", async () => {
    const s = setup(
      (q) =>
        q.includes('FROM game_accounts.details')
          ? [{ game_id: 3, platform: 'android', player_id: 'p1', contents: 'Level 70.' }]
          : [{ code: 'TB-0000-0000', status: 'issued', expires_at: new Date(NOW.getTime() - 1), submitted_at: null, reviewed_at: null, review_reason: null }],
      { listing: { sellerId: 'S', itemKind: 'game_account', status: 'active' } },
    );
    expect(await s.svc.status('S', 'L')).toEqual({
      details: { gameId: 3, platform: 'android', playerId: 'p1', contents: 'Level 70.' },
      proof: {
        code: 'TB-0000-0000',
        status: 'expired',
        expiresAt: new Date(NOW.getTime() - 1).toISOString(),
        submittedAt: null,
        reviewedAt: null,
        reason: null,
      },
    });
    const rejected = setup((q) =>
      q.includes('FROM game_accounts.details')
        ? []
        : [{ code: 'TB-0000-0000', status: 'rejected', expires_at: NOW, submitted_at: NOW, reviewed_at: NOW, review_reason: 'The code is not visible.' }],
    );
    expect(await rejected.svc.status('S', 'L')).toMatchObject({ details: null, proof: { status: 'rejected', reason: 'The code is not visible.' } });
    expect(await setup(() => []).svc.status('S', 'L')).toEqual({ details: null, proof: null });
  });
});
