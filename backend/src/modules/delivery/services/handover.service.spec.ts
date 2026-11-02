import { QueryFailedError } from 'typeorm';
import { Problem } from '../../../kernel/http/problems';
import { ForwardedFulfilmentOrders } from '../adapters/orders';
import { HandoverConsumers } from '../consumers/handover.consumers';
import { HandoverController } from '../http/handover.controller';
import { codeMatches, deriveCode } from './handover-code';
import { HandoverService } from './handover.service';
import { MeetupPointsService, mapUrl } from './meetup-points.service';

// U4-03 with the database and Unit 2 faked: what the handover asks of each, in which order, and how it answers. The
// rules themselves are the database's (04_delivery_tests.sql) and are run for real in test/api/handover.spec.ts.

const KEY = 'k'.repeat(32);
const ORDER = 'o0000000-0000-4000-8000-000000000001';
type HRow = Record<string, unknown>;
const H: HRow = {
  order_id: ORDER, buyer_id: 'B', seller_id: 'S', status: 'arranging', due_at: new Date('2026-11-09T00:00:00Z'), code_version: 1, wrong_entries: 0,
  agreed_proposal_id: null, locked_at: null, completed_at: null, cancelled_at: null,
};
const POINT = { id: 'P1', kind: 'police_station', name_en: 'Kotwali', name_bn: 'কোতোয়ালী', district: 'Sylhet', lat: '24.89123', lng: '91.87123', guidance: null, active: true };
const dbError = (message: string, code = '23514') => new QueryFailedError('q', [], Object.assign(new Error(message), { code, message }));
const problemOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof Problem) return [e.problem, ...((e.extra.errors as { field: string; reason: string }[] | undefined) ?? []).map((x) => `${x.field}:${x.reason}`)];
    throw e;
  }
  return null;
};

function setup(o: { handover?: HRow | null; recordResult?: string; recordError?: string; facts?: Record<string, unknown>; area?: { lat: number; lng: number } | null } = {}) {
  const calls: string[] = [];
  const answer = (sql: string, p: unknown[]): unknown => {
    calls.push(sql.trim().split(/\s+/).slice(0, 3).join(' '));
    if (sql.includes('FROM delivery.handovers')) return o.handover === null ? [] : [{ ...H, ...o.handover }];
    if (sql.includes('FROM delivery.meetup_proposals p JOIN')) return [{ proposed_by: 'B', meet_at: new Date('2026-11-03T10:00:00Z'), note: null, status: 'accepted', created_at: new Date(), point_id: 'P1', ...POINT, id: 'X1' }];
    if (sql.includes('record_code_entry')) {
      if (o.recordError) throw dbError(o.recordError);
      return [{ r: o.recordResult ?? 'accepted' }];
    }
    if (sql.includes('respond_meetup')) return [{ outcome: p[2] ? 'accepted' : 'declined' }];
    if (sql.includes('SELECT proposed_by')) return [{ proposed_by: 'B' }];
    if (sql.includes("SET status = 'withdrawn'")) return [[], 0];
    if (sql.includes('unlock_code')) return [{ v: 2 }];
    return [];
  };
  const query = jest.fn(async (sql: string, p: unknown[] = []) => answer(sql, p));
  const manager = { query };
  const db = { query, manager, transaction: async <T>(fn: (m: typeof manager) => Promise<T>) => fn(manager) };
  const points = { suggest: jest.fn(async () => [{ id: 'P1' }]) };
  const orders = {
    lockForFulfilment: jest.fn(async () => ({ orderId: ORDER, status: 'paid', fulfilment: 'self_pickup', buyerId: 'B', sellerId: 'S', ...o.facts })),
    recordFulfilmentStep: jest.fn(async () => undefined),
    recordDeliveryEvent: jest.fn(async () => undefined),
  };
  const identity = { getApproxArea: jest.fn(async () => (o.area === undefined ? { district: 'Sylhet', lat: 24.9, lng: 91.85 } : o.area)) };
  const audit = { record: jest.fn(async () => undefined) };
  const params = { current: async () => ({ get: () => 5 }) };
  const config = { secrets: { handoverKey: { reveal: () => KEY } } };
  const clock = { now: () => new Date('2026-11-02T12:00:00Z') };
  const svc = new HandoverService(db as never, points as never, orders as never, identity as never, audit as never, params as never, config as never, clock as never);
  return { svc, db, query, calls, points, orders, audit };
}

