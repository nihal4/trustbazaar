import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

// Passwords (SEC-AUTH-03): Argon2id with at least OWASP's parameters, 19 MiB, 2 iterations, parallelism 1.
// verifyOrDummy does the same work whether or not the account exists, so neither the answer nor its
// timing reveals which numbers or e-mails are registered (SEC-AUTH-05). A hash made with older parameters
// is replaced after a successful sign-in (Unit 1 section 6.2).
export const ARGON2_PARAMS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

@Injectable()
export class PasswordHasher {
  private readonly dummy: Promise<string> = argon2.hash('dummy-password-for-unknown-accounts', ARGON2_PARAMS);

  hash(password: string): Promise<string> {
    return argon2.hash(password, ARGON2_PARAMS);
  }

  /** True only for a stored Argon2id hash of this password; a missing hash costs the same work and is false. */
  async verifyOrDummy(hash: string | null | undefined, password: string): Promise<boolean> {
    const target = hash?.startsWith('$argon2id$') ? hash : await this.dummy;
    try {
      const ok = await argon2.verify(target, password);
      return ok && target === hash;
    } catch {
      return false;
    }
  }

  needsRehash(hash: string): boolean {
    return argon2.needsRehash(hash, ARGON2_PARAMS);
  }
}
