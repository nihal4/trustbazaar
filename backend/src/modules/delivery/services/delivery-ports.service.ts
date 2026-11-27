import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { DeliveryCommands, DeliveryIssue, DeliveryPort, DeliveryQueries, FulfilmentRecord, Page, ReturnQuote } from '../ports';
import { HandoverService } from './handover.service';
import { QuoteService } from './quote.service';
import { RecordsService } from './records.service';
import { ShipmentService } from './shipment.service';

// The unit's ports (docs/design/04_delivery.pdf section 3.2), each method answered by the service that owns it.
@Injectable()
export class DeliveryPorts implements DeliveryPort, DeliveryCommands, DeliveryQueries {
  /** U4-04: shipments are created and booked, so courier checkout is on (Decisions log, U4-02 and U4-04). */
  readonly shipsCourier = true;

  constructor(
    private readonly quotes: QuoteService,
    private readonly shipments: ShipmentService,
    private readonly handovers: HandoverService,
    private readonly records: RecordsService,
  ) {}

  /** Claims the buyer's binding courier quote for an order, in the order's transaction; returns its charge. */
  claimQuote(q: { quoteId: string; orderId: string; buyerId: string; listingId: string; quantity: number }, tx: EntityManager): Promise<bigint> {
    return this.quotes.claimQuote(q, tx);
  }

  /** Brings the order's shipment up to date with the courier's pickup status. */
  syncPickup(orderId: string): Promise<void> {
    return this.shipments.syncPickup(orderId);
  }

  /** Quotes sending the order's parcel back between two delivery areas. */
  quoteReturn(orderId: string, fromAreaId: number, toAreaId: number): Promise<ReturnQuote> {
    return this.shipments.quoteReturn(orderId, fromAreaId, toAreaId);
  }

  /** Books the return of the parcel on a quote, paid by the buyer or the seller, in the caller's transaction; returns the consignment. */
  bookReturn(orderId: string, quoteId: string, payer: 'buyer' | 'seller', tx: EntityManager): Promise<string> {
    return this.shipments.bookReturn(orderId, quoteId, payer, tx);
  }

  /** Deletes the order's handover photos and returns the names of the files removed. */
  purgeHandoverPhotos(orderId: string): Promise<string[]> {
    return this.handovers.purgePhotos(orderId);
  }

  /** Unlocks a locked handover code on a staff member's decision, with the reason. */
  unlockHandoverCode(orderId: string, staffId: string, reason: string): Promise<void> {
    return this.handovers.unlockHandoverCode(orderId, staffId, reason);
  }

  /** Resolves a delivery issue with the staff member's resolution. */
  resolveIssue(issueId: string, staffId: string, resolution: string): Promise<void> {
    return this.records.resolveIssue(issueId, staffId, resolution);
  }

  /** What the delivery side recorded of how the order was fulfilled. */
  fulfilmentRecord(orderId: string): Promise<FulfilmentRecord> {
    return this.records.fulfilmentRecord(orderId);
  }

  /** Whether the buyer may still say that the item did not arrive. */
  notReceivedAllowed(orderId: string): Promise<boolean> {
    return this.records.notReceivedAllowed(orderId);
  }

  /** The open delivery issues, a page at a time (cursor). */
  openIssues(cursor?: string): Promise<Page<DeliveryIssue>> {
    return this.records.openIssues(cursor);
  }
}
