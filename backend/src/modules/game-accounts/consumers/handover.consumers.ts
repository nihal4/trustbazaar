import { Injectable, OnModuleInit } from '@nestjs/common';
import { EventBus } from '../../../kernel/events/event-bus';
import { HandoverService } from '../services/handover.service';

// Unit 2's events for the handover (docs/design/05_game_accounts.pdf section 3.3): a paid game-account order asks the
// seller for the credentials (FR-GAM-10); an order cancelled before payment cancels its handover. Both are idempotent.
@Injectable()
export class HandoverConsumers implements OnModuleInit {
  constructor(
    private readonly bus: EventBus,
    private readonly handovers: HandoverService,
  ) {}

  onModuleInit(): void {
    this.bus.on('orders.order.paid', 'game_accounts.handover', async (e) => void (await this.handovers.onPaid(e)));
    this.bus.on('orders.order.cancelled', 'game_accounts.handover', async (e) => void (await this.handovers.onCancelled(e)));
  }
}
