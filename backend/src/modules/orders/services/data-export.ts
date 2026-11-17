import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { collectRows, DataExportSource } from '../../../kernel/privacy/data-export';

// Unit 2's part of the data export (FR-PRV-03; U7-11): orders as buyer or seller, cancellation requests, payments,
// refunds, settlements and payouts as seller, payout accounts (the account number only by its last four digits),
// the Pro Seller subscription and featured-listing purchases. Idempotency keys and staff ids are left out.
const Q = {
  orders: `SELECT to_jsonb(o) AS r FROM orders.orders o WHERE buyer_id = $1 OR seller_id = $1 ORDER BY created_at, id`,
  cancellationRequests: `SELECT to_jsonb(c) AS r FROM orders.cancellation_requests c WHERE requested_by = $1 ORDER BY created_at, id`,
  payments: `SELECT to_jsonb(a) - '{idempotency_key,payer_id}'::text[] AS r FROM payments.attempts a WHERE payer_id = $1 ORDER BY created_at, id`,
  refunds: `SELECT to_jsonb(f) - 'idempotency_key' AS r FROM payments.refunds f JOIN payments.attempts a ON a.id = f.attempt_id
             WHERE a.payer_id = $1 ORDER BY f.created_at, f.id`,
  settlements: `SELECT to_jsonb(s) AS r FROM payments.settlements s JOIN orders.orders o ON o.id = s.order_id WHERE o.seller_id = $1 ORDER BY s.created_at`,
  payouts: `SELECT to_jsonb(p) - '{idempotency_key,seller_id}'::text[] AS r FROM payments.payouts p WHERE seller_id = $1 ORDER BY created_at, id`,
  payoutAccounts: `SELECT to_jsonb(a) - '{account_number_enc,reviewed_by,user_id}'::text[] AS r FROM payments.payout_accounts a WHERE user_id = $1 ORDER BY created_at, id`,
  subscriptions: `SELECT to_jsonb(s) - 'user_id' AS r FROM payments.subscriptions s WHERE user_id = $1 ORDER BY created_at, id`,
  featuredPurchases: `SELECT to_jsonb(f) - 'seller_id' AS r FROM payments.featured_purchases f WHERE seller_id = $1 ORDER BY created_at, id`,
};

@Injectable()
export class OrdersDataExport implements DataExportSource {
  readonly section = 'orders';
  constructor(private readonly db: DataSource) {}
  exportFor(userId: string) {
    return collectRows(this.db, Q, userId);
  }
}
