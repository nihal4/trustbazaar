import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { DeadlineKind, ESCROW_QUERY, EscrowQuery } from '../../orders/ports';

// The deadline query the reminder job asks before sending (docs/design/06_chat_notifications.pdf section 7.6;
// FR-NTF-07; U6-06). Unit 2 imports this unit (BlockPort, ChatCommands), so its EscrowQuery is found on first use
// rather than injected, as Delivery does (adapters/orders.ts there).
export const ORDER_DEADLINES = Symbol('ORDER_DEADLINES');

export interface OrderDeadlines {
  deadline(orderId: string, kind: DeadlineKind): Promise<{ dueAt: Date; listingTitle: string | null } | null>;
}

@Injectable()
export class OrderDeadlinesFromOrders implements OrderDeadlines {
  constructor(private readonly modules: ModuleRef) {}

  deadline(orderId: string, kind: DeadlineKind): Promise<{ dueAt: Date; listingTitle: string | null } | null> {
    return this.modules.get<EscrowQuery>(ESCROW_QUERY, { strict: false }).deadline(orderId, kind);
  }
}
