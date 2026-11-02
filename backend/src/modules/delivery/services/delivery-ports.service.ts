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

  claimQuote(q: { quoteId: string; orderId: string; buyerId: string; listingId: string; quantity: number }, tx: EntityManager): Promise<bigint> {
    return this.quotes.claimQuote(q, tx);
  }

  syncPickup(orderId: string): Promise<void> {
    return this.shipments.syncPickup(orderId);
  }

  quoteReturn(orderId: string, fromAreaId: number, toAreaId: number): Promise<ReturnQuote> {
    return this.shipments.quoteReturn(orderId, fromAreaId, toAreaId);
  }

  bookReturn(orderId: string, quoteId: string, payer: 'buyer' | 'seller', tx: EntityManager): Promise<string> {
    return this.shipments.bookReturn(orderId, quoteId, payer, tx);
  }

  unlockHandoverCode(orderId: string, staffId: string, reason: string): Promise<void> {
    return this.handovers.unlockHandoverCode(orderId, staffId, reason);
  }

  resolveIssue(issueId: string, staffId: string, resolution: string): Promise<void> {
    return this.records.resolveIssue(issueId, staffId, resolution);
  }

  fulfilmentRecord(orderId: string): Promise<FulfilmentRecord> {
    return this.records.fulfilmentRecord(orderId);
  }

  notReceivedAllowed(orderId: string): Promise<boolean> {
    return this.records.notReceivedAllowed(orderId);
  }

  openIssues(cursor?: string): Promise<Page<DeliveryIssue>> {
    return this.records.openIssues(cursor);
  }
}
