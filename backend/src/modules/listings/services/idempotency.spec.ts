import type Redis from 'ioredis';
import { Problem } from '../../../kernel/http/problems';
import { IdempotencyKeys } from './idempotency';
import { normaliseForScreening, ScreeningService } from './screening.service';

/** Enough of Redis for SET NX EX, GET and DEL. */
function fakeRedis(o: { down?: boolean } = {}) {
  const store = new Map<string, string>();
  const fail = async () => {
    throw new Error('connection refused');
  };
  const redis = {
    store,
    set: o.down ? fail : async (k: string, v: string, ...args: string[]) => {
      if (args.includes('NX') && store.has(k)) return null;
      store.set(k, v);
      return 'OK';
    },
    get: async (k: string) => store.get(k) ?? null,
    del: async (k: string) => Number(store.delete(k)),
  };
  return redis;
}

describe('IdempotencyKeys (I-53)', () => {
  it('I-53 without a key every request creates', async () => {
    const keys = new IdempotencyKeys(fakeRedis() as unknown as Redis);
    let n = 0;
    expect(await keys.once('listing', 'u1', undefined, async () => `id${++n}`)).toEqual({ id: 'id1', repeated: false });
    expect(await keys.once('listing', 'u1', undefined, async () => `id${++n}`)).toEqual({ id: 'id2', repeated: false });
  });

  it('I-53 a repeated key answers with the first result, per user', async () => {
    const r = fakeRedis();
    const keys = new IdempotencyKeys(r as unknown as Redis);
    const create = jest.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second');
    expect(await keys.once('listing', 'u1', 'key-12345678', create)).toEqual({ id: 'first', repeated: false });
    expect(await keys.once('listing', 'u1', 'key-12345678', create)).toEqual({ id: 'first', repeated: true });
    expect(await keys.once('listing', 'u2', 'key-12345678', create)).toEqual({ id: 'second', repeated: false });
    expect(create).toHaveBeenCalledTimes(2);
    expect([...r.store.keys()].every((k) => !k.includes('key-12345678'))).toBe(true); // the key itself is hashed
  });

  it('I-53 a repeat while the first is running is refused; a failure frees the key', async () => {
    const r = fakeRedis();
    const keys = new IdempotencyKeys(r as unknown as Redis);
    let release!: () => void;
    const slow = keys.once('listing', 'u1', 'key-abcdefgh', () => new Promise<string>((res) => (release = () => res('done'))));
    await new Promise((res) => setImmediate(res));
    await expect(keys.once('listing', 'u1', 'key-abcdefgh', async () => 'x')).rejects.toMatchObject({ problem: 'request-in-progress' });
    release();
    await slow;
    await expect(keys.once('listing', 'u1', 'key-failing1', async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(await keys.once('listing', 'u1', 'key-failing1', async () => 'retried')).toEqual({ id: 'retried', repeated: false });
  });

  it('I-53 a key that expired between the two calls is claimed again', async () => {
    const r = fakeRedis();
    const keys = new IdempotencyKeys(r as unknown as Redis);
    let first = true;
    const set = r.set;
    r.set = async (k: string, v: string, ...a: string[]) => {
      if (first) {
        first = false;
        return null; // taken ...
      }
      return set(k, v, ...a); // ... and gone by the GET
    };
    expect(await keys.once('listing', 'u1', 'key-expired1', async () => 'again')).toEqual({ id: 'again', repeated: false });
  });

  it('I-53 a malformed key is a validation error; without Redis the request goes ahead', async () => {
    const keys = new IdempotencyKeys(fakeRedis() as unknown as Redis);
    await expect(keys.once('listing', 'u1', 'short', async () => 'x')).rejects.toBeInstanceOf(Problem);
    const down = new IdempotencyKeys(fakeRedis({ down: true }) as unknown as Redis);
    expect(await down.once('listing', 'u1', 'key-12345678', async () => 'anyway')).toEqual({ id: 'anyway', repeated: false });
  });
});

describe('ScreeningService (FR-LST-11)', () => {
  it('FR-LST-11 title and description are matched in one normalised, lower-case text', async () => {
    const query = jest.fn().mockResolvedValue([{ term: 'password', severity: 'high_risk' }]);
    const found = await new ScreeningService().matches({ query } as never, 'PUBG  Account', 'With\nPASSWORD পাসওয়ার্ড');
    expect(found).toEqual([{ term: 'password', severity: 'high_risk' }]);
    expect(query.mock.calls[0][1]).toEqual(['pubg account with password পাসওয়ার্ড']);
    expect(normaliseForScreening('Aé  B')).toBe('aé b');
  });
});
