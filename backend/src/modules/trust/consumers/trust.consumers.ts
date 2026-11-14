import { Injectable, OnModuleInit } from '@nestjs/common';
import { EventBus, OutboxEvent } from '../../../kernel/events/event-bus';
import { SanctionService } from '../services/sanction.service';

// Unit 7's consumers of U7-04 (docs/design/07_disputes_trust_staff.pdf section 3.3), each idempotent:
//  - seller strikes (FR-TNS-04), keyed by order and reason: a unilateral cancellation after payment, and a refund at
//    a missed fulfilment deadline (Unit 2's refund event with reason fulfilment_deadline, I-44). A lost dispute is
//    the third, recorded by the decision itself (U7-03).
//  - identity.account.reinstated: the four-eyes reinstatement lifts the live account suspensions (CP-30).

const str = (v: unknown) => (typeof v === 'string' ? v : '');

@Injectable()
export class TrustConsumers implements OnModuleInit {
  constructor(
    private readonly bus: EventBus,
    private readonly sanctions: SanctionService,
  ) {}

  onModuleInit(): void {
    this.bus.on('orders.order.cancelled_by_seller', 'trust.strikes', (e) => this.strike(e, 'unilateral_cancel'));
    this.bus.on('orders.escrow.refunded', 'trust.strikes', async (e) => {
      if (e.payload.reason === 'fulfilment_deadline') await this.strike(e, 'missed_deadline');
    });
    this.bus.on('identity.account.reinstated', 'trust.sanctions', async (e) => {
      await this.sanctions.onReinstated({
        userId: str(e.payload.userId) || e.aggregateId, approvalId: str(e.payload.approvalId), decidedBy: str(e.payload.decidedBy) || null, reason: str(e.payload.reason) || null,
      });
    });
  }

  private async strike(e: OutboxEvent, reason: 'unilateral_cancel' | 'missed_deadline'): Promise<void> {
    const sellerId = str(e.payload.sellerId);
    if (!sellerId) throw new Error(`${e.type} ${e.id}: no sellerId`); // retried, then reported (K-04)
    await this.sanctions.strike(sellerId, reason, str(e.payload.orderId) || e.aggregateId);
  }
}