describe('the handover code', () => {
  it('FR-DLV-06 DV-28 six digits, derived from the order and version, the same on every request, new with each version', () => {
    const c1 = deriveCode(KEY, ORDER, 1);
    expect(c1).toMatch(/^\d{6}$/);
    expect(deriveCode(KEY, ORDER, 1)).toBe(c1);
    expect(deriveCode(KEY, ORDER, 2)).not.toBe(c1);
    expect(deriveCode('x'.repeat(32), ORDER, 1)).not.toBe(c1);
    expect(codeMatches(` ${c1} `, c1)).toBe(true);
    expect(codeMatches('12345', c1)).toBe(false);
    expect(codeMatches('abcdef', c1)).toBe(false);
    expect(codeMatches(c1 === '000000' ? '000001' : '000000', c1)).toBe(false);
  });
});

describe('HandoverService', () => {
  it('FR-DLV-06 the buyer sees the code, the seller the attempts left, anyone else nothing', async () => {
    const s = setup();
    const b = await s.svc.view('B', ORDER);
    expect(b).toMatchObject({ role: 'buyer', code: deriveCode(KEY, ORDER, 1), attemptsLeft: null, suggestions: [{ id: 'P1' }] });
    expect(b.proposals[0].point.mapUrl).toBe(mapUrl(24.89123, 91.87123));
    expect(await s.svc.view('S', ORDER)).toMatchObject({ role: 'seller', code: null, attemptsLeft: 5 });
    expect(await problemOf(s.svc.view('X', ORDER))).toEqual(['not-found']);
    expect((await setup({ handover: { status: 'completed', completed_at: new Date() } }).svc.view('B', ORDER))).toMatchObject({ code: null, suggestions: [] });
    expect((await setup({ area: null }).svc.view('B', ORDER)).suggestions).toEqual([]);
  });

  it('FR-DLV-06 DC-14 a correct entry locks the order first, then records the step and the delivery event', async () => {
    const s = setup();
    expect(await s.svc.enterCode('S', ORDER, deriveCode(KEY, ORDER, 1))).toEqual({ status: 'completed', completedAt: '2026-11-02T12:00:00.000Z' });
    expect(s.orders.lockForFulfilment.mock.invocationCallOrder[0]).toBeLessThan(s.query.mock.invocationCallOrder[0]);
    expect(s.query.mock.calls.find(([sql]) => String(sql).includes('record_code_entry'))?.[1]).toEqual([ORDER, 'S', true, 5]);
    expect(s.orders.recordFulfilmentStep).toHaveBeenCalledWith(ORDER, 'meetup_handover', new Date('2026-11-02T12:00:00Z'), s.db.manager);
    expect(s.orders.recordDeliveryEvent).toHaveBeenCalledWith(ORDER, 'handover_code', new Date('2026-11-02T12:00:00Z'), s.db.manager);
  });

  it('CP-45 wrong entries are counted and answered the same way; the lock and the database\'s refusals become codes', async () => {
    const wrong = setup({ recordResult: 'wrong', handover: { wrong_entries: 1 } });
    await expect(wrong.svc.enterCode('S', ORDER, '000000')).rejects.toMatchObject({ problem: 'delivery-refused', extra: { errors: [{ field: 'code', reason: 'wrong_code', attemptsLeft: 3 }] } });
    expect(wrong.orders.recordDeliveryEvent).not.toHaveBeenCalled();
    expect(await problemOf(setup({ recordResult: 'locked' }).svc.enterCode('S', ORDER, '000000'))).toEqual(['delivery-refused', 'code:code_locked']);
    expect(await problemOf(setup({ recordError: 'the handover deadline has passed' }).svc.enterCode('S', ORDER, '000000'))).toEqual(['delivery-refused', 'code:deadline_passed']);
    expect(await problemOf(setup().svc.enterCode('B', ORDER, '000000'))).toEqual(['forbidden', 'code:seller-only']);
    expect(await problemOf(setup().svc.enterCode('X', ORDER, '000000'))).toEqual(['not-found']);
    expect(await problemOf(setup({ facts: { status: 'cancelled' } }).svc.enterCode('S', ORDER, '000000'))).toEqual(['delivery-refused', 'handover:handover_closed']);
    expect(await problemOf(setup({ handover: null }).svc.enterCode('S', ORDER, '000000'))).toEqual(['not-found']);
  });

  it('FR-DLV-04 proposals: DV-26 to the database; the other party answers; the proposer withdraws', async () => {
    const s = setup();
    await s.svc.propose('B', ORDER, { pointId: 'P1', meetAt: '2026-11-03T10:00:00Z', note: '  Main gate ' });
    expect(s.query.mock.calls.find(([sql]) => String(sql).includes('propose_meetup'))?.[1]).toEqual([ORDER, 'B', 'P1', '2026-11-03T10:00:00Z', 'Main gate', '1 hour', '2 hours']);
    expect(await problemOf(s.svc.propose('B', ORDER, { pointId: 'P1', meetAt: 'x', note: 'n'.repeat(201) }))).toEqual(['validation-failed', 'note:too-long']);
    expect((await s.svc.respond('S', ORDER, 'X1', true)).outcome).toBe('accepted');
    expect((await s.svc.respond('S', ORDER, 'X1', false)).outcome).toBe('declined');
    expect(await problemOf(s.svc.respond('B', ORDER, 'X1', true))).toEqual(['forbidden', 'proposalId:own-proposal']);
    expect(await problemOf(s.svc.withdraw('S', ORDER, 'X1'))).toEqual(['forbidden', 'proposalId:not-your-proposal']);
    expect(await problemOf(s.svc.withdraw('B', ORDER, 'X1'))).toEqual(['delivery-refused', 'proposalId:proposal_closed']);
  });

  it('FR-DLV-05 the handover opens and closes with Unit 2\'s events; an operator\'s unlock is audited and settles the lock\'s issue', async () => {
    const s = setup({ handover: { status: 'locked', locked_at: new Date() } });
    await s.svc.open({ orderId: ORDER, buyerId: 'B', sellerId: 'S', dueAt: '2026-11-09T00:00:00Z' });
    expect(s.query.mock.calls[0][0]).toMatch(/ON CONFLICT \(order_id\) DO NOTHING/);
    await s.svc.cancel(ORDER);
    expect(s.query.mock.calls.some(([sql]) => String(sql).includes("status = 'cancelled'"))).toBe(true);
    await s.svc.unlockHandoverCode(ORDER, 'OP', '  Spoke to both parties. ');
    expect(s.query.mock.calls.some(([sql]) => String(sql).includes("kind = 'code_locked'"))).toBe(true);
    expect(s.audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'delivery.handover.unlocked', reason: 'Spoke to both parties.' }), s.db.manager);
    expect(await problemOf(s.svc.unlockHandoverCode(ORDER, 'OP', 'short'))).toEqual(['validation-failed', 'reason:too-short']);
    expect(await problemOf(setup().svc.unlockHandoverCode(ORDER, 'OP', 'Spoke to both parties.'))).toEqual(['validation-failed', 'handover:not-locked']);
    expect(await problemOf(setup({ handover: null }).svc.unlockHandoverCode(ORDER, 'OP', 'Spoke to both parties.'))).toEqual(['not-found']);
    const closed = setup({ handover: { status: 'completed', completed_at: new Date() } });
    await closed.svc.cancel(ORDER);
    expect(closed.query.mock.calls.some(([sql]) => String(sql).includes("status = 'cancelled'"))).toBe(false);
  });
});

