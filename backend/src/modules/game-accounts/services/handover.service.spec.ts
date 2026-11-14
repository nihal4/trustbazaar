import { webcrypto } from 'crypto';
import { QueryFailedError } from 'typeorm';
import type { OutboxEvent } from '../../../kernel/events/event-bus';
import { Problem } from '../../../kernel/http/problems';
import { HandoverConsumers } from '../consumers/handover.consumers';
import { DISCLOSURE_VERSION } from '../ports';
import { HandoverService } from './handover.service';

// U5-03 (first part) with the database, Unit 2 and the parameters faked: who may do what, the key's form, how the
// database's refusals reach the buyer, and the events. The same against PostgreSQL: test/api/game-checkout.spec.ts.

const T = new Date('2026-12-01T10:00:00Z');
const dbError = (message: string) => new QueryFailedError('q', [], Object.assign(new Error(message), { code: '23514' }));
const ORDER = { id: 'O', role: 'buyer', status: 'awaiting_payment', listing: { id: 'L', itemKind: 'game_account' }, buyerId: 'B', sellerId: 'S' };

function setup(answer: (sql: string) => unknown = () => [], o: { order?: Record<string, unknown> | null; cp36?: boolean } = {}) {
  const query = jest.fn(async (sql: string, _p?: unknown[]) => {
    const r = answer(sql);
    if (r instanceof Error) throw r;
    return r;
  });
  const db = { query, transaction: async <R>(fn: (m: unknown) => Promise<R>) => fn({ query }) };
  const orders = { getOrderForParty: jest.fn(async () => { if (o.order === null) throw new Problem('not-found'); return { ...ORDER, ...(o.order ?? {}) }; }) };
  const params = { current: async () => ({ get: () => o.cp36 ?? true }) };
  return { svc: new HandoverService(db as never, orders as never, params as never), query };
}
const failure = (p: Promise<unknown>) => p.then(() => 'ok', (e: Problem) => (e.extra?.errors as { reason: string }[] | undefined)?.[0]?.reason ?? e.problem);
const point = async () => {
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  return Buffer.from(await webcrypto.subtle.exportKey('raw', pair.publicKey)).toString('base64url');
};
const event = (type: string, payload: Record<string, unknown>): OutboxEvent => ({ outbox: 'orders', id: '7', type, aggregateId: 'O', payload, createdAt: T, attempt: 1 });
const handoverRow = { status: 'preparing', disclosure_version: 1, disclosure_ack_at: T, key_version: 0, rekeys_used: 0, credentials_due_at: null, first_delivered_at: null, delivered_at: null, takeover_due_at: null, rekey_due_at: null, taken_over_at: null };

