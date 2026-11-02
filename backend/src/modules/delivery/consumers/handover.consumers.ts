import { Injectable, OnModuleInit } from '@nestjs/common';
import { EventBus, OutboxEvent } from '../../../kernel/events/event-bus';
import { HandoverService } from '../services/handover.service';

// Unit 2's events for the meetup handover (docs/design/04_delivery.pdf sections 3.4, 6.1 and 6.5; I-19; U4-03). Each is
// idempotent: a redelivered event changes nothing (DC-6).
@Injectable()
export class HandoverConsumers implements OnModuleInit {
  constructor(
    private readonly bus: EventBus,
    private readonly handovers: HandoverService,
  ) {}

  onModuleInit(): void {
    this.bus.on('orders.order.paid', 'delivery.handover', (e) => this.onPaid(e));
    this.bus.on('orders.escrow.refunded', 'delivery.handover', (e) => this.handovers.cancel(String(e.payload.orderId ?? e.aggregateId)));
  }

  /** A self-pickup order is paid: its handover starts, due at the order's fulfilment deadline (CP-15). */
  private async onPaid(e: OutboxEvent): Promise<void> {
    const p = e.payload as { orderId?: string; fulfilment?: string | null; itemKind?: string; buyerId?: string; sellerId?: string; fulfilmentDueAt?: string };
    if (p.fulfilment !== 'self_pickup' || p.itemKind !== 'physical' || !p.buyerId || !p.sellerId || !p.fulfilmentDueAt) return;
    await this.handovers.open({ orderId: p.orderId ?? e.aggregateId, buyerId: p.buyerId, sellerId: p.sellerId, dueAt: p.fulfilmentDueAt });
  }
}