describe('MeetupPointsService', () => {
  it('FR-DLV-03 suggestions snap to the DV-27 grid; administrators add and change points, audited', async () => {
    const query = jest.fn(async (sql: string, _p?: unknown[]) => (sql.startsWith('SELECT') || sql.includes('RETURNING') ? [POINT] : []));
    const manager = { query };
    const db = { query, manager, transaction: async <T>(fn: (m: typeof manager) => Promise<T>) => fn(manager) };
    const audit = { record: jest.fn(async () => undefined) };
    const svc = new MeetupPointsService(db as never, audit as never);
    expect((await svc.suggest({ lat: 24.9, lng: 91.85 }, { lat: 24.91, lng: 91.86 }))[0]).toMatchObject({ id: 'P1', lat: 24.89123, mapUrl: mapUrl(24.89123, 91.87123) });
    expect(query.mock.calls[0][1]).toEqual([24.9, 91.85, 24.91, 91.86, 3, 0.02]);
    expect((await svc.list()).items).toHaveLength(1);
    expect(await svc.get('P1')).toMatchObject({ nameEn: 'Kotwali' });
    await svc.create('A1', { kind: 'police_station', nameEn: ' Kotwali ', nameBn: 'কোতোয়ালী', district: 'Sylhet', lat: 24.891234, lng: 91.871234 });
    await svc.update('A1', 'P1', { guidance: 'Main gate', active: false });
    expect(audit.record.mock.calls.map((c) => (c as unknown as [{ action: string }])[0].action)).toEqual(['delivery.meetup_point.added', 'delivery.meetup_point.changed']);
    const none = new MeetupPointsService({ ...db, query: jest.fn(async () => []), manager: { query: jest.fn(async () => []) }, transaction: async <T>(fn: (m: { query: () => Promise<never[]> }) => Promise<T>) => fn({ query: async () => [] }) } as never, audit as never);
    expect(await none.get('P9')).toBeNull();
    await expect(none.update('A1', 'P9', { active: false })).rejects.toMatchObject({ problem: 'not-found' });
    const out = new MeetupPointsService({ transaction: async () => { throw dbError('check'); } } as never, audit as never);
    await expect(out.create('A1', { kind: 'other_public', nameEn: 'X', nameBn: 'Y', district: 'Z', lat: 40, lng: 90 })).rejects.toMatchObject({ problem: 'validation-failed' });
  });
});

