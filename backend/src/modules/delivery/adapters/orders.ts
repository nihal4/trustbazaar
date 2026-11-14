import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { EntityManager } from 'typeorm';
import { ESCROW_COMMANDS, ESCROW_QUERY, EscrowCommands, EscrowQuery, FulfilmentFacts, ORDERS_PORT, OrdersPort, type EscrowView, type OrderView } from '../../orders/ports';

// Unit 2's OrdersPort.lockForFulfilment and EscrowCommands for the handover (DC-14; I-20; U4-03). Unit 2 imports this
// unit (DeliveryPort.claimQuote in its checkout), so this unit cannot import Unit 2's module: the provider below finds
// Unit 2's ports on first use, as Unit 3 does for its auction orders (Decisions log, U3-05 and U4-02).
export const FULFILMENT_ORDERS = Symbol('FULFILMENT_ORDERS');

export interface FulfilmentOrders {
  lockForFulfilment(orderId: string, tx: EntityManager): Promise<FulfilmentFacts>;
  recordFulfilmentStep: EscrowCommands['recordFulfilmentStep'];
  recordDeliveryEvent: EscrowCommands['recordDeliveryEvent'];
  /** U4-04: a courier return (FR-DLV-12) and a return charge on an order already refunded (I-21) */
  refundCourierReturned: EscrowCommands['refundCourierReturned'];
  recordCourierCost: EscrowCommands['recordCourierCost'];
  /** U4-04: the shipments view checks the caller is the order's buyer or seller (not-found otherwise) */
  getOrderForParty(orderId: string, userId: string): Promise<OrderView>;
  /** U4-05: the order's status, close time and open dispute, for address erasure (DV-30) */
  getEscrow(orderId: string): Promise<EscrowView>;
}

@Injectable()
export class ForwardedFulfilmentOrders implements FulfilmentOrders {
  constructor(private readonly modules: ModuleRef) {}

  lockForFulfilment(orderId: string, tx: EntityManager): Promise<FulfilmentFacts> {
    return this.modules.get<OrdersPort>(ORDERS_PORT, { strict: false }).lockForFulfilment(orderId, tx);
  }

  recordFulfilmentStep(...a: Parameters<EscrowCommands['recordFulfilmentStep']>): Promise<void> {
    return this.modules.get<EscrowCommands>(ESCROW_COMMANDS, { strict: false }).recordFulfilmentStep(...a);
  }

  recordDeliveryEvent(...a: Parameters<EscrowCommands['recordDeliveryEvent']>): Promise<void> {
    return this.modules.get<EscrowCommands>(ESCROW_COMMANDS, { strict: false }).recordDeliveryEvent(...a);
  }

  refundCourierReturned(...a: Parameters<EscrowCommands['refundCourierReturned']>): Promise<void> {
    return this.modules.get<EscrowCommands>(ESCROW_COMMANDS, { strict: false }).refundCourierReturned(...a);
  }

  recordCourierCost(...a: Parameters<EscrowCommands['recordCourierCost']>): Promise<void> {
    return this.modules.get<EscrowCommands>(ESCROW_COMMANDS, { strict: false }).recordCourierCost(...a);
  }

  getOrderForParty(orderId: string, userId: string): Promise<OrderView> {
    return this.modules.get<OrdersPort>(ORDERS_PORT, { strict: false }).getOrderForParty(orderId, userId);
  }

  getEscrow(orderId: string): Promise<EscrowView> {
    return this.modules.get<EscrowQuery>(ESCROW_QUERY, { strict: false }).getEscrow(orderId);
  }
}
