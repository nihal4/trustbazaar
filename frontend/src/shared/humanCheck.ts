// Answering the human check (SEC-ABU-02; I-64). After repeated failures or unusual rates on registration, sign-in and
// code sending, Unit 1 answers 428 `human-verification-required` with a challenge {id, algorithm, prefix, difficulty,
// expiresAt}. This wraps the fetch that lib/api.js is given, so the reference client stays unchanged and every caller
// gets it: the challenge is solved (pow.ts) and the same request is sent again with  X-Human-Proof: <id>:<nonce>.
// A challenge works once and only for its action and address, so a second 428 gets one more attempt; then the 428
// goes to the caller, whose form shows its message.

import { solvePow } from './pow';

type Fetch = typeof globalThis.fetch;
type Solve = (prefix: string, difficulty: number, o: { signal?: AbortSignal }) => Promise<string>;

export interface HumanChallenge {
  id: string;
  algorithm: 'sha256';
  prefix: string;
  difficulty: number;
}

const MAX_SOLVES = 2;
const MAX_DIFFICULTY = 24; // 16 is issued; anything far above it would hold the page for minutes

/** The challenge of a 428 answer, if it is one this client can solve. */
export async function challengeOf(res: Response): Promise<HumanChallenge | null> {
  if (res.status !== 428) return null;
  try {
    const p = (await res.clone().json()) as { type?: unknown; challenge?: Partial<HumanChallenge> };
    const c = p.challenge;
    if (typeof p.type !== 'string' || !p.type.endsWith('human-verification-required') || !c) return null;
    if (c.algorithm !== 'sha256' || typeof c.id !== 'string' || !/^[\w-]{1,64}$/.test(c.id) || typeof c.prefix !== 'string') return null;
    if (!Number.isInteger(c.difficulty) || c.difficulty! < 1 || c.difficulty! > MAX_DIFFICULTY) return null;
    return c as HumanChallenge;
  } catch {
    return null;
  }
}

export function withHumanCheck(f: Fetch, solve: Solve = solvePow): Fetch {
  return async (input, init = {}) => {
    let res = await f(input, init);
    for (let n = 0; n < MAX_SOLVES; n++) {
      const c = await challengeOf(res);
      if (!c) return res;
      const nonce = await solve(c.prefix, c.difficulty, { signal: init.signal ?? undefined });
      const headers = new Headers(init.headers);
      headers.set('X-Human-Proof', `${c.id}:${nonce}`);
      res = await f(input, { ...init, headers });
    }
    return res;
  };
}
