import { Injectable, OnModuleInit } from '@nestjs/common';
import { EventBus, OutboxEvent } from '../../../kernel/events/event-bus';
import type { DeadlineKind } from '../../orders/ports';
import { ReminderService } from '../services/reminder.service';

// The reminders column of the event map (docs/design/06_chat_notifications.pdf section 3.4; FR-NTF-07; U6-06): which
// events set a deadline (and for whom) and which complete it. A consumer of its own beside the notices, so either can
// be retried alone. Scheduling and cancelling are idempotent, so an event delivered twice changes nothing (DC-6).
// Unit 5's takeover window and protection period come with Unit 5's events (I-32, I-39).

const CONSUMER = 'chat.reminders';
const FULFILMENT: readonly DeadlineKind[] = ['meetup_handover', 'courier_pickup', 'credential_delivery'];
const ALL: readonly DeadlineKind[] = ['payment_window', ...FULFILMENT, 'dispute_window'];
/** The order's fulfilment step and the reminder kind of its deadline (FR-NTF-07). */
const KIND_OF_STEP: Record<string, DeadlineKind> = { meetup_handover: 'meetup_handover', courier_pickup: 'courier_pickup', credentials_delivered: 'credential_delivery' };
/** Shipment statuses that mean the courier has the parcel: the pickup deadline is met. */
const PICKED_UP = new Set(['picked_up', 'in_transit', 'delivery_failed', 'delivered']);

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const date = (v: unknown) => {
  const d = new Date(str(v));
  return Number.isNaN(d.getTime()) ? null : d;
};

@Injectable()
export class ReminderConsumers implements OnModuleInit {
  constructor(
    private readonly bus: EventBus,
    private readonly reminders: ReminderService,
  ) {}

  /** Event type -> what it does to the order's reminders. */
  readonly map: Record<string, (e: OutboxEvent, orderId: string) => Promise<unknown>> = {
    // the payment window of an auction or second-chance order; a fixed-price checkout's is minutes long (CP-13)
    'orders.order.created': async (e, id) => {
      const due = date(e.payload.paymentDueAt);
      if (e.payload.kind !== 'fixed_price' && due) await this.reminders.schedule([str(e.payload.buyerId)], 'payment_window', id, due);
    },
    'orders.order.cancelled': (_, id) => this.reminders.cancel(['payment_window'], id),
    // paid: the payment window is met, and the fulfilment deadline starts (both attend a meetup)
    'orders.order.paid': async (e, id) => {
      await this.reminders.cancel(['payment_window'], id);
      const kind = KIND_OF_STEP[str(e.payload.fulfilmentStep)];
      const due = date(e.payload.fulfilmentDueAt);
      if (!kind || !due) return;
      const to = kind === 'meetup_handover' ? [str(e.payload.buyerId), str(e.payload.sellerId)] : [str(e.payload.sellerId)];
      await this.reminders.schedule(to, kind, id, due);
    },
    // the delivery event: fulfilment done; the buyer's dispute window starts (FR-DSP-11)
    'orders.order.delivered': async (e, id) => {
      await this.reminders.cancel(FULFILMENT, id);
      const due = date(e.payload.disputeWindowEndsAt);
      if (due) await this.reminders.schedule([str(e.payload.buyerId)], 'dispute_window', id, due);
    },
    'delivery.handover.completed': (_, id) => this.reminders.cancel(['meetup_handover'], id),
    'delivery.shipment.status_changed': async (e, id) => {
      if (e.payload.direction === 'forward' && PICKED_UP.has(str(e.payload.status))) await this.reminders.cancel(['courier_pickup'], id);
    },
    // the order is settled or frozen by a dispute: nothing left to remind of
    'orders.escrow.released': (_, id) => this.reminders.cancel(ALL, id),
    'orders.escrow.refunded': (_, id) => this.reminders.cancel(ALL, id),
    'orders.escrow.partially_refunded': (_, id) => this.reminders.cancel(ALL, id),
    'orders.escrow.frozen': (_, id) => this.reminders.cancel(ALL, id),
  };

  onModuleInit(): void {
    for (const type of Object.keys(this.map)) this.bus.on(type, CONSUMER, async (e) => void (await this.handle(e)));
  }

  async handle(e: OutboxEvent): Promise<void> {
    const apply = this.map[e.type];
    if (!apply) return;
    const orderId = str(e.payload.orderId) || e.aggregateId;
    if (e.type === 'orders.order.created' || e.type === 'orders.order.paid' || e.type === 'orders.order.delivered') {
      for (const k of ['buyerId', 'sellerId']) if (!str(e.payload[k])) throw new Error(`${e.type} ${e.id}: no ${k}`); // retried, then reported (K-04)
    }
    await apply(e, orderId);
  }
}
