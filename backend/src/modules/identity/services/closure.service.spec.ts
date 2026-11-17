import { Problem } from '../../../kernel/http/problems';
import { ClosureService } from './closure.service';

// ClosureService (U1-09) with fakes; the flows against PostgreSQL are in test/api/account-closure.spec.ts.
const CTX = { ip: '203.0.113.1', userAgent: 'test', correlationId: 'c' };

describe('ClosureService', () => {
  const outbox = jest.fn();
  function setup(o: { status?: string; pendingKyc?: boolean; erased?: { storage_key: string }[]; due?: { id: string }[] } = {}) {
    const m = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('FROM identity.kyc_submissions')) return o.pendingKyc ? [{}] : [];
        if (sql.includes('FOR UPDATE')) return o.status === undefined ? [{ account_status: 'active' }] : o.status === 'none' ? [] : [{ account_status: o.status }];
        if (sql.includes('RETURNING erase_after')) return [[{ erase_after: new Date('2026-12-17T00:00:00Z') }], 1];
        if (sql.includes('erase_user')) return o.erased ?? [];
        if (sql.includes('erase_rejected_kyc')) return [{ storage_key: 'r1' }];
        if (sql.includes('erase_after <= now()')) return o.due ?? [];
        return [];
      }),
      getRepository: () => ({ insert: outbox }),
    };
    const db = { manager: m, query: m.query, transaction: async (cb: (x: typeof m) => unknown) => cb(m) };
    const sessions = { endAllIn: jest.fn() };
    const audit = { record: jest.fn() };
    const vault = { erase: jest.fn(async (_p: string, k: string) => { if (k === 'bad') throw new Error('disk'); }) };
    const params = { current: async () => ({ get: () => '30 days' }) };
    const svc = new ClosureService(db as never, sessions as never, audit as never, vault as never, params as never);
    return { svc, m, sessions, audit, vault };
  }

  it('FR-ACC-11 reasons from every check, sorted and without repeats; a name registers once', async () => {
    const s = setup({ pendingKyc: true });
    s.svc.register({ name: 'a', blockers: async () => ['open-order', 'leading-bid'] });
    s.svc.register({ name: 'b', blockers: async () => ['open-order'] });
    expect(() => s.svc.register({ name: 'a', blockers: async () => [] })).toThrow('twice');
    expect(await s.svc.blockers('U', 'closure')).toEqual(['kyc-under-review', 'leading-bid', 'open-order']);
    await expect(s.svc.close('U', CTX)).rejects.toMatchObject({ problem: 'account-not-closable' });
    expect(s.sessions.endAllIn).not.toHaveBeenCalled();
  });

  it('FR-ACC-11 a closure sets erase_after by CP-41, ends sessions, audits and publishes; a closed account is not found', async () => {
    const s = setup();
    await s.svc.close('U', CTX);
    expect(s.m.query).toHaveBeenCalledWith(expect.stringContaining("account_status = 'closed'"), ['U', '30 days']);
    expect(s.sessions.endAllIn).toHaveBeenCalledWith(s.m, 'U', null, 'closed', CTX);
    expect(s.audit.record).toHaveBeenCalledWith(s.m, expect.objectContaining({ action: 'identity.account.closed', sourceIp: '203.0.113.1' }));
    expect(outbox).toHaveBeenCalledWith({ eventType: 'identity.account.closed', aggregateId: 'U', payload: { userId: 'U', eraseAfter: '2026-12-17T00:00:00.000Z' } });
    await expect(setup({ status: 'closed' }).svc.close('U', CTX)).rejects.toThrow(Problem);
    await expect(setup({ status: 'none' }).svc.close('U', CTX)).rejects.toThrow(Problem);
  });

  it('FR-PRV-04 the erasure job skips held accounts, erases the others, deletes blobs and tolerates a failed delete', async () => {
    const s = setup({ due: [{ id: 'H' }, { id: 'E' }], erased: [{ storage_key: 'k1' }, { storage_key: 'bad' }] });
    s.svc.register({ name: 'x', blockers: async (id) => (id === 'H' ? ['payout-pending'] : []) });
    expect(await s.svc.eraseDue()).toEqual({ erased: 1, held: 1, rejectedKyc: 1 });
    expect(s.vault.erase.mock.calls.map((c) => c[1])).toEqual(['k1', 'bad', 'r1']);
    expect(s.audit.record).toHaveBeenCalledWith(s.m, expect.objectContaining({ action: 'identity.account.erased', objectId: 'E', after: { kycFiles: 2 } }));
  });
});
