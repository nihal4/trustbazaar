import { randomUUID } from 'crypto';
import { suite } from './setup';

// SEC-AUTH-06: registration resists enumeration as in SEC-AUTH-05: a duplicate e-mail gets the same answer
// as a new one, and the owner of the existing account is notified instead.
const s = suite();

describe('SEC-AUTH-06 registration enumeration', () => {
  const start = (o: { email?: string }) =>
    s.browser().post('/auth/register', { email: o.email ?? `n-${randomUUID()}@tb.test`, displayName: 'Shila Roy', password: 'quiet boats near the harbour' });

  it('SEC-AUTH-06 a duplicate e-mail gets the answer a new one gets; its owner is told and gets no code', async () => {
    const owner = await s.fx.account();
    const fresh = await start({});
    const dup = await start({ email: owner.email.toUpperCase() });
    expect(dup.status).toBe(fresh.status);
    expect(Object.keys(await dup.json()).sort()).toEqual(Object.keys(await fresh.json()).sort());
    expect(s.sent(owner.email, 'register_attempt_existing_email')).toHaveLength(1);
    expect(s.sent(owner.email, 'otp_register_email')).toHaveLength(0);
  });
});
