import { Reflector } from '@nestjs/core';
import { DiscoveryService } from '@nestjs/core';
import { RATE_RULES } from '../../src/modules/identity/security/rate-rules';
import { problem, suite } from './setup';

// SEC-ABU-01: sign-in, registration, OTP requests, password reset, bidding, chat, listing creation, reporting, search
// and checkout are rate-limited, per account and per source address, with the limits of CP-04, CP-05 and CP-35.
const s = suite();

describe('SEC-ABU-01 rate limits', () => {
  it('SEC-ABU-01 every action the requirement names has a rule with a positive limit', () => {
    const named = ['signin', 'register', 'otp-send', 'reset', 'bid', 'chat', 'listing-create', 'chat-report', 'search', 'checkout'];
    for (const action of named) {
      expect(RATE_RULES[action]?.length ?? 0).toBeGreaterThan(0);
      for (const l of RATE_RULES[action]) expect(l.limit).toBeGreaterThan(0);
    }
    // per source address for the anonymous actions, per account for the signed-in ones
    for (const a of ['signin', 'register', 'otp-send', 'reset', 'search']) expect(RATE_RULES[a].some((l) => l.per === 'ip')).toBe(true);
    for (const a of ['bid', 'chat', 'listing-create', 'chat-report', 'checkout']) expect(RATE_RULES[a].some((l) => l.per === 'principal')).toBe(true);
  });

  it('SEC-ABU-01 the routes of those actions carry their rule', () => {
    const discovery = s.t.app.get(DiscoveryService);
    const reflector = s.t.app.get(Reflector);
    const rules = new Set<string>();
    for (const c of discovery.getControllers()) {
      const proto = Object.getPrototypeOf(c.instance ?? {});
      for (const name of Object.getOwnPropertyNames(proto)) {
        const handler = proto[name];
        if (typeof handler !== 'function') continue;
        for (const key of Reflect.getMetadataKeys(handler)) {
          const v = reflector.get(key, handler);
          if (typeof v === 'string' && v in RATE_RULES) rules.add(v);
        }
      }
    }
    for (const routed of ['signin', 'register', 'otp-send', 'reset', 'listing-create', 'search', 'checkout']) expect(rules).toContain(routed);
  });

  it('SEC-ABU-01 one address past the search limit gets 429 with Retry-After; another address does not', async () => {
    const b = s.browser();
    const statuses: number[] = [];
    for (let i = 0; i < 60; i++) statuses.push((await b.get('/search?q=phone')).status);
    expect(statuses.every((x) => x === 200)).toBe(true);
    const r = await b.get('/search?q=phone');
    expect(await problem(r)).toMatchObject({ status: 429, type: '/problems/rate-limited' });
    expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await s.browser().get('/search?q=phone')).status).toBe(200);
  });

  it('SEC-ABU-01 one account past its listing-creation limit (CP-35) is refused', async () => {
    const { b } = await s.signedIn({ kyc: 'verified' });
    const draft = { itemKind: 'physical', saleFormat: 'fixed_price', title: 'A thing to sell' };
    let refused: Response | undefined;
    for (let i = 0; i < 12 && !refused; i++) {
      const r = await b.post('/listings', draft);
      if (r.status === 429) refused = r;
    }
    expect(refused).toBeDefined();
    expect(Number(refused!.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});
