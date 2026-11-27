import { LoginCheckService, type DomainResolver, type DomainState } from './login-check.service';

// FR-ACC-13 (U10-25): the check before the password, with a stand-in resolver and a stand-in Redis; it never reads an account.
const memory = () => {
  const m = new Map<string, string>();
  return {
    get: async (k: string) => m.get(k) ?? null,
    set: async (k: string, v: string) => {
      m.set(k, v);
      return 'OK';
    },
    keys: m,
  } as never;
};
const resolver = (answers: Record<string, DomainState>) => {
  const asked: string[] = [];
  const r: DomainResolver = {
    exists: async (d) => {
      asked.push(d);
      return answers[d] ?? 'unknown';
    },
  };
  return { r, asked };
};

describe('the check before the password', () => {
  it('FR-ACC-13 a mobile number of Bangladesh passes without a lookup; anything that is neither a number nor an e-mail fails on its form', async () => {
    const { r, asked } = resolver({});
    const c = new LoginCheckService(r, memory());
    expect(await c.check('01712345678')).toEqual({ ok: true });
    expect(await c.check('+880 1712-345678')).toEqual({ ok: true });
    for (const bad of ['c', 'nihal', 'nihal@', '@x.com', 'a@b', 'a b@c.com', '0171', 'a@b..com', '12345678901234567890'])
      expect(await c.check(bad)).toEqual({ ok: false, reason: 'format' });
    expect(asked).toEqual([]);
  });

  it('FR-ACC-13 an e-mail whose domain does not exist fails on its domain; one that exists passes; the answers are kept', async () => {
    const { r, asked } = resolver({ 'example.com': 'yes', 'examle.com': 'no' });
    const c = new LoginCheckService(r, memory());
    expect(await c.check('nihal@examle.com')).toEqual({ ok: false, reason: 'domain' });
    expect(await c.check('Nihal@Example.COM')).toEqual({ ok: true });
    expect(await c.check('other@example.com')).toEqual({ ok: true });
    expect(await c.check('again@examle.com')).toEqual({ ok: false, reason: 'domain' });
    expect(asked).toEqual(['examle.com', 'example.com']); // one lookup for each domain
  });

  it('FR-ACC-13 while no mail is really sent (log mode) the reserved .test domain passes without a lookup; with real mail it is looked up like any other', async () => {
    const { r, asked } = resolver({ 'trustbazaar.test': 'no' });
    expect(await new LoginCheckService(r, memory(), { emailMode: 'log' }).check('seller@trustbazaar.test')).toEqual({ ok: true });
    expect(asked).toEqual([]);
    expect(await new LoginCheckService(r, memory(), { emailMode: 'smtp' }).check('seller@trustbazaar.test')).toEqual({ ok: false, reason: 'domain' });
  });

  it('FR-ACC-13 a lookup that cannot be answered lets the sign-in go on, and is not kept', async () => {
    const { r, asked } = resolver({});
    const c = new LoginCheckService(r, memory());
    expect(await c.check('a@somewhere.org')).toEqual({ ok: true });
    expect(await c.check('b@somewhere.org')).toEqual({ ok: true });
    expect(asked).toEqual(['somewhere.org', 'somewhere.org']);
  });
});