describe('handover wiring', () => {
  it('FR-DLV-05 only a paid self-pickup physical order opens a handover; a refund closes it', async () => {
    const handlers = new Map<string, (e: unknown) => Promise<void>>();
    const bus = { on: (type: string, _name: string, fn: (e: unknown) => Promise<void>) => handlers.set(type, fn) };
    const handovers = { open: jest.fn(async () => undefined), cancel: jest.fn(async () => undefined) };
    new HandoverConsumers(bus as never, handovers as never).onModuleInit();
    const paid = (payload: Record<string, unknown>) => handlers.get('orders.order.paid')!({ aggregateId: ORDER, payload });
    await paid({ orderId: ORDER, fulfilment: 'self_pickup', itemKind: 'physical', buyerId: 'B', sellerId: 'S', fulfilmentDueAt: '2026-11-09T00:00:00Z' });
    await paid({ orderId: ORDER, fulfilment: 'courier', itemKind: 'physical', buyerId: 'B', sellerId: 'S', fulfilmentDueAt: '2026-11-09T00:00:00Z' });
    await paid({ orderId: ORDER, fulfilment: 'self_pickup', itemKind: 'game_account', buyerId: 'B', sellerId: 'S', fulfilmentDueAt: '2026-11-09T00:00:00Z' });
    expect(handovers.open).toHaveBeenCalledTimes(1);
    expect(handovers.open).toHaveBeenCalledWith({ orderId: ORDER, buyerId: 'B', sellerId: 'S', dueAt: '2026-11-09T00:00:00Z' });
    await handlers.get('orders.escrow.refunded')!({ aggregateId: ORDER, payload: { orderId: ORDER } });
    expect(handovers.cancel).toHaveBeenCalledWith(ORDER);
  });

  it('IF-UI-05 each handover route hands its caller and input to the service', async () => {
    const svc = { view: jest.fn(), propose: jest.fn(), respond: jest.fn(), withdraw: jest.fn(), enterCode: jest.fn(), unlockHandoverCode: jest.fn(async () => undefined) };
    const c = new HandoverController(svc as never);
    const user = { type: 'user', userId: 'B', sessionId: 's', accountStatus: 'active', kycStatus: 'verified', emailVerified: true } as const;
    const staff = { type: 'staff', staffId: 'OP', sessionId: 's', role: 'operator' } as const;
    c.view(ORDER, user);
    c.propose(ORDER, { pointId: 'P1', meetAt: '2026-11-03T10:00:00Z' }, user);
    c.accept(ORDER, 'X1', user);
    c.decline(ORDER, 'X1', user);
    c.withdraw(ORDER, 'X1', user);
    c.code(ORDER, { code: '123456' }, user);
    await c.unlock(ORDER, { reason: 'Spoke to both parties.' }, staff);
    expect(svc.respond.mock.calls).toEqual([['B', ORDER, 'X1', true], ['B', ORDER, 'X1', false]]);
    expect(svc.enterCode).toHaveBeenCalledWith('B', ORDER, '123456');
    expect(svc.unlockHandoverCode).toHaveBeenCalledWith(ORDER, 'OP', 'Spoke to both parties.');
    expect(() => c.view(ORDER, staff)).toThrow(Problem);
    await expect(c.unlock(ORDER, { reason: 'x' }, user)).rejects.toBeInstanceOf(Problem);
  });

  it('I-20 Unit 2\'s ports are found on first use', async () => {
    const port = { lockForFulfilment: jest.fn(async () => ({})), recordFulfilmentStep: jest.fn(async () => undefined), recordDeliveryEvent: jest.fn(async () => undefined) };
    const f = new ForwardedFulfilmentOrders({ get: () => port } as never);
    await f.lockForFulfilment(ORDER, {} as never);
    await f.recordFulfilmentStep(ORDER, 'meetup_handover', new Date(), {} as never);
    await f.recordDeliveryEvent(ORDER, 'handover_code', new Date(), {} as never);
    expect(port.lockForFulfilment).toHaveBeenCalled();
    expect(port.recordDeliveryEvent).toHaveBeenCalled();
  });
});
