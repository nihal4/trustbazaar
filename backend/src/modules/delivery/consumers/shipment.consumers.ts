import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { EventBus, OutboxEvent } from '../../../kernel/events/event-bus';
import { ShipmentService } from '../services/shipment.service';

// Events for courier shipments and saved addresses (docs/design/04_delivery.pdf section 3.4; I-19; U4-04). Each is
// idempotent: a redelivered event changes nothing (DC-6).
@Injectable()
export class ShipmentConsumers implements OnModuleInit {
  constructor(
    private readonly bus: EventBus,
    private readonly shipments: ShipmentService,
    private readonly db: DataSource,
  ) {}

  onModuleInit(): void {
    this.bus.on('orders.order.paid', 'delivery.shipment', (e) => this.onPaid(e));
    this.bus.on('orders.escrow.refunded', 'delivery.shipment', (e) => this.shipments.cancelForRefund(String(e.payload.orderId ?? e.aggregateId)));
    this.bus.on('identity.account.closed', 'delivery.addresses', (e) => this.onClosed(e));
  }

  /** A paid courier order: its forward shipment, then the first booking (section 7.2). */
  private async onPaid(e: OutboxEvent): Promise<void> {
    const p = e.payload as { orderId?: string; fulfilment?: string | null; itemKind?: string; sellerId?: string; fulfilmentDueAt?: string; deliveryQuoteId?: string | null };
    if (p.fulfilment !== 'courier' || p.itemKind !== 'physical' || !p.sellerId || !p.fulfilmentDueAt || !p.deliveryQuoteId) return;
    await this.shipments.createForward({ orderId: p.orderId ?? e.aggregateId, sellerId: p.sellerId, quoteId: p.deliveryQuoteId, pickupDueAt: p.fulfilmentDueAt });
  }

  /** Saved addresses are only for future orders: erased when the account closes. Shipment copies follow DV-30. */
  private async onClosed(e: OutboxEvent): Promise<void> {
    const userId = (e.payload as { userId?: string }).userId ?? e.aggregateId;
    await this.db.query(`UPDATE delivery.saved_addresses SET deleted_at = now(), address_enc = NULL WHERE user_id = $1 AND deleted_at IS NULL`, [userId]);
  }
}
