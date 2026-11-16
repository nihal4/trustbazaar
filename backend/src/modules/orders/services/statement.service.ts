import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { cursorAt, decodeCursor, encodeCursor } from '../../../kernel/http/cursor';
import { Problem } from '../../../kernel/http/problems';
import { LedgerService } from './ledger.service';

// Receipts and statements (docs/design/02_orders_payments.pdf section 3.1; FR-PAY-13, FR-PAY-21, IF-UI-08), read
// from the records the escrow settlement wrote: the payment attempts, refunds, the settlement record and payouts.
//  - GET /orders/{id}/receipt, party to the order (anyone else: not-found, SEC-SDL-09). The buyer gets a receipt
//    of every payment and refund; the seller gets the statement of the settlement and of its payout. The buyer is
//    not shown the commission or the courier's share, the seller not the buyer's payment details.
//  - GET /me/statements: the seller's settlements, newest first, 50 a page, each with its payout, and what the
//    platform still owes the seller on the ledger (seller_payable).

const PAID = ['succeeded', 'succeeded_duplicate', 'succeeded_rejected'];

export interface SettlementView {
  orderId: string;
  title: string | null;
  settledAt: string;
  amountCollected: string;
  itemPrice: string;
  deliveryFee: string;
  commission: string;
  commissionBps: number;
  courierPayout: string;
  deliveryMargin: string;
  deliveryMarginBps: number;
  sellerPayout: string;
  refundTotal: string;
}

export interface PayoutLine {
  id: string;
  amount: string;
  status: string;
  simulated: boolean;
  createdAt: string;
  sentAt: string | null;
}

type SettlementRow = {
  order_id: string; title: string | null; created_at: Date; amount_collected: string; item_price: string; delivery_fee: string; commission: string;
  commission_bps: number; courier_payout: string; delivery_margin: string; delivery_margin_bps: number; seller_payout: string; refund_total: string;
};

const SETTLEMENT_COLUMNS = `s.order_id, o.listing_snapshot->>'title' AS title, s.created_at, s.amount_collected::text, s.item_price::text, s.delivery_fee::text,
  s.commission::text, s.commission_bps, s.courier_payout::text, s.delivery_margin::text, s.delivery_margin_bps, s.seller_payout::text, s.refund_total::text`;

const settlementView = (r: SettlementRow): SettlementView => ({
  orderId: r.order_id, title: r.title, settledAt: r.created_at.toISOString(), amountCollected: r.amount_collected, itemPrice: r.item_price, deliveryFee: r.delivery_fee,
  commission: r.commission, commissionBps: r.commission_bps, courierPayout: r.courier_payout, deliveryMargin: r.delivery_margin, deliveryMarginBps: r.delivery_margin_bps,
  sellerPayout: r.seller_payout, refundTotal: r.refund_total,
});

type PayoutRow = { id: string; order_id: string; amount: string; status: string; simulated: boolean; created_at: Date; sent_at: Date | null };
const payoutView = (p: PayoutRow): PayoutLine => ({
  id: p.id, amount: p.amount, status: p.status, simulated: p.simulated, createdAt: p.created_at.toISOString(), sentAt: p.sent_at?.toISOString() ?? null,
});

@Injectable()
export class StatementService {
  constructor(
    private readonly db: DataSource,
    private readonly ledger: LedgerService,
  ) {}

