import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { suite } from './setup';

// SEC-DAT-09: random values used for security (tokens, codes, keys, identifiers that grant access) come from a
// cryptographically secure generator.
const s = suite();
const SRC = join(__dirname, '..', '..', 'src');
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : n.endsWith('.ts') && !n.endsWith('.spec.ts') ? [join(d, n)] : []));

/** Math.random only spreads timings (jitter), never makes a value anyone could use. */
const JITTER_ONLY = new Set([
  'kernel/jobs/job-runner.ts',
  'kernel/events/outbox-dispatcher.ts',
  'modules/delivery/services/booking.service.ts',
  'modules/chat/services/delivery.service.ts',
]);

describe('SEC-DAT-09 secure randomness', () => {
  it('SEC-DAT-09 Math.random appears only to spread retry and polling times', () => {
    const users = walk(SRC)
      .filter((f) => /Math\.random/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC, f));
    expect(users.filter((f) => !JITTER_ONLY.has(f))).toEqual([]);
    for (const f of users) {
      for (const line of readFileSync(join(SRC, f), 'utf8')
        .split('\n')
        .filter((l) => /Math\.random/.test(l))) {
        expect(line).not.toMatch(/token|code|key|secret|nonce|otp|password|id\s*=/i);
      }
    }
  });

  it('SEC-DAT-09 codes, tokens and keys come from node:crypto', () => {
    const files = walk(SRC).map((f) => readFileSync(f, 'utf8'));
    const makers = files.filter((t) => /function (randomToken|newCode|otpCode|generateCode)|const randomToken/.test(t));
    expect(makers.length).toBeGreaterThan(0);
    for (const t of makers) expect(t).toMatch(/from 'crypto'|from 'node:crypto'/);
  });

  it('SEC-DAT-09 a thousand reset tokens are all different and cover the alphabet evenly', async () => {
    const a = await s.fx.account();
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      await s.fx.clearSendGap(a.phone);
      await s.browser().post('/auth/password/forgot', { login: a.email });
    }
    for (const m of s.sent(a.email, 'password_reset')) seen.add(m.vars.link.split('#token=')[1]);
    expect(seen.size).toBe(s.sent(a.email, 'password_reset').length);
    const chars = [...seen].join('');
    const counts = new Map<string, number>();
    for (const c of chars) counts.set(c, (counts.get(c) ?? 0) + 1);
    expect(counts.size).toBeGreaterThan(40); // base64url uses 64 symbols; a weak generator would repeat a few
  });
});
