import type { EntityManager } from 'typeorm';

// The public surface of Unit 2: the only files other units may import (DC-1).
// Ports this unit provides (docs/design/02_orders_payments.pdf section 3.3; docs/design/09_integration.pdf
// section 4), added by the unit's tasks:
//   OrdersPort      (U2-02, below; lockForFulfilment with U2-04, I-20)
//   EscrowCommands  (U2-04, below)
//   EscrowQuery     (U2-04, below)
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
  /** FR-PAY-09: the latest cancellation request, if any (the seller answers it by id). */
  cancellationRequest: null | { id: string; status: 'pending' | 'accepted' | 'declined' | 'lapsed'; reason: string; createdAt: string };
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
  /**
   * I-20, DC-14: locks the order row in the caller's transaction and returns what a fulfilment action needs.
   * Delivery and Game-Account call it first, then lock their own row, then call EscrowCommands. Throws
   * not-found for an unknown order.
   */
  lockForFulfilment(orderId: string, tx: EntityManager): Promise<FulfilmentFacts>;
}

export type FulfilmentStep = 'meetup_handover' | 'courier_pickup' | 'credentials_delivered';
export type DeliverySource = 'handover_code' | 'courier_delivered' | 'game_takeover';

export interface FulfilmentFacts {
  orderId: string;
  status: OrderStatus;
  itemKind: 'physical' | 'game_account';
  listingId: string;
  buyerId: string;
  sellerId: string;
  fulfilment: Fulfilment | null;
  fulfilmentStep: FulfilmentStep | null;
  fulfilmentDueAt: Date | null;
  stepRecorded: boolean;
  deliveryEventRecorded: boolean;
  escrowState: EscrowState | null;
}

/** What the Disputes unit decided (FR-DSP-06; Unit 7 section "Decision"). Money in poisha. */
export type DisputeOutcome =
  | { kind: 'release' } // (a) the seller is paid as on a normal release
  | { kind: 'full' } // (b) the item price back, and the delivery fee too if the courier never picked up
  | { kind: 'partial'; itemRefund: bigint } // (c) 0 < itemRefund < item price (FR-PAY-11)
  | { kind: 'after_return' } // (d) stays frozen until the item is back
  | { kind: 'return_completed' }; // (d) the item is back: the refund of (b)

export interface EscrowView {
  orderId: string;
  orderStatus: OrderStatus;
  state: EscrowState;
  releasePolicy: 'standard' | 'game_protection';
  amountCollected: string;
  amountReleased: string;
  amountRefunded: string;
  disputeWindowEndsAt: Date | null;
  autoReleaseAt: Date | null;
  openDisputeId: string | null;
  deliveryEventAt: Date | null;
}

/**
 * Used by Delivery, Game-Account and Disputes inside their own transactions (DC-13), after
 * OrdersPort.lockForFulfilment (DC-14). A step or event that arrives twice, or for an order in the wrong
 * state, is ignored and logged: the first recorded time stands (section 5.6).
 */
export interface EscrowCommands {
  recordFulfilmentStep(orderId: string, step: FulfilmentStep, at: Date, tx: EntityManager): Promise<void>;
  recordDeliveryEvent(orderId: string, source: DeliverySource, at: Date, tx: EntityManager): Promise<void>;
  /** FR-DLV-12: the buyer gets everything back, fee included; a courier charge is the platform's expense. */
  refundCourierReturned(orderId: string, courierCharge: bigint, tx: EntityManager): Promise<void>;
  /** I-21: a return charge for an order already refunded. */
  recordCourierCost(orderId: string, amount: bigint, tx: EntityManager): Promise<void>;
  /** FR-DSP-02: refused with dispute-not-allowed unless EscrowQuery.disputeAllowed. */
  freezeForDispute(orderId: string, disputeId: string, tx: EntityManager): Promise<void>;
  applyDisputeOutcome(orderId: string, disputeId: string, o: DisputeOutcome, tx: EntityManager): Promise<void>;
  /** FR-DSP-10: held again; automatic release at the later of its time and now + 24 hours. */
  withdrawDispute(orderId: string, disputeId: string, tx: EntityManager): Promise<void>;
}

export interface EscrowQuery {
  getEscrow(orderId: string): Promise<EscrowView>;
  /** FR-DSP-01, FR-DSP-11: held, paid, and before the end of the dispute window (if the delivery event is recorded). */
  disputeAllowed(orderId: string, at: Date): Promise<boolean>;
}

export const ESCROW_COMMANDS = Symbol('ESCROW_COMMANDS');
export const ESCROW_QUERY = Symbol('ESCROW_QUERY');

export const ORDERS_PORT = Symbol('ORDERS_PORT');
