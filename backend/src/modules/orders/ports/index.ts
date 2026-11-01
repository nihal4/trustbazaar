import type { EntityManager } from 'typeorm';

// The public surface of Unit 2: the only files other units may import (DC-1).
// Ports this unit provides (docs/design/02_orders_payments.pdf section 3.3; docs/design/09_integration.pdf
// section 4), added by the unit's tasks:
//   OrdersPort      (U2-02, below; lockForFulfilment with U2-04, I-20)
//   EscrowCommands  (U2-04)
//   EscrowQuery     (U2-04)
//   ProStatusQuery  (U2-06)

export type OrderKind = 'fixed_price' | 'auction' | 'second_chance';
export type OrderStatus = 'awaiting_payment' | 'cancelled' | 'paid' | 'closed';
export type Fulfilment = 'self_pickup' | 'courier' | 'game_account';
export type EscrowState = 'held' | 'frozen_disputed' | 'released' | 'refunded' | 'partially_refunded';

/**
 * An order as a party sees it (IF-UI-05; I-52: every field the web client's describeMoney reads). Money is
 * integer poisha as a decimal string. escrow is null until the payment is confirmed.
 */
export interface OrderView {
  id: string;
  kind: OrderKind;
  role: 'buyer' | 'seller';
  status: OrderStatus;
  listing: { id: string; title: string; itemKind: 'physical' | 'game_account'; photoKey: string | null };
  buyerId: string;
  sellerId: string;
  quantity: number;
  unitPrice: string;
  itemPrice: string;
  deliveryFee: string;
  total: string;
  fulfilment: Fulfilment | null;
  /** The listing's options at checkout, for choosing the method (PUT /orders/{id}/fulfilment). */
  fulfilmentOptions: Fulfilment[];
  paymentDueAt: string;
  paidAt: string | null;
  fulfilmentStep: string | null;
  fulfilmentDueAt: string | null;
  deliveryEventAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  closedAt: string | null;
  createdAt: string;
  escrow: null | {
    state: EscrowState;
    releasePolicy: 'standard' | 'game_protection';
    amountCollected: string;
    amountRefunded: string;
    disputeWindowEndsAt: string | null;
    autoReleaseAt: string | null;
  };
}

export interface OrdersPort {
  /**
   * FR-AUC-14, FR-AUC-15: the winner's order, with the payment window CP-10 (auction) or CP-11
   * (second chance). Pass the closing transaction (DC-13) so the award and the order commit together.
   */
  createAuctionOrder(a: { listingId: string; winnerId: string; price: bigint; kind: 'auction' | 'second_chance' }, tx?: EntityManager): Promise<OrderView>;
  /** Throws not-found unless the user is the buyer or the seller (SEC-SDL-09). */
  getOrderForParty(orderId: string, userId: string): Promise<OrderView>;
}

export const ORDERS_PORT = Symbol('ORDERS_PORT');
