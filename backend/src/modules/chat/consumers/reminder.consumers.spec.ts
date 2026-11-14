import type { OutboxEvent } from '../../../kernel/events/event-bus';
import { ReminderConsumers } from './reminder.consumers';

// U6-06: which events set a deadline (and for whom) and which complete it, with ReminderService faked.

const DUE = '2026-12-04T10:00:00.000Z';
const ev = (type: string, payload: Record<string, unknown>, aggregateId = 'O1'): OutboxEvent =>
  ({ outbox: type.split('.')[0], id: '1', type, aggregateId, payload, createdAt: new Date(), attempt: 1 });

function setup() {
  const reminders = { schedule: jest.fn(async () => 1), cancel: jest.fn(async () => 1) };
  const on = jest.fn();
  const c = new ReminderConsumers({ on } as never, reminders as never);
  return { c, reminders, on };
}

describe('ReminderConsumers', () => {
  it('FR-NTF-07 an auction win sets the buyer\'s payment window; a fixed-price checkout or a cancelled order does not need one', async () => {
    const s = setup();
    await s.c.handle(ev('orders.order.created', { orderId: 'O1', kind: 'auction', buyerId: 'B', sellerId: 'S', paymentDueAt: DUE }));
    await s.c.handle(ev('orders.order.created', { orderId: 'O2', kind: 'fixed_price', buyerId: 'B', sellerId: 'S', paymentDueAt: DUE }));
    await s.c.handle(ev('orders.order.created', { orderId: 'O3', kind: 'second_chance', buyerId: 'B', sellerId: 'S', paymentDueAt: 'not a date' }));
    expect(s.reminders.schedule.mock.calls).toEqual([[['B'], 'payment_window', 'O1', new Date(DUE)]]);
    await s.c.handle(ev('orders.order.cancelled', {}, 'O4')); // no orderId in the payload: the aggregate
    expect(s.reminders.cancel.mock.calls).toEqual([[['payment_window'], 'O4']]);
  });

  it('FR-NTF-07 paying ends the payment window and starts the fulfilment deadline: both for a meetup, the seller for a pickup or credentials', async () => {
    const s = setup();
    const paid = (step: string) => ev('orders.order.paid', { orderId: 'O1', buyerId: 'B', sellerId: 'S', fulfilmentStep: step, fulfilmentDueAt: DUE });
    await s.c.handle(paid('meetup_handover'));
    await s.c.handle(paid('courier_pickup'));
    await s.c.handle(paid('credentials_delivered'));
    await s.c.handle(paid('unknown'));
    expect(s.reminders.schedule.mock.calls).toEqual([
      [['B', 'S'], 'meetup_handover', 'O1', new Date(DUE)], [['S'], 'courier_pickup', 'O1', new Date(DUE)], [['S'], 'credential_delivery', 'O1', new Date(DUE)],
    ]);
    expect(s.reminders.cancel).toHaveBeenCalledTimes(4);
  });

  it('FR-NTF-07 FR-DSP-11 delivery ends the fulfilment deadlines and starts the buyer\'s dispute window; completion and settlement events cancel', async () => {
    const s = setup();
    await s.c.handle(ev('orders.order.delivered', { orderId: 'O1', buyerId: 'B', sellerId: 'S', disputeWindowEndsAt: DUE }));
    await s.c.handle(ev('orders.order.delivered', { orderId: 'O2', buyerId: 'B', sellerId: 'S' }));
    expect(s.reminders.schedule.mock.calls).toEqual([[['B'], 'dispute_window', 'O1', new Date(DUE)]]);
    s.reminders.cancel.mockClear();
    await s.c.handle(ev('delivery.handover.completed', { at: DUE }));
    await s.c.handle(ev('delivery.shipment.status_changed', { direction: 'forward', status: 'in_transit' }));
    await s.c.handle(ev('delivery.shipment.status_changed', { direction: 'forward', status: 'booked' }));
    await s.c.handle(ev('delivery.shipment.status_changed', { direction: 'return', status: 'picked_up' }));
    for (const t of ['released', 'refunded', 'partially_refunded', 'frozen']) await s.c.handle(ev(`orders.escrow.${t}`, { orderId: 'O1' }));
    await s.c.handle(ev('orders.unknown', {}));
    const all = ['payment_window', 'meetup_handover', 'courier_pickup', 'credential_delivery', 'dispute_window'];
    expect(s.reminders.cancel.mock.calls).toEqual([[['meetup_handover'], 'O1'], [['courier_pickup'], 'O1'], ...Array(4).fill([all, 'O1'])]);
  });

  it('FR-NTF-07 an event that sets a deadline without naming both parties is retried, then reported; every mapped event is consumed', async () => {
    const s = setup();
    await expect(s.c.handle(ev('orders.order.paid', { orderId: 'O1', buyerId: 'B', fulfilmentStep: 'meetup_handover', fulfilmentDueAt: DUE }))).rejects.toThrow('no sellerId');
    expect(s.reminders.schedule).not.toHaveBeenCalled();
    s.c.onModuleInit();
    expect(s.on.mock.calls.map(([type, name]) => [type, name])).toEqual(Object.keys(s.c.map).map((type) => [type, 'chat.reminders']));
    await s.on.mock.calls[0][2](ev('orders.order.created', { orderId: 'O1', kind: 'auction', buyerId: 'B', sellerId: 'S', paymentDueAt: DUE }));
    expect(s.reminders.schedule).toHaveBeenCalledTimes(1);
  });
});
