import { Problem } from '../../../kernel/http/problems';
import type { HandoverService } from '../services/handover.service';
import type { TakeoverService } from '../services/takeover.service';
import { HandoverController, parseStep } from './handover.controller';

// The controller only passes the caller and the input on; the rules are HandoverService's (its spec) and the policies
// are checked over HTTP (test/api/game-checkout.spec.ts).
const user = { type: 'user', userId: 'u1', sessionId: 's1', accountStatus: 'active', kycStatus: 'verified', emailVerified: true } as const;
const staff = { type: 'staff', staffId: 'st', sessionId: 's2', role: 'operator' } as const;

describe('handover controller', () => {
  it('IF-UI-03 FR-GAM-05 FR-GAM-07 FR-GAM-09 FR-GAM-11 FR-GAM-12 FR-GAM-13 FR-GAM-14 each route hands the user, the session and the input to HandoverService; staff are refused', async () => {
    const fn = () => jest.fn(async (...args: unknown[]) => ({ args }));
    const s = { acknowledge: fn(), registerKey: fn(), view: fn(), buyerKey: fn(), deliver: fn(), retrieve: fn() };
    const tk = { confirmStep: fn(), reportInvalid: fn(), requestRekey: fn() };
    const c = new HandoverController(s as unknown as HandoverService, tk as unknown as TakeoverService);
    await c.acknowledge('o1', { version: 1 }, user);
    await c.key('o1', { publicKey: 'k' }, user);
    await c.status('o1', user);
    expect(s.acknowledge).toHaveBeenCalledWith('u1', 'o1', 1);
    expect(s.registerKey).toHaveBeenCalledWith('u1', 'o1', 's1', 'k');
    expect(s.view).toHaveBeenCalledWith('u1', 'o1');
    const sealed = { keyVersion: 1, enc: 'e', ciphertext: 'c' };
    await c.buyerKey('o1', user);
    await c.deliver('o1', sealed, user);
    await c.sealed('o1', user, { ip: '203.0.113.5' } as never);
    expect(s.buyerKey).toHaveBeenCalledWith('u1', 'o1');
    expect(s.deliver).toHaveBeenCalledWith('u1', 'o1', sealed);
    expect(s.retrieve).toHaveBeenCalledWith('u1', 'o1', 's1', '203.0.113.5');
    await c.sealed('o1', user, {} as never);
    expect(s.retrieve).toHaveBeenLastCalledWith('u1', 'o1', 's1', null);
    await c.confirmStep('o1', 'password', user);
    await c.reportInvalid('o1', { description: 'The password is refused by the game.' }, user);
    await c.rekey('o1', { publicKey: 'k2' }, user);
    expect(tk.confirmStep).toHaveBeenCalledWith('u1', 'o1', 'password', 's1');
    expect(tk.reportInvalid).toHaveBeenCalledWith('u1', 'o1', 'The password is refused by the game.');
    expect(tk.requestRekey).toHaveBeenCalledWith('u1', 'o1', 's1', 'k2');
    expect(() => c.status('o1', staff)).toThrow(Problem);
    expect(parseStep('two_step')).toBe('two_step');
    expect(() => parseStep('anything')).toThrow(Problem);
  });
});
