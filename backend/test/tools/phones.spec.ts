import { randomLocal, randomPhone, withFreshPhone } from '../support/phones';

// NFR-MNT-02: the automated tests must be reliable. The test accounts' phone numbers are random and the live-phone index rejects a repeat, so the
// generator never repeats a number inside a process and the fixtures try again when the database already holds the one they drew.

describe('the test phone numbers', () => {
  it('NFR-MNT-02 are Bangladeshi mobile numbers and never repeat inside a process', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20000; i++) {
      const local = randomLocal();
      expect(local).toMatch(/^01[3-9]\d{8}$/);
      expect(seen.has(local)).toBe(false);
      seen.add(local);
    }
    expect(randomPhone()).toMatch(/^\+8801[3-9]\d{8}$/);
  });

  it('NFR-MNT-02 an insert that meets a number already in the database is tried again with a new number', async () => {
    const drawn: string[] = [];
    const id = await withFreshPhone(async (local) => {
      drawn.push(local);
      if (drawn.length < 3) throw new Error('duplicate key value violates unique constraint "users_phone_live"');
      return 'user-1';
    });
    expect(id).toBe('user-1');
    expect(drawn).toHaveLength(3);
    expect(new Set(drawn).size).toBe(3);
  });

  it('NFR-MNT-02 any other error is not hidden, and the retries stop after the given number of attempts', async () => {
    let calls = 0;
    await expect(
      withFreshPhone(async () => {
        calls++;
        throw new Error('connection terminated');
      }),
    ).rejects.toThrow('connection terminated');
    expect(calls).toBe(1);
    calls = 0;
    await expect(
      withFreshPhone(async () => {
        calls++;
        throw new Error('violates unique constraint "users_phone_live"');
      }, 4),
    ).rejects.toThrow('users_phone_live');
    expect(calls).toBe(4);
  });
});
