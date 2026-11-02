import type { EntityManager } from 'typeorm';

// The public surface of Unit 4: the only files other units may import (DC-1).
// Ports this unit provides (docs/design/09_integration.pdf, section 2.1), added by the unit's tasks:
//   DeliveryPort (U4-02: claimQuote, shipsCourier; U4-04: syncPickup)
//   DeliveryCommands
//   DeliveryQueries

/**
 * Used by Unit 2 (docs/design/04_delivery.pdf section 3.2; I-21). claimQuote runs in Unit 2's order transaction
 * (DC-13): it checks buyer, listing, quantity, expiry and one use, and returns the fee in poisha. A refusal is the
 * problem `delivery-refused` (422) with the reason `quote_mismatch`, `quote_used` or `quote_expired`.
 */
export interface DeliveryPort {
  claimQuote(q: { quoteId: string; orderId: string; buyerId: string; listingId: string; quantity: number }, tx: EntityManager): Promise<bigint>;
  /**
   * Whether a paid courier order can be shipped: false until U4-04 creates and books shipments, so checkout keeps
   * refusing courier until then (Decisions log, U4-02).
   */
  readonly shipsCourier: boolean;
}
export const DELIVERY_PORT = Symbol('DELIVERY_PORT');
