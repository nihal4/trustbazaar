import { DataSource } from 'typeorm';
import type { Clock } from '../../../kernel/clock';
import { ConfigPort, parameterValues } from '../../../kernel/config-port';
import type { JobRunner } from '../../../kernel/jobs/job-runner';
import type { EscrowService } from '../services/escrow.service';
import type { OrderService } from '../services/order.service';
import type { PaymentService, ProviderRegistry } from '../services/payment.service';
import type { PayoutService } from '../services/payout.service';
import type { RefundService } from '../services/refund.service';
import { DV_15_MS, OrdersJobs } from './orders.jobs';

// Unit tests of the job wiring over stand-ins; the jobs against PostgreSQL and the mock providers are in
// test/api/orders-jobs.spec.ts.
const NOW = new Date('2026-11-01T12:00:00Z');

function setup(o: { rows?: (sql: string, p: unknown[]) => unknown[]; params?: 'broken'; providers?: ProviderRegistry; reconcile?: jest.Mock } = {}) {
  const query = jest.fn(async (sql: string, p: unknown[] = []) => o.rows?.(sql, p) ?? []);
  const db = { query, transaction: async (cb: (m: { query: typeof query }) => unknown) => cb({ query }) };
  const registered: { name: string; intervalMs: number; run: () => Promise<number | void> }[] = [];
  const runner = { register: jest.fn((j) => registered.push(j)) };
  const orders = { expireUnpaid: jest.fn(async () => true) };
  const payments = { reconcile: o.reconcile ?? jest.fn(async () => 'no-change') };
  const escrow = { refundMissedDeadline: jest.fn(async () => true), autoRelease: jest.fn(async () => false) };
  const refunds = { processDue: jest.fn(async () => ['succeeded']), confirmSent: jest.fn(async () => 2) };
  const payouts = { processDue: jest.fn(async () => ['sent', 'retry']) };
  const values = parameterValues({ 'CP-17': '7 days', 'CP-18': '3 days', 'CP-46': '20 minutes' });
  const params = {
    current: async () => { if (o.params === 'broken') throw new Error('no table'); return values; },
    atVersion: async () => values,
  } as unknown as ConfigPort;
  const clock: Clock = { now: () => NOW };
  const jobs = new OrdersJobs(
    runner as unknown as JobRunner, db as unknown as DataSource, orders as unknown as OrderService, payments as unknown as PaymentService,
    escrow as unknown as EscrowService, refunds as unknown as RefundService, payouts as unknown as PayoutService, o.providers ?? { bkash: {} as never }, params, clock,
  );
  return { jobs, registered, query, orders, payments, escrow, refunds, payouts };
}

