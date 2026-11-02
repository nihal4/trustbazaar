import type { EntityManager } from 'typeorm';

// The public surface of Unit 4: the only files other units may import (DC-1).
// Ports this unit provides (docs/design/09_integration.pdf, section 2.1; docs/design/04_delivery.pdf section 3.2):
//   DeliveryPort (Unit 2), DeliveryCommands (Unit 7), DeliveryQueries (Units 6 and 7).

/**
 * Used by Unit 2 (docs/design/04_delivery.pdf section 3.2; I-21). claimQuote runs in Unit 2's order transaction
 * (DC-13): it checks buyer, listing, quantity, expiry and one use, and returns the fee in poisha. A refusal is the
 * problem `delivery-refused` (422) with the reason `quote_mismatch`, `quote_used` or `quote_expired`.
 */
export interface DeliveryPort {
  claimQuote(q: { quoteId: string; orderId: string; buyerId: string; listingId: string; quantity: number }, tx: EntityManager): Promise<bigint>;
  /**
   * Whether a paid courier order can be shipped: true since U4-04 creates and books shipments (Decisions log, U4-02
   * and U4-04), so checkout and the fulfilment choice accept courier with a claimed quote.
   */
  readonly shipsCourier: boolean;
  /**
   * I-22, FR-DLV-11: before Unit 2 refunds a courier order for a missed pickup, outside its lock. Asks the courier
   * (DV-32: at most 10 seconds) and applies the answer, so a pickup made in time but reported late is counted. Never
   * throws: if the courier cannot be asked, the refund goes ahead.
   */
  syncPickup(orderId: string): Promise<void>;
}
export const DELIVERY_PORT = Symbol('DELIVERY_PORT');

/** A return quote (FR-DSP-06(d)): from the buyer's drop-off area to the seller's pickup area, priced like checkout. */
export interface ReturnQuote {
  id: string;
  orderId: string;
  fromAreaId: number;
  toAreaId: number;
  billedKg: number;
  fee: string;
  fareVersion: number;
  expiresAt: string;
}

/** Used by Unit 7 (section 3.2). */
export interface DeliveryCommands {
  /**
   * FR-DSP-06(d), courier orders only (Decisions log, U4-04): the areas must be the forward shipment's, swapped
   * (from its drop-off area to its pickup area). validation-failed otherwise.
   */
  quoteReturn(orderId: string, fromAreaId: number, toAreaId: number): Promise<ReturnQuote>;
  /**
   * Claims the return quote and creates the return shipment in the caller's transaction (DC-13); the booking job books
   * it. The addresses are the forward shipment's, swapped. Who pays is recorded by Unit 7's decision. Returns the
   * shipment id.
   */
  bookReturn(orderId: string, quoteId: string, payer: 'buyer' | 'seller', tx: EntityManager): Promise<string>;
  /** After a lock (CP-45): a new code version, the count reset; audited with the reason. */
  unlockHandoverCode(orderId: string, staffId: string, reason: string): Promise<void>;
  /** Section 7.11: resolves an open issue with a reason of at least 10 characters; audited. */
  resolveIssue(issueId: string, staffId: string, resolution: string): Promise<void>;
}
export const DELIVERY_COMMANDS = Symbol('DELIVERY_COMMANDS');

export type IssueKind = 'booking_failed' | 'pickup_after_cancel' | 'status_refused' | 'code_locked' | 'return_failed';

export interface DeliveryIssue {
  id: string;
  orderId: string;
  kind: IssueKind;
  detail: Record<string, unknown>;
  status: 'open' | 'resolved';
  createdAt: string;
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolution: string | null;
}

export interface Page<T> { items: T[]; nextCursor: string | null }

/** An address as staff see it: the area in clear, the lines masked unless a reason was given (SEC-ACC-05). */
export interface RecordAddress {
  area: { id: number; district: string; nameEn: string } | null;
  line1: string | null;
  line2: string | null;
  landmark: string | null;
  contactName: string | null;
  masked: boolean;
  erased: boolean;
}

/** FR-DSP-05: everything Unit 4 knows about how an order changed hands. Never the handover code. */
export interface FulfilmentRecord {
  orderId: string;
  handover: null | {
    status: string; dueAt: string; codeVersion: number; wrongEntries: number;
    lockedAt: string | null; completedAt: string | null; cancelledAt: string | null;
    proposals: { id: string; proposedBy: string; point: string | null; place: string | null; meetAt: string; status: string; createdAt: string; respondedAt: string | null }[];
    codeEntries: { codeVersion: number; correct: boolean; at: string }[];
  };
  shipments: {
    id: string; direction: 'forward' | 'return'; provider: string; simulated: boolean; consignmentId: string | null; status: string; fee: string;
    pickupDueAt: string | null; bookedAt: string | null; pickedUpAt: string | null; deliveredAt: string | null; returnedAt: string | null;
    cancelledAt: string | null; orderCancelledAt: string | null; failedAttempts: number; returnCharge: string | null; bookingAttempts: number;
    pickup: RecordAddress; dropoff: RecordAddress;
    history: { from: string | null; to: string; source: string; eventId: string | null; at: string }[];
  }[];
  issues: DeliveryIssue[];
}

/** Used by Units 6 and 7 (section 3.2). */
export interface DeliveryQueries {
  /** FR-DSP-05: addresses masked; Unit 7's case file. */
  fulfilmentRecord(orderId: string): Promise<FulfilmentRecord>;
  /** FR-DLV-11, FR-DSP-01: CP-17 has passed since the courier's pickup without delivery. */
  notReceivedAllowed(orderId: string): Promise<boolean>;
  /** The operator queue, oldest first (section 7.11). */
  openIssues(cursor?: string): Promise<Page<DeliveryIssue>>;
}
export const DELIVERY_QUERIES = Symbol('DELIVERY_QUERIES');
