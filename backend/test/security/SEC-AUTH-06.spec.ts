import { randomUUID } from 'crypto';
import { newLocal, suite } from './setup';

// SEC-AUTH-06: registration resists enumeration as in SEC-AUTH-05: a duplicate number or e-mail gets the same answer
// as a new one, and the owner of the existing account is notified instead.
const s = suite();

describe('SEC-AUTH-06 registration enumeration', () => {
  const start = (o: { phone?: string; email?: string }) =>
    s.browser().post('/auth/register', { phone: o.phone ?? newLocal(), email: o.email ?? `n-${randomUUID()}@tb.test`, displayName: 'Shila Roy', password: 'quiet boats near the harbour', ...s.cfg.legal, adultConfirmed: true });

  it('SEC-AUTH-06 a duplicate number gets the answer a new one gets; its owner is told and gets no code', async () => {
    const owner = await s.fx.account();
    const fresh = await start({});
    const dup = await start({ phone: owner.local });
    expect(dup.status).toBe(fresh.status);
    expect(Object.keys(await dup.json()).sort()).toEqual(Object.keys(await fresh.json()).sort());
    expect(s.sent(owner.phone, 'register_attempt_existing_number')).toHaveLength(1);
    expect(s.sent(owner.phone, 'otp_register')).toHaveLength(0);
  });

  it('SEC-AUTH-06 a duplicate e-mail gets the answer a new one gets too', async () => {
    const owner = await s.fx.account();
    const fresh = await start({});
    const dup = await start({ email: owner.email.toUpperCase() });
    expect(dup.status).toBe(fresh.status);
    expect(Object.keys(await dup.json()).sort()).toEqual(Object.keys(await fresh.json()).sort());
  });
});
