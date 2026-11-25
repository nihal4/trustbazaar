import { randomInt } from 'crypto';

// Random phone numbers for the tests' accounts. A run creates thousands of them in one database and the live-phone index (users_phone_live) rejects a repeat,
// so two random numbers meeting made SEC-WEB-05 fail once in CI. The generator never hands out the same number twice in a process, and the fixtures
// that insert a user try again with a new number if the database already holds the one they drew (see withFreshPhone).

/** A Bangladeshi mobile number without the country code: 01 [3-9] then eight digits. */
const draw = (): string => `01${randomInt(3, 10)}${String(randomInt(0, 1e8)).padStart(8, '0')}`;

const given = new Set<string>();

export function randomLocal(): string {
  for (;;) {
    const local = draw();
    if (!given.has(local)) {
      given.add(local);
      return local;
    }
  }
}

/** The same number in E.164 form. */
export const randomPhone = (): string => `+88${randomLocal()}`;

const isTaken = (e: unknown): boolean => String((e as { message?: unknown } | null)?.message ?? '').includes('users_phone_live');

/** Runs an insert that carries a random phone number; if the database already holds that number, tries again with a new one. */
export async function withFreshPhone<T>(insert: (local: string) => Promise<T>, attempts = 8): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await insert(randomLocal());
    } catch (e) {
      if (attempt >= attempts || !isTaken(e)) throw e;
    }
  }
}
