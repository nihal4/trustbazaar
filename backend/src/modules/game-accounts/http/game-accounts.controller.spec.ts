import { Problem } from '../../../kernel/http/problems';
import type { OwnershipReviewService } from '../services/ownership-review.service';
import type { OwnershipService } from '../services/ownership.service';
import { GameAccountsController } from './game-accounts.controller';

// The controller only passes the caller and the request on; the rules are OwnershipService's (its spec) and the policies
// are checked over HTTP (test/api/game-listing.spec.ts).
const user = { type: 'user', userId: 'u1', sessionId: 's1', accountStatus: 'active', kycStatus: 'verified', emailVerified: true } as const;
const staff = { type: 'staff', staffId: 'st', sessionId: 's2', role: 'administrator' } as const;
const req = { ip: '203.0.113.9', headers: { 'x-correlation-id': 'c1' } } as never;

describe('game accounts controller', () => {
  it('IF-UI-03 FR-GAM-01 FR-GAM-03 each route hands its caller and input to OwnershipService; users and staff keep to their own routes', async () => {
    const fn = () => jest.fn(async (...args: unknown[]) => ({ args }));
    const s = { games: fn(), addGame: fn(), updateGame: fn(), setDetails: fn(), issueCode: fn(), submitProof: fn(), status: fn() };
    const r = { queue: fn(), screenshot: fn(), review: fn() };
    const c = new GameAccountsController(s as unknown as OwnershipService, r as unknown as OwnershipReviewService);
    const game = { slug: 'pubg', name: 'PUBG Mobile', platforms: ['android'], codePlacement: 'the bio', publisherNote: 'No transfers allowed.' };
    const details = { gameId: 3, platform: 'android', playerId: 'p1', contents: 'Level 70, skins.' };
    const file = { buffer: Buffer.from('x'), mimetype: 'image/png' };
    await c.games();
    await c.addGame(game, staff, req);
    await c.updateGame(3, { active: false }, staff, req);
    await c.details('l1', details, user);
    await c.code('l1', user);
    await c.proof('l1', file, user);
    await c.status('l1', user);
    expect(s.games).toHaveBeenCalledWith();
    expect(s.addGame).toHaveBeenCalledWith('st', game, { ip: '203.0.113.9', correlationId: expect.any(String) });
    expect(s.updateGame).toHaveBeenCalledWith('st', 3, { active: false }, expect.objectContaining({ ip: '203.0.113.9' }));
    expect(s.setDetails).toHaveBeenCalledWith('u1', 'l1', details);
    expect(s.issueCode).toHaveBeenCalledWith('u1', 'l1');
    expect(s.submitProof).toHaveBeenCalledWith('u1', 'l1', file);
    expect(s.status).toHaveBeenCalledWith('u1', 'l1');
    await c.proofs();
    await c.screenshot('p1', staff, req);
    await c.decide('p1', { decision: 'reject', liveCheck: 'not_matched', reason: 'Not visible on the profile.' }, staff, req);
    expect(r.queue).toHaveBeenCalledWith();
    expect(r.screenshot).toHaveBeenCalledWith(staff, 'p1', expect.objectContaining({ ip: '203.0.113.9' }));
    expect(r.review).toHaveBeenCalledWith('st', 'p1', { approve: false, liveCheck: 'not_matched', reason: 'Not visible on the profile.' }, expect.objectContaining({ ip: '203.0.113.9' }));
    expect(() => c.screenshot('p1', user as never, req)).toThrow(Problem);
    expect(() => c.proof('l1', undefined, user)).toThrow(Problem);
    expect(() => c.addGame(game, user as never, req)).toThrow(Problem);
    expect(() => c.code('l1', staff as never)).toThrow(Problem);
  });
});
