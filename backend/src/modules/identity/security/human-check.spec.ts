import { Problem } from '../../../kernel/http/problems';
import { HumanCheck, leadingZeroBits, powDigest, POW_DIFFICULTY, solvePow } from './human-check';

// SEC-ABU-02 (U1-09): the proof-of-work with Redis faked; on the running backend in test/api/human-check.spec.ts.
describe('HumanCheck', () => {
  function fakeRedis() {
    const store = new Map<string, string>();
    return {
      store,
      set: jest.fn(async (k: string, v: string) => void store.set(k, v)),
      getdel: jest.fn(async (k: string) => {
        const v = store.get(k) ?? null;
        store.delete(k);
        return v;
      }),
    };
  }
  const challengeOf = async (p: Promise<unknown>) => ((await p.catch((e: unknown) => e)) as Problem).extra.challenge as { id: string; prefix: string; difficulty: number };

  it('SEC-ABU-02 leading zero bits are counted across bytes', () => {
    expect(leadingZeroBits(Buffer.from([0x00, 0x00, 0x80]))).toBe(16);
    expect(leadingZeroBits(Buffer.from([0x00, 0x0f]))).toBe(12);
    expect(leadingZeroBits(Buffer.from([0xff]))).toBe(0);
    expect(leadingZeroBits(Buffer.from([0, 0]))).toBe(16);
    const nonce = solvePow('abc', 8);
    expect(leadingZeroBits(powDigest('abc', nonce))).toBeGreaterThanOrEqual(8);
  });

  it('SEC-ABU-02 without a valid proof the request is refused with a challenge that works once, for its action and address', async () => {
    const redis = fakeRedis();
    const h = new HumanCheck(redis as never);
    const c = await challengeOf(h.require('register', '1.1.1.1', undefined, new Date('2026-11-17T00:00:00Z')));
    expect(c).toMatchObject({ algorithm: 'sha256', difficulty: POW_DIFFICULTY, expiresAt: '2026-11-17T00:05:00.000Z' });
    expect(redis.set).toHaveBeenCalledWith(`pow:${c.id}`, expect.any(String), 'EX', 300);
    const proof = `${c.id}:${solvePow(c.prefix, c.difficulty)}`;
    await expect(h.require('register', '1.1.1.1', proof)).resolves.toBeUndefined();
    await expect(h.require('register', '1.1.1.1', proof)).rejects.toThrow(Problem); // used
    const c2 = await challengeOf(h.require('register', '1.1.1.1', undefined));
    expect(await h.verify('signin', '1.1.1.1', `${c2.id}:${solvePow(c2.prefix, c2.difficulty)}`)).toBe(false); // another action
    const c3 = await challengeOf(h.require('register', '1.1.1.1', undefined));
    expect(await h.verify('register', '2.2.2.2', `${c3.id}:${solvePow(c3.prefix, c3.difficulty)}`)).toBe(false); // another address
    expect(await h.verify('register', '1.1.1.1', 'not-a-proof')).toBe(false);
    expect(await h.verify('register', '1.1.1.1', `${c3.id}:!!`)).toBe(false);
  });

  it('SEC-ABU-02 with Redis down no challenge is asked; the rate limits still apply', async () => {
    const down = { set: jest.fn().mockRejectedValue(new Error('down')), getdel: jest.fn().mockRejectedValue(new Error('down')) };
    const h = new HumanCheck(down as never);
    await expect(h.require('otp-send', '1.1.1.1', undefined)).resolves.toBeUndefined();
    expect(await h.verify('otp-send', '1.1.1.1', '00000000-0000-4000-8000-000000000000:1')).toBe(false);
  });
});
