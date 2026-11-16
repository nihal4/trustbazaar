import { Problem } from '../../../kernel/http/problems';
import type { ListingReviewService } from '../services/listing-review.service';
import type { ListingsQueriesService } from '../services/listings-queries.service';
import { ListingsStaffController } from './listings-staff.controller';

// The controller hands the operator and the input on; the rules are ListingReviewService's (its spec) and the policies
// are checked over HTTP (test/api/listing-review.spec.ts).
const staff = { type: 'staff', staffId: 'st', sessionId: 's', role: 'operator' } as const;
const user = { type: 'user', userId: 'u', sessionId: 's', accountStatus: 'active', kycStatus: 'verified', emailVerified: true } as const;
const req = { ip: '203.0.113.9', headers: { 'x-correlation-id': 'c1' } } as never;

describe('listings staff controller', () => {
  it('IF-UI-03 FR-LST-11 FR-LST-12 each route hands the operator and the input to the review service; users are refused', async () => {
    const T = new Date('2026-12-01T10:00:00Z');
    const fn = () => jest.fn(async (...args: unknown[]) => ({ args }));
    const r = { review: fn(), remove: fn(), terms: fn(), addTerm: fn(), deleteTerm: fn() };
    const q = { reviewQueue: jest.fn(async () => [{ listingId: 'L', sellerId: 'S', title: 'Watch', heldAt: T, reason: 'held' }]) };
    const c = new ListingsStaffController(r as unknown as ListingReviewService, q as unknown as ListingsQueriesService);
    expect(await c.queue()).toEqual({ items: [{ listingId: 'L', sellerId: 'S', title: 'Watch', heldAt: T.toISOString(), reason: 'held' }] });
    await c.decide('L', { decision: 'return', reason: 'Fix the photos.' }, staff, req);
    await c.remove('L', { reason: 'Counterfeit.' }, staff, req);
    await c.terms();
    await c.addTerm({ term: 'fake', severity: 'prohibited' }, staff, req);
    await c.deleteTerm(3, staff, { ip: '203.0.113.9', headers: {} } as never);
    const ctx = { ip: '203.0.113.9', correlationId: 'c1' };
    expect(r.review).toHaveBeenCalledWith('st', 'L', 'return', 'Fix the photos.', ctx);
    expect(r.remove).toHaveBeenCalledWith('st', 'L', 'Counterfeit.', ctx);
    expect(r.addTerm).toHaveBeenCalledWith('st', 'fake', 'prohibited', ctx);
    expect(r.deleteTerm).toHaveBeenCalledWith('st', 3, { ip: '203.0.113.9', correlationId: undefined });
    expect(() => c.remove('L', { reason: 'x' }, user, req)).toThrow(Problem);
  });
});
