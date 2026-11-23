import { createHash } from 'crypto';
import { describe, expect, it, vi } from 'vitest';
import { challengeOf, withHumanCheck } from './humanCheck';
import { leadingZeroBits, sha256, solvePow } from './pow';

// The human check's client side (SEC-ABU-02; I-64): the solver and the fetch wrapper that answers a 428.

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const nodeSha = (s: string) => createHash('sha256').update(s).digest('hex');
const challenge = (o: Record<string, unknown> = {}) => ({ id: 'c0ffee-1', algorithm: 'sha256', prefix: 'ab12', difficulty: 8, expiresAt: '2026-11-23T00:05:00Z', ...o });
const asked = (c: unknown = challenge()) => new Response(JSON.stringify({ type: '/problems/human-verification-required', title: 'wait', status: 428, challenge: c }), {
  status: 428, headers: { 'Content-Type': 'application/problem+json' },
});
const ok = () => new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } });

describe('solver', () => {
  it('SEC-ABU-02 SHA-256 matches the standard digest for empty, short and multi-block inputs', () => {
    for (const s of ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'x'.repeat(200), '0f3c9a:123456']) {
      expect(hex(sha256(new TextEncoder().encode(s)))).toBe(nodeSha(s));
    }
  });

  it('SEC-ABU-02 the nonce found meets the difficulty the server checks (16 bits), as Unit 1 computes it', async () => {
    const prefix = '9f86d081884c7d659a2feaa0c55ad015';
    const nonce = await solvePow(prefix, 16);
    expect(leadingZeroBits(createHash('sha256').update(`${prefix}:${nonce}`).digest())).toBeGreaterThanOrEqual(16);
    expect(leadingZeroBits(new Uint8Array([0, 0x10]))).toBe(11);
  });

  it('SEC-ABU-02 solving gives the page back between slices and stops when the request is cancelled', async () => {
    const c = new AbortController();
    const run = solvePow('ff', 40, { signal: c.signal, sliceMs: 1 });
    await new Promise((r) => setTimeout(r, 5));
    c.abort();
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('fetch wrapper', () => {
  it('SEC-ABU-02 a 428 challenge is solved and the same request is sent again with X-Human-Proof', async () => {
    const f = vi.fn().mockResolvedValueOnce(asked()).mockResolvedValueOnce(ok());
    const res = await withHumanCheck(f)('/api/v1/auth/signin', { method: 'POST', headers: { 'X-CSRF-Token': 't' }, body: '{"login":"a"}' });
    expect(res.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(2);
    const [url, init] = f.mock.calls[1] as [string, RequestInit];
    expect(url).toBe('/api/v1/auth/signin');
    expect(init.body).toBe('{"login":"a"}');
    const headers = new Headers(init.headers);
    expect(headers.get('X-CSRF-Token')).toBe('t');
    const [id, nonce] = headers.get('X-Human-Proof')!.split(':');
    expect(id).toBe('c0ffee-1');
    expect(leadingZeroBits(createHash('sha256').update(`ab12:${nonce}`).digest())).toBeGreaterThanOrEqual(8);
  });

  it('SEC-ABU-02 a second challenge gets one more attempt; a third 428 goes to the caller', async () => {
    const f = vi.fn().mockImplementation(async () => asked());
    const solve = vi.fn().mockResolvedValue('7');
    const res = await withHumanCheck(f, solve)('/x', { method: 'POST' });
    expect(res.status).toBe(428);
    expect(f).toHaveBeenCalledTimes(3);
    expect(solve).toHaveBeenCalledTimes(2);
  });

  it('SEC-ABU-02 other answers, and challenges this client cannot or should not solve, pass through untouched', async () => {
    const solve = vi.fn();
    for (const res of [ok(), new Response('', { status: 429 }), new Response('not json', { status: 428 }),
      asked({ algorithm: 'md5' }), asked({ difficulty: 40 }), asked({ id: 'a:b' }), asked(null)]) {
      const f = vi.fn().mockResolvedValue(res);
      expect(await withHumanCheck(f, solve)('/x')).toBe(res);
      expect(f).toHaveBeenCalledTimes(1);
    }
    expect(solve).not.toHaveBeenCalled();
    expect(await challengeOf(asked())).toMatchObject({ id: 'c0ffee-1', difficulty: 8 });
  });
});
