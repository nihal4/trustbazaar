import { Problem } from '../../../kernel/http/problems';
import type { HandoverService } from '../services/handover.service';
import { HandoverController } from './handover.controller';

// The controller only passes the caller and the input on; the rules are HandoverService's (its spec) and the policies
// are checked over HTTP (test/api/game-checkout.spec.ts).
const user = { type: 'user', userId: 'u1', sessionId: 's1', accountStatus: 'active', kycStatus: 'verified', emailVerified: true } as const;
const staff = { type: 'staff', staffId: 'st', sessionId: 's2', role: 'operator' } as const;

describe('handover controller', () => {
  it('IF-UI-03 FR-GAM-05 FR-GAM-07 each route hands the user, the session and the input to HandoverService; staff are refused', async () => {
    const fn = () => jest.fn(async (...args: unknown[]) => ({ args }));
    const s = { acknowledge: fn(), registerKey: fn(), view: fn() };
    const c = new HandoverController(s as unknown as HandoverService);
    await c.acknowledge('o1', { version: 1 }, user);
    await c.key('o1', { publicKey: 'k' }, user);
    await c.status('o1', user);
    expect(s.acknowledge).toHaveBeenCalledWith('u1', 'o1', 1);
    expect(s.registerKey).toHaveBeenCalledWith('u1', 'o1', 's1', 'k');
    expect(s.view).toHaveBeenCalledWith('u1', 'o1');
    expect(() => c.status('o1', staff)).toThrow(Problem);
  });
});
