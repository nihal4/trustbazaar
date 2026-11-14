import type { OutboxEvent } from '../../../kernel/events/event-bus';
import { TrustConsumers } from './trust.consumers';

// U7-04: which events make a strike, and the reinstatement that lifts an account suspension; SanctionService faked.
const ev = (type: string, payload: Record<string, unknown>, aggregateId = 'O1'): OutboxEvent =>
  ({ outbox: type.split('.')[0], id: '1', type, aggregateId, payload, createdAt: new Date(), attempt: 1 });

describe('TrustConsumers', () => {
  function setup() {
    const handlers = new Map<string, (e: OutboxEvent) => Promise<void>>();
    const bus = { on: jest.fn((type: string, name: string, h: (e: OutboxEvent) => Promise<void>) => handlers.set(`${type}/${name}`, h)) };
    const sanctions = { strike: jest.fn(async () => false), onReinstated: jest.fn(async () => 1) };
    const ratings = { onEscrowClosed: jest.fn(async (_e: OutboxEvent) => true) };
    new TrustConsumers(bus as never, sanctions as never, ratings as never).onModuleInit();
    const run = (key: string, e: OutboxEvent) => handlers.get(key)!(e);
    return { run, sanctions, ratings, handlers };
  }

  it('FR-TNS-04 I-44 a cancellation after payment and a refund at a missed deadline are strikes; other refunds are not', async () => {
    const s = setup();
    await s.run('orders.order.cancelled_by_seller/trust.strikes', ev('orders.order.cancelled_by_seller', { orderId: 'O1', sellerId: 'S' }));
    await s.run('orders.escrow.refunded/trust.strikes', ev('orders.escrow.refunded', { sellerId: 'S', reason: 'fulfilment_deadline' }, 'O2'));
    await s.run('orders.escrow.refunded/trust.strikes', ev('orders.escrow.refunded', { orderId: 'O3', sellerId: 'S', reason: 'dispute_full' }));
    expect(s.sanctions.strike.mock.calls).toEqual([['S', 'unilateral_cancel', 'O1'], ['S', 'missed_deadline', 'O2']]);
    await expect(s.run('orders.order.cancelled_by_seller/trust.strikes', ev('orders.order.cancelled_by_seller', { orderId: 'O1' }))).rejects.toThrow('no sellerId');
  });

  it('CP-30 a reinstatement lifts the account suspension with its approval', async () => {
    const s = setup();
    await s.run('identity.account.reinstated/trust.sanctions', ev('identity.account.reinstated', { approvalId: 'A1', decidedBy: 'ST', reason: 'Checked again and fine.' }, 'U1'));
    await s.run('identity.account.reinstated/trust.sanctions', ev('identity.account.reinstated', { userId: 'U2', approvalId: 'A2' }, 'U2'));
    expect(s.sanctions.onReinstated.mock.calls).toEqual([
      [{ userId: 'U1', approvalId: 'A1', decidedBy: 'ST', reason: 'Checked again and fine.' }], [{ userId: 'U2', approvalId: 'A2', decidedBy: null, reason: null }],
    ]);
  });

  it('FR-REV-01 every terminal escrow event makes the order rateable', async () => {
    const s = setup();
    for (const t of ['released', 'refunded', 'partially_refunded']) await s.run(`orders.escrow.${t}/trust.ratings`, ev(`orders.escrow.${t}`, { orderId: 'O1' }));
    expect(s.ratings.onEscrowClosed.mock.calls.map(([e]) => e.type)).toEqual(['orders.escrow.released', 'orders.escrow.refunded', 'orders.escrow.partially_refunded']);
  });
});
