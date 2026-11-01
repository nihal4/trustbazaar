import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import type { Clock } from '../../../kernel/clock';
import { ConfigPort, parameterValues } from '../../../kernel/config-port';
import type { IdempotencyKeys } from '../../../kernel/http/idempotency';
import { Problem } from '../../../kernel/http/problems';
import type { AuditServicePort, IdentityQuery } from '../../identity/ports';
import type { ListingSnapshot, ListingsPort } from '../../listings/ports';
import { OrdersController } from '../http/orders.controller';
import { Escrow, Order, OrdersOutboxEvent } from '../db/entities';
import { fulfilmentRefusal, OrderService } from './order.service';

// Unit tests of OrderService over an in-memory stand-in for TypeORM; the same behaviour against
// PostgreSQL, with its constraints and the 20-buyer race, is in test/api/orders.spec.ts.
type Row = Record<string, unknown>;
const matches = (row: Row, where: Row) => Object.entries(where).every(([k, v]) => row[k] === v);
class Repo {
  rows: Row[] = [];
  constructor(private readonly defaults: () => Row = () => ({})) {}
  async findOne(o: { where: Row }) {
    return this.rows.find((r) => matches(r, o.where)) ?? null;
  }
  async findOneBy(where: Row) {
    return this.rows.find((r) => matches(r, where)) ?? null;
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
const PARAMS = {
  'CP-10': '24 hours', 'CP-11': '12 hours', 'CP-13': '15 minutes', 'CP-25': { standard_bps: 500, pro_bps: 300 }, 'CP-26': 1000,
  'CP-27': { new_days: 30, new_per_order: 5_000_000, new_open: 10_000_000, per_order: 20_000_000 },
};
const snapshot = (o: Partial<ListingSnapshot> = {}): ListingSnapshot => ({
  listingId: 'L1', sellerId: 'S', itemKind: 'physical', saleFormat: 'fixed_price', status: 'active',
  category: { id: 1, slug: 'phones', nameEn: 'Phones', nameBn: 'ফোন' }, title: 'Phone', description: 'd', condition: 'used',
  noVisibleDefects: true, fulfilmentOptions: 'pickup_or_courier', weightClass: null, sizeClass: null, district: 'Dhaka',
  price: '1000000', clarifications: [], photoKeys: ['k1'], capturedAt: NOW.toISOString(), ...o,
});

function setup(o: { snap?: ListingSnapshot; reserve?: boolean; open?: string; verifiedAt?: Date | null; switchOn?: boolean; rows?: { id: string; created_at: Date }[] } = {}) {
  const repos = new Map<unknown, Repo>([
    [Order, new Repo(() => ({ status: 'awaiting_payment', createdAt: NOW, paidAt: null, fulfilmentStep: null, fulfilmentDueAt: null, deliveryEventAt: null, cancelledAt: null, cancelReason: null, closedAt: null }))],
    [Escrow, new Repo()],
    [OrdersOutboxEvent, new Repo()],
  ]);
  const manager = {
    getRepository: (e: unknown) => repos.get(e)!,
    query: jest.fn(async (sql: string, _params: unknown[] = []) => (sql.includes('sum(total)') ? [{ open: o.open ?? '0' }] : sql.includes('FROM orders.orders') ? (o.rows ?? []) : [])),
  };
  const db = { ...manager, manager, transaction: (cb: (m: typeof manager) => unknown) => cb(manager) };
  const listings = { reserve: jest.fn(async () => o.reserve ?? true), snapshot: jest.fn(async () => o.snap ?? snapshot()) };
  const identity = { getPrincipal: jest.fn(async () => ({ verifiedAt: o.verifiedAt === undefined ? new Date('2026-01-01') : o.verifiedAt })) };
  const audit = { record: jest.fn(async () => undefined) };
  const values = parameterValues(PARAMS);
  const params = { current: async () => ({ ...values, version: 7 }), switchOn: async () => o.switchOn ?? true } as unknown as ConfigPort;
  const idempotency = { once: async (_s: string, _u: string, _k: string | undefined, fn: () => Promise<string>) => ({ id: await fn(), repeated: false }) };
  const clock: Clock = { now: () => NOW };
  const svc = new OrderService(
    db as unknown as DataSource, idempotency as unknown as IdempotencyKeys, listings as unknown as ListingsPort,
    identity as unknown as IdentityQuery, audit as unknown as AuditServicePort, params, clock,
  );
  return { svc, manager, listings, audit, orders: repos.get(Order)!, outbox: repos.get(OrdersOutboxEvent)!, escrows: repos.get(Escrow)! };
}

const problemOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    if (err instanceof Problem) return [err.problem, ...((err.extra.errors as { field: string; reason: string }[] | undefined) ?? []).map((e) => `${e.field}:${e.reason}`)];
    throw err;
  }
  throw new Error('no problem raised');
};

