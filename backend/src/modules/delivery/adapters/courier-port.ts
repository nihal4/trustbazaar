import type { ShipmentStatus } from '../db/enums';

// CourierPort (docs/design/04_delivery.pdf section 3.3; IF-SW-04; U4-04). One adapter per provider, chosen by
// COURIER_MODE: the mock is the default (C-3). Pathao and Steadfast sandbox adapters come when access is granted;
// until then COURIER_MODE=sandbox is refused at start (Decisions log, U4-04).

export const COURIER = Symbol('COURIER');

export type SizeClass = 'small' | 'medium' | 'large';

/** What the courier needs to collect and deliver: the address lines, the area and the contact's verified mobile. */
export interface CourierAddress {
  line1: string;
  line2?: string;
  landmark?: string;
  contactName: string;
  phone: string;
  district: string;
  area: string;
}

export interface CourierStatusReport {
  status: ShipmentStatus;
  occurredAt: Date;
  /** the provider's id of this event: a repeated id has no effect (delivery.provider_events) */
  eventId: string;
  /** poisha; on a return to the seller only */
  returnCharge?: bigint;
}

export interface CourierWebhookEvent extends CourierStatusReport {
  consignmentId: string;
}

export interface CourierPort {
  readonly provider: 'mock' | 'pathao' | 'steadfast';
  /** FR-DLV-14: every mock shipment is labelled simulated */
  readonly simulated: boolean;
  /** SEC-PAY-07: the shipment id is the merchant reference, so a repeated booking returns the same consignment. */
  book(p: {
    shipmentId: string;
    pickup: CourierAddress;
    dropoff: CourierAddress;
    parcel: { billedKg: number; sizeClass: SizeClass };
    /** FR-DLV-05: the item is already paid for; never anything else */
    cashToCollect: 0;
  }): Promise<{ consignmentId: string }>;
  cancel(consignmentId: string): Promise<'cancelled' | 'already_picked_up'>;
  requestReturn(consignmentId: string): Promise<void>;
  status(consignmentId: string): Promise<CourierStatusReport>;
  /**
   * SEC-PAY-03, SEC-PAY-04: throws CourierSignatureError unless the body is signed with this environment's secret
   * and its time is within the tolerance (CP-32).
   */
  verifyWebhook(headers: Record<string, string | string[] | undefined>, rawBody: Buffer, now: Date, toleranceSeconds: number): CourierWebhookEvent;
}

export class CourierSignatureError extends Error {
  constructor(reason: string) {
    super(`courier webhook refused: ${reason}`);
    this.name = 'CourierSignatureError';
  }
}

/** The provider could not be reached or refused the call; the caller retries (booking) or the event is redelivered. */
export class CourierUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CourierUnavailableError';
  }
}
