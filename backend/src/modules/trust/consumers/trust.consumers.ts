import { Injectable, OnModuleInit } from '@nestjs/common';
import { EventBus, OutboxEvent } from '../../../kernel/events/event-bus';
import { DisputeCaseService } from '../services/dispute-case.service';
import { RatingService } from '../services/rating.service';
import { SanctionService } from '../services/sanction.service';
import { SignalService } from '../services/signal.service';

// Unit 7's consumers of U7-04 (docs/design/07_disputes_trust_staff.pdf section 3.3), each idempotent:
//  - seller strikes (FR-TNS-04), keyed by order and reason: a unilateral cancellation after payment, and a refund at
//    a missed fulfilment deadline (Unit 2's refund event with reason fulfilment_deadline, I-44). A lost dispute is
//    the third, recorded by the decision itself (U7-03).
//  - identity.account.reinstated: the four-eyes reinstatement lifts the live account suspensions (CP-30).
//  - rating eligibility (FR-REV-01; U7-05), keyed by the order: a terminal escrow event makes the order rateable.
//  - signals for the flagged-activity queue (U7-08), keyed by their source (SignalService).
//  - disputes (U7-03): a decision's aftermath once committed (the chat hold released, the parties told), and the
//    returned item of outcome (d) (return_completed refuses a dispute no longer awaiting it).

const str = (v: unknown) => (typeof v === 'string' ? v : '');

@Injectable()
export class TrustConsumers implements OnModuleInit {
  constructor(
    private readonly bus: EventBus,
    private readonly sanctions: SanctionService,
    private readonly ratings: RatingService,
    private readonly signals: SignalService,
    private readonly cases: DisputeCaseService,
  ) {}

  onModuleInit(): void {
    this.bus.on('orders.order.cancelled_by_seller', 'trust.strikes', (e) => this.strike(e, 'unilateral_cancel'));
    this.bus.on('orders.escrow.refunded', 'trust.strikes', async (e) => {
      if (e.payload.reason === 'fulfilment_deadline') await this.strike(e, 'missed_deadline');
    });
    for (const type of ['orders.escrow.released', 'orders.escrow.refunded', 'orders.escrow.partially_refunded']) {
      this.bus.on(type, 'trust.ratings', async (e) => void (await this.ratings.onEscrowClosed(e)));
    }
    for (const type of ['auctions.flag.raised', 'listings.listing.relisting_flagged', 'delivery.issue.opened', 'chat.message.flagged']) {
      this.bus.on(type, 'trust.signals', async (e) => void (await this.signals.onEvent(e)));
    }
    this.bus.on('disputes.dispute.decided', 'trust.disputes', (e) => this.cases.onDecided(e));
    this.bus.on('delivery.return.delivered', 'trust.disputes', async (e) => void (await this.cases.onReturnDelivered(e)));
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