  /** GET /orders/{id}/receipt (FR-PAY-21). */
  async receipt(orderId: string, userId: string) {
    const [o] = (await this.db.query(
      `SELECT id, buyer_id, seller_id, kind, listing_snapshot->>'title' AS title, quantity, unit_price::text, item_price::text, delivery_fee::text, total::text,
              status, created_at, paid_at, closed_at, cancelled_at
         FROM orders.orders WHERE id = $1`,
      [orderId],
    )) as {
      id: string; buyer_id: string; seller_id: string; kind: string; title: string | null; quantity: number; unit_price: string; item_price: string;
      delivery_fee: string; total: string; status: string; created_at: Date; paid_at: Date | null; closed_at: Date | null; cancelled_at: Date | null;
    }[];
    if (!o || (o.buyer_id !== userId && o.seller_id !== userId)) throw new Problem('not-found');
    const order = {
      id: o.id, kind: o.kind, title: o.title, quantity: o.quantity, unitPrice: o.unit_price, itemPrice: o.item_price, deliveryFee: o.delivery_fee, total: o.total,
      status: o.status, createdAt: o.created_at.toISOString(), paidAt: o.paid_at?.toISOString() ?? null, closedAt: o.closed_at?.toISOString() ?? null,
      cancelledAt: o.cancelled_at?.toISOString() ?? null,
    };
    const [s] = (await this.db.query(
      `SELECT ${SETTLEMENT_COLUMNS} FROM payments.settlements s JOIN orders.orders o ON o.id = s.order_id WHERE s.order_id = $1`,
      [orderId],
    )) as SettlementRow[];

    if (o.buyer_id === userId) {
      const payments = (await this.db.query(
        `SELECT id, provider, amount::text, status, confirmed_at FROM payments.attempts
          WHERE order_id = $1 AND status = ANY($2::payments.attempt_status[]) ORDER BY confirmed_at, id`,
        [orderId, PAID],
      )) as { id: string; provider: string; amount: string; status: string; confirmed_at: Date }[];
      const refunds = (await this.db.query(
        `SELECT id, attempt_id, amount::text, reason, status, created_at, completed_at FROM payments.refunds WHERE order_id = $1 ORDER BY created_at, id`,
        [orderId],
      )) as { id: string; attempt_id: string; amount: string; reason: string; status: string; created_at: Date; completed_at: Date | null }[];
      return {
        role: 'buyer' as const,
        order,
        payments: payments.map((p) => ({
          // a duplicate or rejected payment is money in that is owed straight back (refunds lists it)
          attemptId: p.id, provider: p.provider, amount: p.amount, accepted: p.status === 'succeeded', confirmedAt: p.confirmed_at.toISOString(),
        })),
        refunds: refunds.map((r) => ({
          id: r.id, attemptId: r.attempt_id, amount: r.amount, reason: r.reason, status: r.status, createdAt: r.created_at.toISOString(), completedAt: r.completed_at?.toISOString() ?? null,
        })),
        settlement: s ? { settledAt: s.created_at.toISOString(), amountCollected: s.amount_collected, refundTotal: s.refund_total } : null,
      };
    }
    const payouts = (await this.db.query(
      `SELECT id, order_id, amount::text, status, simulated, created_at, sent_at FROM payments.payouts WHERE order_id = $1 ORDER BY created_at, id`,
      [orderId],
    )) as PayoutRow[];
    return { role: 'seller' as const, order, settlement: s ? settlementView(s) : null, payouts: payouts.map(payoutView) };
  }

  /** GET /me/statements (FR-PAY-21, IF-UI-08). */
  async statements(sellerId: string, cursor?: string): Promise<{ items: (SettlementView & { payout: PayoutLine | null })[]; owed: string; nextCursor: string | null }> {
    const after = decodeCursor(cursor);
    const rows = (await this.db.query(
      `SELECT ${SETTLEMENT_COLUMNS}, ${cursorAt('s.created_at')} AS cursor_at
         FROM payments.settlements s JOIN orders.orders o ON o.id = s.order_id
        WHERE o.seller_id = $1 AND ($2::timestamptz IS NULL OR (s.created_at, s.order_id) < ($2::timestamptz, $3::uuid))
        ORDER BY s.created_at DESC, s.order_id DESC LIMIT 51`,
      [sellerId, after?.at ?? null, after?.id ?? null],
    )) as (SettlementRow & { cursor_at: string })[];
    const page = rows.slice(0, 50);
    const payouts = page.length
      ? ((await this.db.query(
          `SELECT id, order_id, amount::text, status, simulated, created_at, sent_at FROM payments.payouts WHERE order_id = ANY($1::uuid[]) AND seller_id = $2`,
          [page.map((r) => r.order_id), sellerId],
        )) as PayoutRow[])
      : [];
    const byOrder = new Map(payouts.map((p) => [p.order_id, p]));
    const last = page[page.length - 1];
    return {
      items: page.map((r) => {
        const p = byOrder.get(r.order_id);
        return { ...settlementView(r), payout: p ? payoutView(p) : null };
      }),
      owed: (await this.ledger.owed('seller_payable', sellerId)).toString(),
      nextCursor: rows.length > 50 ? encodeCursor(last.cursor_at, last.order_id) : null,
    };
  }
}
