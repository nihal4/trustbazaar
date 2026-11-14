import { webcrypto } from 'crypto';
import { QueryFailedError } from 'typeorm';
import { Problem } from '../../../kernel/http/problems';
import { TakeoverService } from './takeover.service';

// U5-04 with the database, Units 2, 6 and 7 and the parameters faked: the DC-14 order of locks, the delivery event at
// completion, the dispute in the report's transaction, and how the database's refusals reach the buyer. The same
// against PostgreSQL: test/api/game-takeover.spec.ts.

const T = new Date('2026-12-01T10:00:00Z');
const dbError = (message: string) => new QueryFailedError('q', [], Object.assign(new Error(message), { code: '23514' }));

function setup(answer: (sql: string) => unknown = () => [], o: { facts?: Record<string, unknown>; dispute?: () => Promise<string>; notifyFails?: boolean } = {}) {
  const calls: string[] = [];
  const query = jest.fn(async (sql: string, _p?: unknown[]) => {
    const r = answer(sql);
    if (r instanceof Error) throw r;
    return r;
  });
  const m = { query };
  const db = { query, transaction: async <R>(fn: (x: unknown) => Promise<R>) => fn(m) };
  const orders = {
    lockForFulfilment: jest.fn(async () => { calls.push('lock order'); return { itemKind: 'game_account', buyerId: 'B', sellerId: 'S', ...(o.facts ?? {}) }; }),
    getOrderForParty: jest.fn(async () => ({ buyerId: 'B', sellerId: 'S', listing: { title: 'FF account' } })),
  };
  const escrow = { recordDeliveryEvent: jest.fn(async () => undefined) };
  const disputes = { open: jest.fn(o.dispute ?? (async () => 'D')) };
  const notifier = { notify: jest.fn(async () => { if (o.notifyFails) throw new Error('down'); }) };
  const params = { current: async () => ({ get: () => '24 hours', ms: () => 7 * 86_400_000 }) };
  const svc = new TakeoverService(db as never, orders as never, escrow as never, disputes as never, notifier as never, params as never);
  return { svc, query, m, orders, escrow, disputes, notifier, calls };
}
const failure = (p: Promise<unknown>) => p.then(() => 'ok', (e: Problem) => (e.extra?.errors as { reason: string }[] | undefined)?.[0]?.reason ?? e.problem);
const point = async () => {
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  return Buffer.from(await webcrypto.subtle.exportKey('raw', pair.publicKey)).toString('base64url');
};

