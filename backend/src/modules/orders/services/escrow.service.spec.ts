import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import type { Clock } from '../../../kernel/clock';
import { ConfigPort, parameterValues } from '../../../kernel/config-port';
import { Problem } from '../../../kernel/http/problems';
import type { AuditServicePort, IdentityQuery } from '../../identity/ports';
import { Escrow, EscrowHistory, JournalEntry, JournalLine, Order, OrdersOutboxEvent, PaymentAttempt, Payout, Refund, Settlement } from '../db/entities';
import { EscrowService } from './escrow.service';
import { split } from './split';

// Unit tests of EscrowService over an in-memory stand-in for TypeORM; against PostgreSQL, with its escrow
// trigger and ledger check, in test/api/escrow.spec.ts.
type Row = Record<string, unknown>;
const matches = (row: Row, where: Row) => Object.entries(where).every(([k, v]) => row[k] === v);
class Repo {
  rows: Row[] = [];
  async findOne(o: { where: Row }) {
    return this.rows.find((r) => matches(r, o.where)) ?? null;
  }
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
const DAY = 86_400_000;

function setup(o: { account?: { id: string; status: string; effective_at: Date }; suspended?: boolean } = {}) {
  const repos = new Map<unknown, Repo>([Order, Escrow, EscrowHistory, JournalEntry, JournalLine, OrdersOutboxEvent, PaymentAttempt, Payout, Refund, Settlement].map((e) => [e, new Repo()]));
  const manager = { getRepository: (e: unknown) => repos.get(e)!, query: jest.fn(async () => (o.account ? [o.account] : [])) };
  const db = { ...manager, manager, transaction: (cb: (m: typeof manager) => unknown) => cb(manager) };
  const identity = { getPrincipal: jest.fn(async () => ({ accountStatus: o.suspended ? 'suspended' : 'active' })) };
  const audit = { record: jest.fn(async () => undefined) };
  const values = parameterValues({ 'CP-18': '3 days', 'CP-19': '5 days', 'CP-24': '7 days' });
  const params = { atVersion: async () => values } as unknown as ConfigPort;
  const clock: Clock = { now: () => NOW };
  const svc = new EscrowService(db as unknown as DataSource, identity as unknown as IdentityQuery, audit as unknown as AuditServicePort, params, clock);
  const order = (x: Row = {}, ex: Row = {}) => {
    const id = randomUUID();
    const game = x.itemKind === 'game_account';
    const row = {
      id, status: 'paid', itemKind: 'physical', buyerId: 'B', sellerId: 'S', fulfilment: 'self_pickup', fulfilmentStep: 'meetup_handover', fulfilmentDoneAt: null,
      deliveryEventAt: null, itemPrice: '1000000', deliveryFee: '0', commissionBps: 500, deliveryMarginBps: 1000, paramsVersion: 1, ...x,
    };
    repos.get(Order)!.rows.push(row);
    const total = (BigInt(row.itemPrice as string) + BigInt(row.deliveryFee as string)).toString();
    const e = { orderId: id, state: 'held', releasePolicy: game ? 'game_protection' : 'standard', amountCollected: total, amountReleased: '0', amountRefunded: '0', disputeWindowEndsAt: null, autoReleaseAt: null, openDisputeId: null, ...ex };
    repos.get(Escrow)!.rows.push(e);
    repos.get(PaymentAttempt)!.rows.push({ id: randomUUID(), orderId: id, status: 'succeeded' });
    return { o: row, e };
  };
  const m = manager as never;
  return { svc, repo: (e: unknown) => repos.get(e)!, order, m, audit };
}
const reason = async (p: Promise<unknown>) =>
  p.then(() => 'none', (e: unknown) => (e instanceof Problem ? ((e.extra.errors as { reason: string }[] | undefined)?.[0]?.reason ?? e.problem) : String(e)));

describe('EscrowService', () => {
  it('FR-PAY-07 steps and delivery events: recorded once, in order, with the windows of the release policy', async () => {
    const s = setup();
    const { o, e } = s.order({ fulfilment: 'courier', fulfilmentStep: 'courier_pickup' });
    await s.svc.recordDeliveryEvent(o.id, 'courier_delivered', NOW, s.m); // before the pickup: ignored
    expect(o.deliveryEventAt).toBeNull();
    await s.svc.recordFulfilmentStep(o.id, 'courier_pickup', NOW, s.m);
    await s.svc.recordFulfilmentStep(o.id, 'courier_pickup', new Date(0), s.m); // twice: the first stands
    expect(o.fulfilmentDoneAt).toEqual(NOW);
    await s.svc.recordDeliveryEvent(o.id, 'courier_delivered', NOW, s.m);
    expect([e.disputeWindowEndsAt, e.autoReleaseAt]).toEqual([new Date(NOW.getTime() + 3 * DAY), new Date(NOW.getTime() + 5 * DAY)]);
    const g = s.order({ itemKind: 'game_account', fulfilment: 'game_account', fulfilmentStep: 'credentials_delivered', fulfilmentDoneAt: NOW });
    await s.svc.recordDeliveryEvent(g.o.id, 'game_takeover', NOW, s.m);
    expect([g.e.disputeWindowEndsAt, g.e.autoReleaseAt]).toEqual([new Date(NOW.getTime() + 7 * DAY), new Date(NOW.getTime() + 7 * DAY)]);
    const unpaid = s.order({ status: 'awaiting_payment' });
    await s.svc.recordDeliveryEvent(unpaid.o.id, 'handover_code', NOW, s.m);
    expect(unpaid.o.deliveryEventAt).toBeNull();
    await expect(s.svc.recordFulfilmentStep(randomUUID(), 'courier_pickup', NOW, s.m)).rejects.toBeInstanceOf(Problem);
  });

  it('FR-DSP-02, FR-DSP-10 and FR-DSP-11 freeze, the window, and withdrawal at the later release time', async () => {
    const s = setup();
    const { o, e } = s.order({}, { disputeWindowEndsAt: new Date(NOW.getTime() + DAY), autoReleaseAt: new Date(NOW.getTime() + 2 * 3_600_000) });
    expect(await s.svc.disputeAllowed(o.id, NOW)).toBe(true);
    expect(await s.svc.disputeAllowed(o.id, new Date(NOW.getTime() + DAY))).toBe(false); // strictly before
    expect(await s.svc.disputeAllowed(randomUUID(), NOW)).toBe(false);
    await s.svc.freezeForDispute(o.id, 'd1', s.m);
    expect(e).toMatchObject({ state: 'frozen_disputed', openDisputeId: 'd1' });
    expect(await reason(s.svc.freezeForDispute(o.id, 'd2', s.m))).toBe('dispute-not-allowed');
    expect(await reason(s.svc.withdrawDispute(o.id, 'd2', s.m))).toBe('not-the-open-dispute');
    await s.svc.withdrawDispute(o.id, 'd1', s.m);
    expect(e).toMatchObject({ state: 'held', openDisputeId: null, autoReleaseAt: new Date(NOW.getTime() + DAY) }); // now + 24 h is later
    const before = s.order();
    await s.svc.freezeForDispute(before.o.id, 'd3', s.m);
    await s.svc.withdrawDispute(before.o.id, 'd3', s.m);
    expect(before.e.autoReleaseAt).toBeNull(); // no delivery event yet: nothing to release automatically
    expect(await s.svc.getEscrow(o.id)).toMatchObject({ state: 'held', orderStatus: 'paid' });
    expect(await reason(s.svc.getEscrow(randomUUID()))).toBe('not-found');
  });

  it('FR-DSP-06 outcomes: release, full (fee kept after a pickup), partial, after return, and refusals', async () => {
    const s = setup();
    const r = s.order();
    await s.svc.freezeForDispute(r.o.id, 'd', s.m);
    await s.svc.applyDisputeOutcome(r.o.id, 'd', { kind: 'release' }, s.m);
    expect(r.e).toMatchObject({ state: 'released', amountReleased: '1000000', amountRefunded: '0' });
    expect(r.o.status).toBe('closed');
    expect(s.repo(Payout).rows[0]).toMatchObject({ amount: '950000', status: 'waiting_account', simulated: true });

    const c = s.order({ fulfilment: 'courier', fulfilmentStep: 'courier_pickup', fulfilmentDoneAt: NOW, deliveryFee: '15000' });
    await s.svc.freezeForDispute(c.o.id, 'd', s.m);
    expect(await reason(s.svc.applyDisputeOutcome(c.o.id, 'd', { kind: 'partial', itemRefund: 0n }, s.m))).toBe('between-zero-and-item-price');
    expect(await reason(s.svc.applyDisputeOutcome(c.o.id, 'x', { kind: 'full' }, s.m))).toBe('not-the-open-dispute');
    await s.svc.applyDisputeOutcome(c.o.id, 'd', { kind: 'full' }, s.m);
    expect(c.e).toMatchObject({ state: 'partially_refunded', amountRefunded: '1000000', amountReleased: '15000' });

    const p = s.order();
    await s.svc.freezeForDispute(p.o.id, 'd', s.m);
    await s.svc.applyDisputeOutcome(p.o.id, 'd', { kind: 'after_return' }, s.m);
    expect(p.e.state).toBe('frozen_disputed');
    await s.svc.applyDisputeOutcome(p.o.id, 'd', { kind: 'partial', itemRefund: 300000n }, s.m);
    expect(p.e).toMatchObject({ state: 'partially_refunded', amountRefunded: '300000' });
    expect(s.repo(Refund).rows.map((x) => x.reason)).toEqual(['dispute_full', 'dispute_partial']);
    expect(s.repo(OrdersOutboxEvent).rows.filter((x) => (x.eventType as string).startsWith('orders.escrow.')).map((x) => x.eventType)).toEqual([
      'orders.escrow.frozen', 'orders.escrow.released', 'orders.escrow.frozen', 'orders.escrow.partially_refunded', 'orders.escrow.frozen', 'orders.escrow.partially_refunded',
    ]);
  });

  it('FR-DLV-12 a courier return refunds all, books the charge, and is ignored once settled', async () => {
    const s = setup();
    const c = s.order({ fulfilment: 'courier', fulfilmentStep: 'courier_pickup', fulfilmentDoneAt: NOW, deliveryFee: '15000' });
    await s.svc.refundCourierReturned(c.o.id, 5000n, s.m);
    expect(c.e).toMatchObject({ state: 'refunded', amountRefunded: '1015000' });
    expect(s.repo(JournalEntry).rows.map((x) => x.kind)).toEqual(['escrow_refund', 'courier_return_charge']);
    await s.svc.refundCourierReturned(c.o.id, 5000n, s.m);
    await s.svc.recordCourierCost(c.o.id, 0n, s.m);
    expect(s.repo(Refund).rows).toHaveLength(1);
    expect(s.repo(JournalEntry).rows).toHaveLength(2);
  });

  it('FR-PAY-17 the payout\'s status: pending, cooling off, or held while the seller is suspended', async () => {
    const statuses: string[] = [];
    for (const o of [{ account: { id: 'a', status: 'active', effective_at: new Date(0) } }, { account: { id: 'a', status: 'cooling_off', effective_at: new Date(NOW.getTime() + DAY) } }, { suspended: true }]) {
      const s = setup(o);
      const r = s.order();
      await s.svc.freezeForDispute(r.o.id, 'd', s.m);
      await s.svc.applyDisputeOutcome(r.o.id, 'd', { kind: 'release' }, s.m);
      statuses.push(s.repo(Payout).rows[0].status as string);
    }
    expect(statuses).toEqual(['pending', 'waiting_cooling_off', 'held']);
  });

  it('FR-PAY-14 an unused delivery fee is given back on release, as a fee refund', async () => {
    const s = setup();
    const c = s.order({ fulfilment: 'courier', fulfilmentStep: 'courier_pickup', deliveryFee: '15000' });
    await s.svc.freezeForDispute(c.o.id, 'd', s.m);
    await s.svc.applyDisputeOutcome(c.o.id, 'd', { kind: 'release' }, s.m);
    expect(c.e).toMatchObject({ state: 'partially_refunded', amountRefunded: '15000' });
    expect(s.repo(Refund).rows[0]).toMatchObject({ reason: 'fee_refund', amount: '15000' });
  });
});

describe('split (section 4.4)', () => {
  it('FR-PAY-14 the SRS example and its parts always add up', () => {
    expect(split(1_000_000n, 15_000n, 0n, true, 500, 1000)).toEqual({ commission: 50_000n, courierPayout: 13_500n, deliveryMargin: 1_500n, sellerPayout: 950_000n, refundTotal: 0n });
    expect(split(33n, 0n, 0n, true, 500, 1000).commission).toBe(2n); // half-up: 1.65 -> 2
    expect(() => split(100n, 0n, 101n, false, 500, 1000)).toThrow(RangeError);
    expect(() => split(100n, 0n, -1n, false, 500, 1000)).toThrow(RangeError);
  });
});
