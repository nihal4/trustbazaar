import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import type { Clock } from '../../../kernel/clock';
import type { AuditServicePort } from '../../identity/ports';
import { PaymentProvider, ProviderUnavailable } from '../adapters/payment-provider';
import { JournalEntry, JournalLine, Order, OrdersOutboxEvent, PaymentAttempt, ReconciliationIssue, Refund } from '../db/entities';
import type { ProviderRegistry } from './payment.service';
import { MAX_REFUND_ATTEMPTS, RefundService, RETRY_DELAYS_MS } from './refund.service';

// Unit tests of the refund worker over an in-memory stand-in for TypeORM; against PostgreSQL, with the
// mock provider and SKIP LOCKED, in test/api/release-refunds.spec.ts.
type Row = Record<string, unknown>;
const matches = (row: Row, where: Row) => Object.entries(where).every(([k, v]) => row[k] === v);
class Repo {
  rows: Row[] = [];
  async findOneBy(where: Row) {
    return this.rows.find((r) => matches(r, where)) ?? null;
  }
  async findOneByOrFail(where: Row) {
    const r = await this.findOneBy(where);
    if (!r) throw new Error('EntityNotFound');
    return r;
  }
  async insert(obj: Row) {
    const row = { id: randomUUID(), ...obj };
    this.rows.push(row);
    return { identifiers: [{ id: row.id }] };
  }
  async update(where: Row, patch: Row) {
    for (const r of this.rows.filter((x) => matches(x, where))) Object.assign(r, patch);
  }
}

const NOW = new Date('2026-11-01T12:00:00Z');

function setup(refund: jest.Mock | null, extra: Record<string, unknown> = {}) {
  const repos = new Map<unknown, Repo>([JournalEntry, JournalLine, Order, OrdersOutboxEvent, PaymentAttempt, ReconciliationIssue, Refund].map((e) => [e, new Repo()]));
  const due = () => repos.get(Refund)!.rows.filter((r) => ['pending', 'failed'].includes(r.status as string) && (r.nextAttemptAt as Date) <= NOW).slice(0, 1).map((r) => ({ id: r.id }));
  const sent = (id?: string) => repos.get(Refund)!.rows.filter((r) => r.status === 'sent' && (id === undefined || r.id === id)).map((r) => ({ id: r.id }));
  const query = jest.fn(async (sql: string, p: unknown[] = []) => (sql.includes("status = 'sent'") ? sent(sql.includes('id = $1') ? (p[0] as string) : undefined) : sql.includes('FROM payments.refunds') ? due() : []));
  const manager = { getRepository: (e: unknown) => repos.get(e)!, query };
  const db = { query, transaction: (cb: (m: typeof manager) => unknown) => cb(manager) };
  const providers = (refund ? { bkash: { refund, ...extra } } : {}) as unknown as ProviderRegistry;
  const audit = { record: jest.fn(async () => undefined) };
  const clock: Clock = { now: () => NOW };
  const svc = new RefundService(db as unknown as DataSource, providers, audit as unknown as AuditServicePort, clock);
  const attemptId = randomUUID();
  repos.get(PaymentAttempt)!.rows.push({ id: attemptId, provider: 'bkash', orderId: 'O1', payerId: 'P', amount: '1000000', idempotencyKey: 'k', providerPaymentId: 'pp', providerTxnId: 'txn', expiresAt: NOW });
  repos.get(Order)!.rows.push({ id: 'O1', buyerId: 'B' });
  const add = (x: Row = {}) => {
    const r = { id: randomUUID(), orderId: 'O1', attemptId, amount: '400000', reason: 'cancellation', idempotencyKey: `refund-${randomUUID()}`, status: 'pending', attemptsMade: 0, nextAttemptAt: NOW, ...x };
    repos.get(Refund)!.rows.push(r);
    return r;
  };
  return { svc, add, repo: (e: unknown) => repos.get(e)!, audit };
}
const events = (s: ReturnType<typeof setup>) => s.repo(OrdersOutboxEvent).rows.map((r) => r.eventType);