describe('TakeoverService', () => {
  it('FR-GAM-13 FR-GAM-15 FR-GAM-16 each step is confirmed once; the fifth completes the takeover with Unit 2\'s delivery event, and both parties are told', async () => {
    const step = setup((q) => (q.includes('confirm_step') ? [{ done: false }] : [{ taken_over_at: null }]));
    expect(await step.svc.confirmStep('B', 'O', 'password', 'sess')).toEqual({ step: 'password', takenOverAt: null });
    expect(step.query.mock.calls[0][1]).toEqual(['O', 'B', 'password', 'sess']);
    expect(step.escrow.recordDeliveryEvent).not.toHaveBeenCalled();
    const last = setup((q) => (q.includes('confirm_step') ? [{ done: true }] : [{ taken_over_at: T }]), { notifyFails: true });
    expect(await last.svc.confirmStep('B', 'O', 'two_step', 'sess')).toEqual({ step: 'two_step', takenOverAt: T.toISOString() });
    expect(last.escrow.recordDeliveryEvent).toHaveBeenCalledWith('O', 'game_takeover', T, last.m);
    expect(last.notifier.notify.mock.calls.map((c) => [(c as unknown[])[0], (c as unknown[])[1], (c as unknown[])[2]])).toEqual([
      ['B', 'game.takeover_completed', { listing_title: 'FF account', days: 7 }], ['S', 'game.takeover_completed', { listing_title: 'FF account', days: 7 }],
    ]); // a notice that fails is logged, not refused
    expect(await failure(setup(() => dbError('the takeover window has ended')).svc.confirmStep('B', 'O', 'password', 's'))).toBe('window-ended');
    expect(await failure(setup(() => dbError('takeover is not in progress (disputed)')).svc.confirmStep('B', 'O', 'password', 's'))).toBe('takeover-not-in-progress');
    expect(await failure(setup(undefined, { facts: { buyerId: 'X' } }).svc.confirmStep('S', 'O', 'password', 's'))).toBe('forbidden');
    expect(await failure(setup(undefined, { facts: { buyerId: 'X', sellerId: 'Y' } }).svc.confirmStep('B', 'O', 'password', 's'))).toBe('not-found');
    expect(await failure(setup(undefined, { facts: { itemKind: 'physical' } }).svc.confirmStep('B', 'O', 'password', 's'))).toBe('not-found');
  });

  it('FR-GAM-14 the report disputes the handover and opens the dispute in the same transaction; it is refused after the recovery e-mail step or the window', async () => {
    const s = setup();
    expect(await s.svc.reportInvalid('B', 'O')).toEqual({ disputeId: 'D' });
    expect(s.query.mock.calls[0]).toEqual(['SELECT game_accounts.report_invalid($1, $2)', ['O', 'B']]);
    expect(s.disputes.open).toHaveBeenCalledWith({ orderId: 'O', type: 'credentials_invalid', description: 'The login details I received do not work.', by: 'buyer' }, s.m);
    await setup().svc.reportInvalid('B', 'O', '  The game says the password is wrong.  ').then(() => undefined);
    const off = setup(undefined, { dispute: async () => { throw new Problem('feature-off'); } }); // Unit 7 before U7-10
    expect(await failure(off.svc.reportInvalid('B', 'O'))).toBe('feature-off');
    expect(await failure(setup(() => dbError('the recovery e-mail was confirmed as changed; credentials_invalid is no longer accepted')).svc.reportInvalid('B', 'O'))).toBe('recovery-email-confirmed');
    expect(await failure(setup(() => dbError('a credentials_invalid report is accepted only during the takeover window')).svc.reportInvalid('B', 'O'))).toBe('window-ended');
    await expect(setup(() => dbError('other')).svc.reportInvalid('B', 'O')).rejects.toBeInstanceOf(QueryFailedError);
  });

  it('FR-GAM-12 one re-key with a new P-256 key: the seller must seal again within DV-37 and is told', async () => {
    const key = await point();
    const due = new Date(Date.now() + 24 * 3_600_000);
    const s = setup((q) => (q.includes('request_rekey') ? [{ version: 2 }] : [{ rekey_due_at: due }]));
    expect(await s.svc.requestRekey('B', 'O', 'sess', key)).toEqual({ keyVersion: 2, redeliveryDueAt: due.toISOString() });
    expect(s.query.mock.calls[0][1]).toEqual(['O', 'B', Buffer.from(key, 'base64url'), 'sess', '24 hours']);
    expect(s.notifier.notify).toHaveBeenCalledWith('S', 'game.rekey_requested', { listing_title: 'FF account', hours: 24 }, 'game:O:rekey');
    expect(await failure(setup().svc.requestRekey('B', 'O', 'sess', 'AAAA'))).toBe('not-a-p256-point');
    expect(await failure(setup().svc.requestRekey('B', 'O', 'sess', 'not base64!'))).toBe('not-a-p256-point');
    expect(await failure(setup(() => dbError('the one re-key has been used')).svc.requestRekey('B', 'O', 'sess', key))).toBe('rekey-used');
    expect(await failure(setup(() => dbError('the buyer already controls the recovery e-mail; no re-key is needed')).svc.requestRekey('B', 'O', 'sess', key))).toBe('recovery-email-confirmed');
  });

  it('FR-DSP-10 FR-GAM-14 Unit 7\'s ports: a withdrawn dispute resumes the takeover; whether a report is still allowed', async () => {
    const s = setup();
    await s.svc.disputeWithdrawn('O', s.m as never);
    expect(s.query.mock.calls[0]).toEqual(['SELECT game_accounts.dispute_withdrawn($1)', ['O']]);
    const notDisputed = setup(() => dbError('handover is not disputed'));
    expect(await failure(notDisputed.svc.disputeWithdrawn('O', notDisputed.m as never))).toBe('not-disputed');
    expect(await setup(() => [{ allowed: true }]).svc.credentialsInvalidAllowed('O')).toBe(true);
    expect(await setup(() => [{ allowed: false }]).svc.credentialsInvalidAllowed('O')).toBe(false);
    expect(await setup(() => []).svc.credentialsInvalidAllowed('O')).toBe(false);
  });
});