describe('OrderService', () => {
  it('FR-FIX-02 checkout reserves first, then records the order with the rates and window of the day', async () => {
    const s = setup();
    const { order } = await s.svc.checkout('B', { listingId: 'L1', quantity: 2, fulfilment: 'self_pickup' }, undefined);
    expect(order).toMatchObject({ status: 'awaiting_payment', itemPrice: '2000000', total: '2000000', fulfilment: 'self_pickup', role: 'buyer', escrow: null });
    expect(s.orders.rows[0]).toMatchObject({ commissionBps: 500, deliveryMarginBps: 1000, paramsVersion: 7, paymentDueAt: new Date(NOW.getTime() + 15 * 60_000) });
    expect(s.listings.reserve).toHaveBeenCalledWith('L1', 2, s.manager);
    expect(s.outbox.rows[0]).toMatchObject({ eventType: 'orders.order.created' });
    expect(s.audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'orders.order.created', actorId: 'B' }), s.manager);
  });

  it('FR-FIX-05 not available, own listing, game accounts and the emergency switch are refused', async () => {
    expect(await problemOf(setup({ reserve: false }).svc.checkout('B', { listingId: 'L1', quantity: 1 }, undefined))).toEqual(['not-available']);
    expect(await problemOf(setup().svc.checkout('S', { listingId: 'L1', quantity: 1 }, undefined))).toEqual(['forbidden', 'listingId:own-listing']);
    expect(await problemOf(setup({ snap: snapshot({ itemKind: 'game_account', fulfilmentOptions: null }) }).svc.checkout('B', { listingId: 'L1', quantity: 1 }, undefined)))
      .toEqual(['feature-off', 'listingId:game-accounts-not-yet-available']);
    expect(await problemOf(setup({ switchOn: false }).svc.checkout('B', { listingId: 'L1', quantity: 1 }, undefined))).toEqual(['feature-off']);
    expect(await problemOf(setup().svc.checkout('B', { listingId: 'L1', quantity: 1, fulfilment: 'courier' }, undefined))).toEqual(['feature-off', 'fulfilment:courier-not-yet-available']);
    expect(await problemOf(setup({ snap: snapshot({ fulfilmentOptions: 'courier_only' }) }).svc.checkout('B', { listingId: 'L1', quantity: 1, fulfilment: 'self_pickup' }, undefined)))
      .toEqual(['validation-failed', 'fulfilment:not-offered-by-listing']);
  });

  it('FR-TNS-07 CP-27 limits for new and for settled buyers', async () => {
    const fresh = { verifiedAt: new Date(NOW.getTime() - 3 * 86_400_000) };
    expect(await problemOf(setup({ ...fresh, snap: snapshot({ price: '6000000' }) }).svc.checkout('B', { listingId: 'L1', quantity: 1 }, undefined))).toEqual(['order-limit', 'total:above-new-account-per-order-limit']);
    expect(await problemOf(setup({ ...fresh, open: '8000000', snap: snapshot({ price: '3000000' }) }).svc.checkout('B', { listingId: 'L1', quantity: 1 }, undefined))).toEqual(['order-limit', 'total:above-new-account-open-limit']);
    expect(await problemOf(setup({ verifiedAt: null, snap: snapshot({ price: '6000000' }) }).svc.checkout('B', { listingId: 'L1', quantity: 1 }, undefined))).toEqual(['order-limit', 'total:above-new-account-per-order-limit']);
    expect((await setup({ snap: snapshot({ price: '6000000' }) }).svc.checkout('B', { listingId: 'L1', quantity: 1 }, undefined)).order.total).toBe('6000000');
    expect(await problemOf(setup({ snap: snapshot({ price: '20000001' }) }).svc.checkout('B', { listingId: 'L1', quantity: 1 }, undefined))).toEqual(['order-limit', 'total:above-per-order-limit']);
  });

  it('FR-DLV-02 the buyer chooses self pickup while the order awaits payment', async () => {
    const s = setup();
    const { order } = await s.svc.checkout('B', { listingId: 'L1', quantity: 1 }, undefined);
    expect(order.fulfilmentOptions).toEqual(['self_pickup', 'courier']);
    expect((await s.svc.chooseFulfilment('B', order.id, 'self_pickup')).fulfilment).toBe('self_pickup');
    expect(await problemOf(s.svc.chooseFulfilment('B', order.id, 'courier'))).toEqual(['feature-off', 'fulfilment:courier-not-yet-available']);
    expect(await problemOf(s.svc.chooseFulfilment('S', order.id, 'self_pickup'))).toEqual(['forbidden']);
    expect(await problemOf(s.svc.chooseFulfilment('X', order.id, 'self_pickup'))).toEqual(['not-found']);
    s.orders.rows[0].status = 'paid';
    expect(await problemOf(s.svc.chooseFulfilment('B', order.id, 'self_pickup'))).toEqual(['order-state']);
    expect(await problemOf(s.svc.chooseFulfilment('B', randomUUID(), 'self_pickup'))).toEqual(['not-found']);
  });

  it('FR-GAM-06 a game account is fulfilled only by the handover, which Unit 5 brings', () => {
    expect(fulfilmentRefusal('game_account', ['game_account'])).toBe('game-accounts-not-yet-available');
    expect(fulfilmentRefusal('self_pickup', ['game_account'])).toBe('not-offered-by-listing');
    expect(fulfilmentRefusal('self_pickup', ['self_pickup'])).toBeNull();
  });

  it('FR-AUC-14 and FR-AUC-15 auction and second-chance orders get their windows, in the caller\'s transaction or their own', async () => {
    const s = setup({ snap: snapshot({ saleFormat: 'auction', price: null }) });
    const a = await s.svc.createAuctionOrder({ listingId: 'L1', winnerId: 'W', price: 230000n, kind: 'auction' }, s.manager as never);
    expect(a).toMatchObject({ kind: 'auction', total: '230000', fulfilment: null, role: 'buyer' });
    expect(s.orders.rows[0].paymentDueAt).toEqual(new Date(NOW.getTime() + 24 * 3_600_000));
    await s.svc.createAuctionOrder({ listingId: 'L1', winnerId: 'W2', price: 200000n, kind: 'second_chance' });
    expect(s.orders.rows[1].paymentDueAt).toEqual(new Date(NOW.getTime() + 12 * 3_600_000));
    expect(s.audit.record).toHaveBeenLastCalledWith(expect.objectContaining({ actorType: 'system', actorId: null }), s.manager);
    await expect(setup().svc.createAuctionOrder({ listingId: 'L1', winnerId: 'W', price: 1n, kind: 'auction' })).rejects.toThrow('not an auction');
  });

  it('IF-UI-05 the order view: the seller\'s role, the escrow once paid, nobody else', async () => {
    const s = setup();
    const { order } = await s.svc.checkout('B', { listingId: 'L1', quantity: 1 }, undefined);
    s.escrows.rows.push({ orderId: order.id, state: 'held', releasePolicy: 'standard', amountCollected: '1000000', amountRefunded: '0', disputeWindowEndsAt: null, autoReleaseAt: NOW });
    expect(await s.svc.getOrderForParty(order.id, 'S')).toMatchObject({ role: 'seller', escrow: { state: 'held', autoReleaseAt: NOW.toISOString() } });
    expect(await problemOf(s.svc.getOrderForParty(order.id, 'X'))).toEqual(['not-found']);
  });

  it('IF-UI-05 my orders in pages of 50 with a cursor', async () => {
    const rows = Array.from({ length: 51 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, created_at: NOW }));
    const s = setup({ rows });
    for (const r of rows) s.orders.rows.push({ id: r.id, buyerId: 'B', sellerId: 'S', listingSnapshot: snapshot(), itemKind: 'physical', paymentDueAt: NOW, createdAt: NOW });
    const page = await s.svc.list('S', 'seller', undefined);
    expect(page.items).toHaveLength(50);
    expect(page.items[0].role).toBe('seller');
    expect(s.manager.query.mock.calls[0][0]).toContain('seller_id');
    await s.svc.list('B', 'buyer', page.nextCursor!);
    expect(s.manager.query.mock.calls[1][1]).toEqual(['B', NOW.toISOString(), rows[49].id]);
    expect(await problemOf(s.svc.list('B', 'buyer', 'eA'))).toEqual(['validation-failed', 'cursor:format']);
    expect((await setup().svc.list('B', 'buyer', undefined)).nextCursor).toBeNull();
  });
});

describe('OrdersController', () => {
  const user = { type: 'user', userId: 'B', sessionId: 's', accountStatus: 'active', kycStatus: 'verified', emailVerified: true } as const;
  it('IF-UI-05 each route hands its caller and input to OrderService', async () => {
    const svc = {
      checkout: jest.fn(async () => ({ order: { id: 'o' }, repeated: false })), list: jest.fn(), getOrderForParty: jest.fn(), chooseFulfilment: jest.fn(),
    };
    const c = new OrdersController(svc as unknown as OrderService);
    const res = { status: jest.fn() };
    expect(await c.checkout({ listingId: 'L', quantity: 1 }, 'k', user, res as never)).toEqual({ id: 'o' });
    expect(res.status).toHaveBeenCalledWith(201);
    await c.list({}, user);
    await c.view('o', user);
    await c.fulfilment('o', { fulfilment: 'self_pickup' }, user);
    expect(svc.list).toHaveBeenCalledWith('B', 'buyer', undefined);
    expect(svc.chooseFulfilment).toHaveBeenCalledWith('B', 'o', 'self_pickup');
    expect(() => c.view('o', { type: 'staff', staffId: 's', sessionId: 's', role: 'operator' })).toThrow(Problem);
  });
});
