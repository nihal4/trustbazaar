import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import type { Clock } from '../../../kernel/clock';
import { ConfigPort, parameterValues } from '../../../kernel/config-port';
import type { EventBus, OutboxEvent } from '../../../kernel/events/event-bus';
import { Problem } from '../../../kernel/http/problems';
import type { AuditServicePort, IdentityCryptoPort, IdentityQuery } from '../../identity/ports';
import type { PayoutProvider } from '../adapters/payout-provider';
import { SimulatedPayoutProvider } from '../adapters/payout-provider';
import { JournalEntry, JournalLine, OrdersOutboxEvent, Payout, PayoutAccount, ReconciliationIssue } from '../db/entities';
import { MAX_PAYOUT_ATTEMPTS, PAYOUT_RETRY_DELAYS_MS, PayoutService, walletE164 } from './payout.service';

// Unit tests of PayoutService over an in-memory stand-in for TypeORM; against PostgreSQL, with the schema's
// constraints, the KYC name check and the fraud-hold event, in test/api/payouts.spec.ts.
type Row = Record<string, unknown>;
const matches = (row: Row, where: Row) => Object.entries(where).every(([k, v]) => row[k] === v);
const any = (row: Row, where: Row | Row[]) => (Array.isArray(where) ? where : [where]).some((w) => matches(row, w));
class Repo {
  rows: Row[] = [];
  constructor(private readonly defaults: () => Row = () => ({})) {}
  async findOne(o: { where: Row | Row[] }) {
    return [...this.rows].reverse().find((r) => any(r, o.where)) ?? null;
  }
  async find(o: { where: Row }) {
    return this.rows.filter((r) => any(r, o.where));
  }
  async findOneByOrFail(where: Row) {
    const r = this.rows.find((x) => matches(x, where));
    if (!r) throw new Error('EntityNotFound');
    return r;
  }
  async insert(obj: Row) {
    const row = { id: randomUUID(), ...this.defaults(), ...obj };
    this.rows.push(row);
    return { identifiers: [{ id: row.id }] };
  }
  async update(where: Row, patch: Row) {
    for (const r of this.rows.filter((x) => matches(x, where))) Object.assign(r, patch);
  }
}

const NOW = new Date('2026-11-01T12:00:00Z');
const DAY = 86_400_000;
const PHONE = '+8801712345678';

function setup(o: { provider?: PayoutProvider; due?: () => Row[] } = {}) {
  const repos = new Map<unknown, Repo>([
    [PayoutAccount, new Repo(() => ({ createdAt: NOW, walletE164: null, bankName: null, branchName: null, accountName: null, accountLast4: null, effectiveAt: null }))],
    [Payout, new Repo()],
    [JournalEntry, new Repo()],
    [JournalLine, new Repo()],
    [OrdersOutboxEvent, new Repo()],
    [ReconciliationIssue, new Repo()],
  ]);
  const query = jest.fn(async (sql: string, _params?: unknown[]): Promise<unknown> => (sql.includes('SELECT id FROM payments.payouts') ? (o.due?.() ?? []) : sql.includes('RETURNING id') ? [[{ id: 'P1' }], 1] : []));
  const manager = { getRepository: (e: unknown) => repos.get(e)!, query };
  const db = { ...manager, manager, transaction: (cb: (m: typeof manager) => unknown) => cb(manager) };
  const bus = { on: jest.fn() };
  const identity = { getVerifiedPhone: jest.fn(async () => PHONE), getKycLegalName: jest.fn(async () => 'Rahim Uddin') };
  const crypto = { encrypt: jest.fn(async (p: string) => new TextEncoder().encode(`sealed:${p}`)) };
  const audit = { record: jest.fn(async () => undefined) };
  const values = parameterValues({ 'CP-29': '24 hours' });
  const params = { current: async () => values } as unknown as ConfigPort;
  const clock: Clock = { now: () => NOW };
  const svc = new PayoutService(
    db as unknown as DataSource, bus as unknown as EventBus, o.provider ?? new SimulatedPayoutProvider(), identity as unknown as IdentityQuery,
    crypto as unknown as IdentityCryptoPort, audit as unknown as AuditServicePort, params, clock,
  );
  return { svc, repo: (e: unknown) => repos.get(e)!, query, bus, audit, identity };
}
const reason = async (p: Promise<unknown>) =>
  p.then(() => 'none', (e: unknown) => (e instanceof Problem ? ((e.extra.errors as { reason: string }[] | undefined)?.[0]?.reason ?? e.problem) : String(e)));