describe('RefundService', () => {
  it('FR-PAY-12 a refund that succeeds is posted once, with its idempotency key, and the buyer is told', async () => {
    const refund = jest.fn(async () => ({ status: 'succeeded', providerRefundId: 'rf_1' }));
    const s = setup(refund);
    const r = s.add();
    s.add({ nextAttemptAt: new Date(NOW.getTime() + 1) }); // not due yet
    expect(await s.svc.processDue()).toEqual(['succeeded']);
    expect(refund).toHaveBeenCalledWith(expect.objectContaining({ providerTxnId: 'txn', amount: 400000n, idempotencyKey: r.idempotencyKey }));
    expect(r).toMatchObject({ status: 'succeeded', providerRefundId: 'rf_1', attemptsMade: 1, completedAt: NOW });
    expect(s.repo(JournalEntry).rows).toEqual([expect.objectContaining({ kind: 'refund_paid', sourceId: r.id })]);
    expect(s.repo(JournalLine).rows.map((l) => [l.accountCode, l.partyId, l.amount])).toEqual([['buyer_refund_payable', 'B', '400000'], ['provider_clearing', null, '-400000']]);
    expect(events(s)).toEqual(['payments.refund.succeeded']);
    expect(await s.svc.processDue()).toEqual([]);
  });

  it('FR-PAY-16 a refund the provider takes for later is marked sent and left to reconciliation', async () => {
    const s = setup(jest.fn(async () => ({ status: 'pending', providerRefundId: 'rf_2' })));
    const r = s.add();
    expect(await s.svc.processDue()).toEqual(['sent']);
    expect(r).toMatchObject({ status: 'sent', providerRefundId: 'rf_2', attemptsMade: 1 });
    expect(s.repo(JournalEntry).rows).toEqual([]);
  });

  it('FR-PAY-12 DV-13 failures retry on the schedule, then an operator takes over', async () => {
    const s = setup(jest.fn(async () => { throw new ProviderUnavailable('timeout'); }));
    const r = s.add();
    expect(await s.svc.processDue()).toEqual(['retry']);
    expect(r).toMatchObject({ status: 'failed', attemptsMade: 1, nextAttemptAt: new Date(NOW.getTime() + RETRY_DELAYS_MS[0]) });
    Object.assign(r, { attemptsMade: MAX_REFUND_ATTEMPTS - 1, nextAttemptAt: NOW });
    expect(await s.svc.processDue()).toEqual(['manual_required']);
    expect(r).toMatchObject({ status: 'manual_required', attemptsMade: MAX_REFUND_ATTEMPTS });
    expect(s.repo(ReconciliationIssue).rows).toEqual([expect.objectContaining({ kind: 'refund_failed', refundId: r.id })]);
    expect(events(s)).toEqual(['payments.refund.manual_required']);
  });

  it('FR-PAY-12 a provider that cannot refund, or no adapter in this mode, goes straight to an operator', async () => {
    const s = setup(jest.fn(async () => ({ status: 'unsupported' })));
    s.add();
    expect(await s.svc.processDue()).toEqual(['manual_required']);
    const none = setup(null);
    none.add();
    expect(await none.svc.processDue()).toEqual(['manual_required']);
    expect([s, none].map((x) => x.repo(ReconciliationIssue).rows[0].kind)).toEqual(['manual_refund_required', 'manual_refund_required']);
  });

  it('FR-PAY-12 an unexpected error is not swallowed, so the transaction rolls back', async () => {
    const s = setup(jest.fn(async () => { throw new Error('bug'); }) as jest.Mock<ReturnType<PaymentProvider['refund']>>);
    s.add();
    await expect(s.svc.processDue()).rejects.toThrow('bug');
  });

  it('FR-PAY-15 reconciliation confirms refunds the provider took for later, or hands failures to an operator', async () => {
    const answers: Record<string, 'succeeded' | 'pending' | 'failed'> = { rf_ok: 'succeeded', rf_wait: 'pending', rf_bad: 'failed' };
    const queryRefund = jest.fn(async (id: string) => { if (id === 'rf_down') throw new ProviderUnavailable('timeout'); return answers[id]; });
    const s = setup(jest.fn(), { queryRefund });
    const ok = s.add({ status: 'sent', providerRefundId: 'rf_ok', attemptsMade: 1 });
    const wait = s.add({ status: 'sent', providerRefundId: 'rf_wait' });
    const bad = s.add({ status: 'sent', providerRefundId: 'rf_bad' });
    const down = s.add({ status: 'sent', providerRefundId: 'rf_down' });
    const noRef = s.add({ status: 'sent', providerRefundId: null });
    expect(await s.svc.confirmSent()).toBe(2);
    expect(ok).toMatchObject({ status: 'succeeded', completedAt: NOW, attemptsMade: 1 });
    expect(s.repo(JournalEntry).rows).toEqual([expect.objectContaining({ kind: 'refund_paid', sourceId: ok.id })]);
    expect([wait.status, down.status, noRef.status]).toEqual(['sent', 'sent', 'sent']);
    expect(bad.status).toBe('manual_required');
    expect(s.repo(ReconciliationIssue).rows).toEqual([expect.objectContaining({ kind: 'refund_failed', refundId: bad.id })]);
    const plain = setup(jest.fn()); // a provider without queryRefund (the mock): nothing to ask
    plain.add({ status: 'sent', providerRefundId: 'x' });
    expect(await plain.svc.confirmSent()).toBe(0);
    const broken = setup(jest.fn(), { queryRefund: async () => { throw new Error('bug'); } });
    broken.add({ status: 'sent', providerRefundId: 'x' });
    await expect(broken.svc.confirmSent()).rejects.toThrow('bug');
  });
});