describe('HandoverService (checkout)', () => {
  it('FR-GAM-05 the buyer acknowledges the current disclosure on an unpaid game-account order; the view shows no key', async () => {
    const s = setup((q) => (q.startsWith('SELECT * FROM game_accounts.handovers') ? [handoverRow] : []));
    expect(await s.svc.acknowledge('B', 'O', DISCLOSURE_VERSION)).toEqual({
      orderId: 'O', role: 'buyer', disclosure: { currentVersion: 1, acknowledgedVersion: 1, acknowledgedAt: T.toISOString() }, status: 'preparing', keyVersion: 0, rekeysUsed: 0,
      credentialsDueAt: null, firstDeliveredAt: null, deliveredAt: null, takeoverDueAt: null, rekeyDueAt: null, takenOverAt: null,
    });
    expect(s.query.mock.calls[0][1]).toEqual(['O', 'L', 'B', 'S', 1]);
    expect(await setup().svc.view('S', 'O')).toMatchObject({ status: null, keyVersion: 0, disclosure: { acknowledgedVersion: null } });
    expect(await failure(setup().svc.acknowledge('B', 'O', 2))).toBe('not-current');
    expect(await failure(setup(undefined, { cp36: false }).svc.acknowledge('B', 'O', 1))).toBe('feature-off');
    expect(await failure(setup(undefined, { order: { status: 'paid' } }).svc.acknowledge('B', 'O', 1))).toBe('order-state');
    expect(await failure(setup(undefined, { order: { role: 'seller' } }).svc.acknowledge('S', 'O', 1))).toBe('forbidden');
    expect(await failure(setup(undefined, { order: { listing: { id: 'L', itemKind: 'physical' } } }).svc.acknowledge('B', 'O', 1))).toBe('not-found');
  });

  it('FR-GAM-07 the key is a P-256 point on the curve, after the disclosure, fixed until payment', async () => {
    const s = setup(() => [{ version: 1 }]);
    const key = await point();
    expect(await s.svc.registerKey('B', 'O', 'sess', key)).toEqual({ keyVersion: 1 });
    expect(s.query.mock.calls[0][1]).toEqual(['O', 'B', Buffer.from(key, 'base64url'), 'sess']);
    for (const bad of ['not base64url!', Buffer.alloc(65, 4).toString('base64url'), Buffer.alloc(33, 2).toString('base64url')]) {
      expect(await failure(setup().svc.registerKey('B', 'O', 'sess', bad))).toBe('not-a-p256-point');
    }
    expect(await failure(setup(() => dbError('acknowledge the disclosure first')).svc.registerKey('B', 'O', 'sess', key))).toBe('not-acknowledged');
    expect(await failure(setup(() => dbError('the key is fixed at checkout; after payment use a re-key')).svc.registerKey('B', 'O', 'sess', key))).toBe('key-fixed');
    await expect(setup(() => dbError('other')).svc.registerKey('B', 'O', 'sess', key)).rejects.toBeInstanceOf(QueryFailedError);
  });

  it('FR-GAM-05 FR-GAM-07 checkout is ready only with CP-36 on, the disclosure and the key', async () => {
    await expect(setup(() => [{ ready: true }]).svc.assertCheckoutReady('O')).resolves.toBeUndefined();
    expect(await failure(setup(() => [{ ready: false }]).svc.assertCheckoutReady('O'))).toBe('checkout-not-ready');
    expect(await failure(setup(() => [{ ready: true }], { cp36: false }).svc.assertCheckoutReady('O'))).toBe('feature-off');
  });

  it('FR-GAM-10 FR-GAM-04 a paid game-account order asks the seller for the credentials once and names the order on the claim; an unpaid cancellation cancels the handover', async () => {
    const paid = event('orders.order.paid', { orderId: 'O', itemKind: 'game_account', fulfilmentDueAt: T.toISOString() });
    const s = setup((q) => (q.includes('FOR UPDATE') ? [{ status: 'preparing', listing_id: 'L' }] : []));
    expect(await s.svc.onPaid(paid)).toBe(true);
    expect(s.query.mock.calls.map(([q]) => q.split('(')[0].trim())).toEqual(['SELECT status, listing_id FROM game_accounts.handovers WHERE order_id = $1 FOR UPDATE', 'SELECT game_accounts.mark_paid', 'UPDATE game_accounts.claims SET order_id = $2 WHERE listing_id = $1 AND released_at IS NULL AND order_id IS NULL']);
    expect(await setup((q) => (q.includes('FOR UPDATE') ? [{ status: 'awaiting_credentials', listing_id: 'L' }] : [])).svc.onPaid(paid)).toBe(false);
    expect(await setup().svc.onPaid(event('orders.order.paid', { itemKind: 'physical' }))).toBe(false);
    await expect(setup().svc.onPaid(event('orders.order.paid', { itemKind: 'game_account' }))).rejects.toThrow(/no fulfilmentDueAt/);
    await expect(setup(() => []).svc.onPaid(paid)).rejects.toThrow(/no handover/);
    expect(await setup(() => [[], 1]).svc.onCancelled(event('orders.order.cancelled', { orderId: 'O' }))).toBe(1);

    const handlers = new Map<string, (e: OutboxEvent) => Promise<void>>();
    const bus = { on: (type: string, _n: string, h: (e: OutboxEvent) => Promise<void>) => void handlers.set(type, h) };
    const svc = { onPaid: jest.fn(async () => true), onCancelled: jest.fn(async () => 1) };
    new HandoverConsumers(bus as never, svc as never).onModuleInit();
    await handlers.get('orders.order.paid')!(paid);
    await handlers.get('orders.order.cancelled')!(paid);
    expect([svc.onPaid.mock.calls.length, svc.onCancelled.mock.calls.length]).toEqual([1, 1]);
  });
});
