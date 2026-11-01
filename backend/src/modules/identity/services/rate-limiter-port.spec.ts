import type { ConfigPort } from '../../../kernel/config-port';
import type { RateLimiter } from '../security/rate-limiter.service';
import { RateLimiterPortAdapter } from './identity-ports';

// RateLimiterPort reads a rule's limit from its parameter, as RateLimitGuard does (Decisions log, U3-04).
function setup(cp35: Record<string, unknown> | undefined) {
  const hit = jest.fn(async () => ({ allowed: true, retryAfterSeconds: 0 }));
  const params = { current: async () => ({ get: (code: string) => (code === 'CP-35' ? cp35 : undefined) }) } as unknown as ConfigPort;
  return { hit, port: new RateLimiterPortAdapter({ hit } as unknown as RateLimiter, params) };
}

describe('RateLimiterPortAdapter', () => {
  it('FR-AUC-17 the bid limit is CP-35 bids_per_min per user and auction', async () => {
    const { hit, port } = setup({ bids_per_min: 4 });
    await port.consume('bid', 'user-1:auction-1');
    expect(hit).toHaveBeenCalledWith('rl:bid:user-1:auction-1', 4, 60);
  });

  it('FR-AUC-17 without a usable CP-35 value the rule\'s own limit applies', async () => {
    for (const cp35 of [undefined, { bids_per_min: 0 }, { bids_per_min: 'ten' }]) {
      const { hit, port } = setup(cp35);
      await port.consume('bid', 's');
      expect(hit).toHaveBeenCalledWith('rl:bid:s', 10, 60);
    }
  });

  it('SEC-ABU-01 a refused hit is rate-limited with its Retry-After', async () => {
    const { hit, port } = setup({ bids_per_min: 10 });
    hit.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 42 });
    await expect(port.consume('bid', 's')).rejects.toMatchObject({ problem: 'rate-limited', extra: { retryAfter: 42 } });
  });
});