describe('OrdersJobs', () => {
  it('NFR-REL-03 registers each job of section 5.13 at its interval; reconciliation every CP-46', async () => {
    const s = setup();
    await s.jobs.onModuleInit();
    expect(Object.fromEntries(s.registered.map((j) => [j.name, j.intervalMs]))).toEqual({
      'orders.payment.expire': 60_000, 'orders.fulfilment.deadline': 60_000, 'orders.escrow.auto_release': 60_000, 'orders.delivery.stalled': 3_600_000,
      'orders.cancellation.lapse': 3_600_000, 'orders.reconciliation': 20 * 60_000, 'orders.refunds.send': 30_000, 'orders.payouts.send': 60_000,
    });
    expect(await s.registered.find((j) => j.name === 'orders.refunds.send')!.run()).toBe(1);
    expect(await s.registered.find((j) => j.name === 'orders.payouts.send')!.run()).toBe(2);
    const fallback = setup({ params: 'broken' });
    await fallback.jobs.onModuleInit();
    expect(fallback.registered.find((j) => j.name === 'orders.reconciliation')!.intervalMs).toBe(15 * 60_000);
  });

  it('FR-PAY-15 an order is cancelled only after every in-flight attempt was answered', async () => {
    const reconcile = jest.fn(async (id: string) => { if (id === 'A2') throw new Error('timeout'); return 'pending'; });
    const s = setup({
      reconcile,
      providers: { bkash: {} as never },
      rows: (sql, p) => sql.includes('FROM orders.orders WHERE status') ? [{ id: 'O1' }, { id: 'O2' }, { id: 'O3' }]
        : sql.includes('WHERE order_id = $1 AND status IN') ? (p[0] === 'O2' ? [{ id: 'A2' }] : p[0] === 'O3' ? [{ id: 'A3' }] : [{ id: 'A1' }])
        : sql.includes('SELECT provider') ? [{ provider: p[0] === 'A3' ? 'nagad' : 'bkash' }] : [],
    });
    expect(await s.jobs.expirePayments()).toBe(1);
    expect(s.orders.expireUnpaid.mock.calls).toEqual([['O1']]); // O2: query failed; O3: no nagad adapter in this mode
    expect(reconcile.mock.calls.map((c) => c[0])).toEqual(['A1', 'A2']);
  });

  it('FR-PAY-08 FR-PAY-07 deadline refunds and auto-release go through the escrow service, counted when done', async () => {
    const s = setup({ rows: () => [{ id: 'O1' }, { id: 'O2' }] });
    expect(await s.jobs.missedDeadlines()).toBe(2);
    expect(await s.jobs.autoRelease()).toBe(0);
    expect(s.escrow.autoRelease.mock.calls).toEqual([['O1'], ['O2']]);
  });

  it('FR-DLV-11 a stalled courier delivery is raised after CP-17 + CP-18 from pickup, once', async () => {
    const day = 86_400_000;
    let exists = false;
    const s = setup({
      rows: (sql) => sql.includes('FROM orders.orders o JOIN') ? [{ id: 'S1', fulfilment_done_at: new Date(NOW.getTime() - 11 * day), params_version: 1 }, { id: 'S2', fulfilment_done_at: new Date(NOW.getTime() - 9 * day), params_version: 1 }]
        : sql.startsWith('SELECT 1 FROM payments.reconciliation_issues') ? (exists ? [{}] : []) : [],
    });
    expect(await s.jobs.stalledDeliveries()).toBe(1);
    const insert = s.query.mock.calls.find(([sql]) => String(sql).startsWith('INSERT INTO payments.reconciliation_issues'))!;
    expect(insert[1]).toEqual(['S1', JSON.stringify({ pickedUpAt: new Date(NOW.getTime() - 11 * day).toISOString(), stalledAt: new Date(NOW.getTime() - day).toISOString() })]);
    exists = true; // another instance raised it meanwhile
    expect(await s.jobs.stalledDeliveries()).toBe(0);
  });

  it('DV-16 cancellation requests lapse in one update; both result shapes are counted', async () => {
    expect(await setup({ rows: () => [[{ id: 'C1' }, { id: 'C2' }], 2] }).jobs.lapseCancellations()).toBe(2);
    expect(await setup({ rows: () => [{ id: 'C1' }] }).jobs.lapseCancellations()).toBe(1);
  });

  it('FR-PAY-15 reconciliation: stale attempts after DV-15, sent refunds, and one issue per paid attempt without a transaction id', async () => {
    const s = setup({
      rows: (sql) => sql.includes("status IN ('created', 'redirected') AND created_at") ? [{ id: 'A1' }]
        : sql.includes('SELECT provider') ? [{ provider: 'bkash' }]
        : sql.includes('provider_txn_id IS NULL') ? [{ id: 'A9', order_id: 'O9' }] : [],
    });
    expect(await s.jobs.reconcile()).toBe(1 + 2 + 1);
    expect(s.query.mock.calls[0][1]).toEqual([new Date(NOW.getTime() - DV_15_MS)]);
    expect(s.refunds.confirmSent).toHaveBeenCalled();
    expect(s.query.mock.calls.find(([sql]) => String(sql).includes("VALUES ('provider_disagrees'"))![1]).toEqual(['O9', 'A9', expect.stringContaining('provider transaction id')]);
  });
});
