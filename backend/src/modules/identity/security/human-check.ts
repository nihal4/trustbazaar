import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'crypto';
import type Redis from 'ioredis';
import { Problem } from '../../../kernel/http/problems';
import { REDIS } from '../../../kernel/redis.provider';

// The human-verification challenge (docs/design/09_integration.pdf section on SEC-ABU-02; I-64; U1-09). After
// repeated failures or unusual rates on registration, sign-in and OTP requests the server answers 428
// human-verification-required with a proof-of-work it issued itself: find a nonce such that
//     SHA-256(prefix + ":" + nonce)
// starts with `difficulty` zero bits (16: about 65,000 hashes on average, a second or less in a phone's Web Worker).
// The browser solves it (Unit 8) and repeats the request with  X-Human-Proof: <challenge id>:<nonce>.
// A challenge is stored in Redis for 5 minutes, bound to the action and the source address, and works once (GETDEL).
// No third-party script and no user data are involved; the rate limits remain the main control.
// If Redis cannot be reached no challenge is asked: the rate limits, which fail the same way, still apply.

export type HumanScope = 'register' | 'signin' | 'otp-send';
export const POW_DIFFICULTY = 16;
const POW_LIFETIME_SECONDS = 300;
export const HUMAN_PROOF_HEADER = 'x-human-proof';

export interface PowChallenge {
  id: string;
  algorithm: 'sha256';
  prefix: string;
  difficulty: number;
  expiresAt: string;
}

/** Leading zero bits of a digest. */
export function leadingZeroBits(digest: Buffer): number {
  let n = 0;
  for (const byte of digest) {
    if (byte === 0) {
      n += 8;
      continue;
    }
    return n + Math.clz32(byte) - 24;
  }
  return n;
}

export const powDigest = (prefix: string, nonce: string) => createHash('sha256').update(`${prefix}:${nonce}`).digest();

/** A solver, for tests and tools; the browser's runs in a Web Worker (Unit 8). */
export function solvePow(prefix: string, difficulty: number): string {
  for (let i = 0; ; i++) if (leadingZeroBits(powDigest(prefix, String(i))) >= difficulty) return String(i);
}

const key = (id: string) => `pow:${id}`;

// A request whose proof one check accepted counts as checked for the rest of its handling: a proof works once, so a
// second check on the same request (the address mark in the rate-limit guard, then the login's failures in the
// sign-in service) would otherwise ask again on every attempt (I-64, Decisions log 2026-11-23).
const checked = new WeakSet<object>();
export const markHumanChecked = (req: object) => {
  checked.add(req);
};
export const wasHumanChecked = (req: object) => checked.has(req);

@Injectable()
export class HumanCheck {
  private readonly log = new Logger('HumanCheck');

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** Passes with a valid proof for this action and address; otherwise refuses with a new challenge (428). */
  async require(scope: HumanScope, ip: string, proof: string | undefined, now = new Date()): Promise<void> {
    if (proof && (await this.verify(scope, ip, proof))) return;
    const challenge = await this.issue(scope, ip, now);
    if (!challenge) return; // Redis unavailable: no challenge rather than no service
    throw new Problem('human-verification-required', { challenge });
  }

  async issue(scope: HumanScope, ip: string, now = new Date()): Promise<PowChallenge | null> {
    const c: PowChallenge = {
      id: randomUUID(),
      algorithm: 'sha256',
      prefix: randomBytes(16).toString('hex'),
      difficulty: POW_DIFFICULTY,
      expiresAt: new Date(now.getTime() + POW_LIFETIME_SECONDS * 1000).toISOString(),
    };
    try {
      await this.redis.set(key(c.id), JSON.stringify({ scope, ip, prefix: c.prefix, difficulty: c.difficulty }), 'EX', POW_LIFETIME_SECONDS);
      return c;
    } catch (err) {
      this.log.warn(`human check unavailable: ${(err as Error).message}`);
      return null;
    }
  }

  /** One use only; the challenge must be for this action and this address. */
  async verify(scope: HumanScope, ip: string, proof: string): Promise<boolean> {
    const m = /^([0-9a-f-]{36}):([0-9A-Za-z]{1,32})$/.exec(proof);
    if (!m) return false;
    let raw: string | null;
    try {
      raw = await this.redis.getdel(key(m[1]));
    } catch {
      return false;
    }
    if (!raw) return false;
    const c = JSON.parse(raw) as { scope: string; ip: string; prefix: string; difficulty: number };
    return c.scope === scope && c.ip === ip && leadingZeroBits(powDigest(c.prefix, m[2])) >= c.difficulty;
  }
}
