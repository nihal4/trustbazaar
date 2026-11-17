import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { collectRows, DataExportSource } from '../../../kernel/privacy/data-export';
import { AddressService } from './address.service';

// Unit 4's part of the data export (FR-PRV-03; U7-11): saved addresses (decrypted, as the user sees them), delivery
// quotes, shipments and handovers of the user's orders, and the user's meet-up proposals. A shipment's sealed
// addresses are left out (the saved addresses hold them), as are handover codes.
const Q = {
  quotes: `SELECT to_jsonb(q) - 'buyer_id' AS r FROM delivery.quotes q WHERE buyer_id = $1 ORDER BY created_at, id`,
  shipments: `SELECT to_jsonb(s) - '{pickup_address_enc,dropoff_address_enc,last_event_id}'::text[] AS r
                FROM delivery.shipments s JOIN orders.orders o ON o.id = s.order_id WHERE o.buyer_id = $1 OR o.seller_id = $1 ORDER BY s.created_at, s.id`,
  handovers: `SELECT to_jsonb(h) - 'code_version' AS r FROM delivery.handovers h WHERE buyer_id = $1 OR seller_id = $1 ORDER BY created_at`,
  meetupProposals: `SELECT to_jsonb(p) AS r FROM delivery.meetup_proposals p WHERE proposed_by = $1 ORDER BY created_at, id`,
};

@Injectable()
export class DeliveryDataExport implements DataExportSource {
  readonly section = 'delivery';
  constructor(
    private readonly db: DataSource,
    private readonly addresses: AddressService,
  ) {}
  async exportFor(userId: string) {
    return { savedAddresses: (await this.addresses.list(userId)).items, ...(await collectRows(this.db, Q, userId)) };
  }
}