describe('PayoutService', () => {
  it('FR-PAY-17 wallet numbers: local or E.164 forms, Bangladeshi mobiles only', () => {
    expect(['01712345678', '+8801712345678', '8801712345678', '017-1234 5678'].map(walletE164)).toEqual([PHONE, PHONE, PHONE, PHONE]);
    expect(['01212345678', '1712345678', 'abc'].map(walletE164)).toEqual([null, null, null]);
  });

  it('FR-PAY-17 FR-PAY-18 a wallet on the verified number cools off; a replacement takes over and is alerted', async () => {
    const s = setup();
    expect(await reason(s.svc.setAccount('S', { kind: 'bkash_wallet', walletNumber: '0171' }))).toBe('not-bangladeshi-mobile');
    expect(await reason(s.svc.setAccount('S', { kind: 'bkash_wallet', walletNumber: '01812345678' }))).toBe('not-verified-number');
    const first = await s.svc.setAccount('S', { kind: 'bkash_wallet', walletNumber: '01712345678' });
    expect(first).toMatchObject({ status: 'cooling_off', walletMasked: '***678', effectiveAt: new Date(NOW.getTime() + DAY).toISOString() });
    const second = await s.svc.setAccount('S', { kind: 'nagad_wallet', walletNumber: PHONE }, { ip: '1.2.3.4' });
    expect(s.repo(PayoutAccount).rows.find((r) => r.id === first.id)).toMatchObject({ status: 'replaced', replacedAt: NOW });
    expect(await s.svc.getAccount('S')).toMatchObject({ id: second.id, kind: 'nagad_wallet' });
    expect(await s.svc.getAccount('X')).toBeNull();
    expect(s.repo(OrdersOutboxEvent).rows.map((r) => (r.payload as Row).replaced)).toEqual([false, true]);
    expect(s.query.mock.calls.some(([sql]) => String(sql).includes("status = 'waiting_cooling_off', payout_account_id = $2"))).toBe(true);
  });

  it('FR-PAY-17 a bank account is sealed, waits for review, and payouts wait for an account meanwhile', async () => {
    const s = setup();
    const a = await s.svc.setAccount('S', { kind: 'bank', bankName: ' DBBL ', routingNumber: '090271234', accountName: 'Rahim Uddin', accountNumber: '1234567890123' });
    expect(a).toMatchObject({ status: 'pending_review', bankName: 'DBBL', branchName: null, accountLast4: '0123', effectiveAt: null });
    const row = s.repo(PayoutAccount).rows[0];
    expect(Buffer.from(row.accountNumberEnc as Buffer).toString()).toBe('sealed:1234567890123');
    expect(s.query.mock.calls.some(([sql]) => String(sql).includes("SET status = 'waiting_account', payout_account_id = NULL"))).toBe(true);
    expect(await s.svc.pendingBankAccounts('OP')).toEqual([expect.objectContaining({ id: a.id, kycLegalName: 'Rahim Uddin', routingNumber: '090271234' })]);
    expect(await reason(s.svc.decideBankAccount('OP', randomUUID(), 'approve', 'r'))).toBe('not-found');
    const approved = await s.svc.decideBankAccount('OP', a.id, 'approve', 'Name matches');
    expect(approved).toMatchObject({ status: 'cooling_off', effectiveAt: new Date(NOW.getTime() + DAY).toISOString() });
    expect(await reason(s.svc.decideBankAccount('OP', a.id, 'reject', 'again'))).toBe('payout-state');
    const b = await s.svc.setAccount('T', { kind: 'bank', bankName: 'BRAC', branchName: 'Gulshan', routingNumber: '060261234', accountName: 'Other', accountNumber: '999999' });
    expect(await s.svc.decideBankAccount('OP', b.id, 'reject', 'Name differs')).toMatchObject({ status: 'rejected' });
    expect(s.audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'payments.payout_account.rejected', reason: 'Name differs' }), expect.anything());
  });

  it('FR-PAY-19 the worker sends with the payout\'s idempotency key and posts "payout sent"', async () => {
    const send = jest.fn(async () => ({ status: 'sent' as const, ref: 'r1' }));
    let due = true;
    const s = setup({ provider: { send }, due: () => (due ? [{ id: 'P1' }] : []) });
    s.repo(PayoutAccount).rows.push({ id: 'A1', kind: 'bkash_wallet', walletE164: PHONE, status: 'active' });
    s.repo(Payout).rows.push({ id: 'P1', orderId: 'O1', sellerId: 'S', payoutAccountId: 'A1', amount: '950000', status: 'pending', simulated: true, idempotencyKey: 'k1', attemptsMade: 0 });
    send.mockImplementationOnce(async () => { due = false; return { status: 'sent', ref: 'r1' }; });
    expect(await s.svc.processDue()).toEqual(['sent']);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ payoutId: 'P1', amount: 950000n, idempotencyKey: 'k1', destination: expect.objectContaining({ walletE164: PHONE }) }));
    expect(s.repo(Payout).rows[0]).toMatchObject({ status: 'sent', sentAt: NOW, providerRef: 'r1', attemptsMade: 1 });
    expect(s.repo(JournalLine).rows.map((l) => [l.accountCode, l.partyId, l.amount])).toEqual([['seller_payable', 'S', '950000'], ['payout_clearing', null, '-950000']]);
    expect(s.repo(OrdersOutboxEvent).rows.map((r) => r.eventType)).toEqual(['payments.payout.sent']);
  });

  it('FR-PAY-19 DV-14 failures retry on the schedule, then raise payout_failed', async () => {
    let calls = 0;
    const s = setup({ provider: { send: async () => { calls++; if (calls === 2) throw new Error('timeout'); return { status: 'failed' }; } }, due: () => (calls < 2 ? [{ id: 'P1' }] : []) });
    s.repo(PayoutAccount).rows.push({ id: 'A1', kind: 'bank', status: 'active' });
    const p = { id: 'P1', orderId: 'O1', sellerId: 'S', payoutAccountId: 'A1', amount: '100', status: 'pending', simulated: true, idempotencyKey: 'k', attemptsMade: 0 };
    s.repo(Payout).rows.push(p);
    expect(await s.svc.processDue()).toEqual(['retry', 'retry']); // a thrown error counts as a failure
    expect(p).toMatchObject({ status: 'failed', attemptsMade: 2, nextAttemptAt: new Date(NOW.getTime() + PAYOUT_RETRY_DELAYS_MS[1]) });
    Object.assign(p, { attemptsMade: MAX_PAYOUT_ATTEMPTS - 1 });
    calls = 0;
    const once = setup({ provider: { send: async () => ({ status: 'failed' }) }, due: () => (p.status === 'failed' && p.attemptsMade < MAX_PAYOUT_ATTEMPTS ? [{ id: 'P1' }] : []) });
    once.repo(PayoutAccount).rows.push({ id: 'A1', kind: 'bank', status: 'active' });
    once.repo(Payout).rows.push(p);
    expect(await once.svc.processDue()).toEqual(['failed']);
    expect(once.repo(ReconciliationIssue).rows).toEqual([expect.objectContaining({ kind: 'payout_failed', payoutId: 'P1' })]);
    expect(once.repo(OrdersOutboxEvent).rows.map((r) => r.eventType)).toEqual(['payments.payout.failed']);
  });

  it('FR-TNS-05 holds come from fraud suspensions only, and an operator lifts them from the current account', async () => {
    const s = setup();
    s.svc.onModuleInit();
    expect(s.bus.on).toHaveBeenCalledWith('identity.account.suspended', 'orders.payout-hold', expect.any(Function));
    const ev = (payload: Row) => ({ payload }) as unknown as OutboxEvent;
    await s.svc.onSuspended(ev({ userId: 'S', fraud: false }));
    await s.svc.onSuspended(ev({ fraud: true }));
    expect(s.query).not.toHaveBeenCalled();
    await s.svc.onSuspended(ev({ userId: 'S', fraud: true }));
    expect(String(s.query.mock.calls[0][0])).toContain("SET status = 'held', hold_reason = 'fraud suspension'");
    expect(s.audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'payments.payout.held', after: { payouts: ['P1'] } }), expect.anything());
    const held = { id: 'H1', orderId: 'O1', sellerId: 'S', amount: '5', status: 'held', holdReason: 'fraud suspension', simulated: true, createdAt: NOW, sentAt: null };
    s.repo(Payout).rows.push(held);
    expect(await s.svc.releaseHold('OP', 'H1', 'Cleared')).toMatchObject({ status: 'waiting_account' });
    expect(await reason(s.svc.releaseHold('OP', 'H1', 'again'))).toBe('payout-state');
    expect(await reason(s.svc.releaseHold('OP', 'nope', 'x'))).toBe('not-found');
    s.repo(PayoutAccount).rows.push({ id: 'A1', userId: 'S', status: 'cooling_off', effectiveAt: new Date(NOW.getTime() + 1) });
    Object.assign(held, { status: 'held' });
    expect(await s.svc.releaseHold('OP', 'H1', 'Cleared')).toMatchObject({ status: 'waiting_cooling_off' });
    s.repo(PayoutAccount).rows[0].effectiveAt = NOW;
    Object.assign(held, { status: 'held' });
    expect(await s.svc.releaseHold('OP', 'H1', 'Cleared')).toMatchObject({ status: 'pending' });
  });

  it('IF-UI-08 payout history in pages of 50 with a cursor', async () => {
    const rows = Array.from({ length: 51 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, order_id: 'O', amount: '1', status: 'sent', simulated: true, created_at: NOW, sent_at: NOW, cursor_at: '2026-11-01T10:00:00.123456Z' }));
    const s = setup();
    s.query.mockImplementation(async () => rows as never);
    const page = await s.svc.listPayouts('S');
    expect(page.items).toHaveLength(50);
    expect(page.items[0]).toEqual({ id: rows[0].id, orderId: 'O', amount: '1', status: 'sent', simulated: true, createdAt: NOW.toISOString(), sentAt: NOW.toISOString() });
    await s.svc.listPayouts('S', page.nextCursor!);
    expect(s.query.mock.calls[1][1]).toEqual(['S', '2026-11-01T10:00:00.123456Z', rows[49].id]);
    expect(await reason(s.svc.listPayouts('S', 'eA'))).toBe('format');
    s.query.mockImplementation(async () => [] as never);
    expect((await s.svc.listPayouts('S')).nextCursor).toBeNull();
  });

  it('NFR-CMP-05 the simulated adapter answers the same reference for the same idempotency key', async () => {
    const sim = new SimulatedPayoutProvider();
    const a = await sim.send({ idempotencyKey: 'k' });
    expect(await sim.send({ idempotencyKey: 'k' })).toEqual(a);
    expect((await sim.send({ idempotencyKey: 'j' })).ref).not.toBe(a.ref);
  });
});
