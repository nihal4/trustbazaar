import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CLOCK, Clock } from '../../../kernel/clock';
import { CONFIG_PORT, ConfigPort } from '../../../kernel/config-port';
import { JobRunner } from '../../../kernel/jobs/job-runner';
import { EscrowService } from '../services/escrow.service';
import { OrderService } from '../services/order.service';
import { PAYMENT_PROVIDERS, PaymentService, ProviderRegistry } from '../services/payment.service';
import { PayoutService } from '../services/payout.service';
import { RefundService } from '../services/refund.service';

// Unit 2's scheduled jobs (docs/design/02_orders_payments.pdf section 5.13; NFR-REL-03; U2-07). Each job
// finds its due rows, and the service it calls locks each row, re-checks its state and acts on the recorded
// deadline, so several instances can run a job at once and a missed run is caught up without acting twice.
// The monetization job (featured periods, renewals) comes with U2-06; the outbox is the kernel's (K-04).
export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;
export const DV_15_MS = 2 * MINUTE_MS; // in-flight attempt age before reconciliation queries it
const BATCH = 200;

type Ids = { id: string }[];

@Injectable()
export class OrdersJobs implements OnModuleInit {
  private readonly log = new Logger('OrdersJobs');

  constructor(
    private readonly jobs: JobRunner,
    private readonly db: DataSource,
    private readonly orders: OrderService,
    private readonly payments: PaymentService,
    private readonly escrow: EscrowService,
    private readonly refunds: RefundService,
    private readonly payouts: PayoutService,
    @Inject(PAYMENT_PROVIDERS) private readonly providers: ProviderRegistry,
    @Inject(CONFIG_PORT) private readonly params: ConfigPort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async onModuleInit(): Promise<void> {
    let reconcileMs = 15 * MINUTE_MS; // CP-46's default, if the parameters cannot be read at start
    try {
      reconcileMs = (await this.params.current()).ms('CP-46');
    } catch (e) {
      this.log.warn(`CP-46 not readable at start, reconciling every 15 minutes: ${(e as Error).message}`);
    }
    this.jobs.register({ name: 'orders.payment.expire', intervalMs: MINUTE_MS, run: () => this.expirePayments() });
    this.jobs.register({ name: 'orders.fulfilment.deadline', intervalMs: MINUTE_MS, run: () => this.missedDeadlines() });
    this.jobs.register({ name: 'orders.escrow.auto_release', intervalMs: MINUTE_MS, run: () => this.autoRelease() });
    this.jobs.register({ name: 'orders.delivery.stalled', intervalMs: HOUR_MS, run: () => this.stalledDeliveries() });
    this.jobs.register({ name: 'orders.cancellation.lapse', intervalMs: HOUR_MS, run: () => this.lapseCancellations() });
    this.jobs.register({ name: 'orders.reconciliation', intervalMs: reconcileMs, run: () => this.reconcile() });
    this.jobs.register({ name: 'orders.refunds.send', intervalMs: 30_000, run: async () => (await this.refunds.processDue()).length });
    this.jobs.register({ name: 'orders.payouts.send', intervalMs: MINUTE_MS, run: async () => (await this.payouts.processDue()).length });
  }

  /**
   * Payment expiry (every minute). Before an unpaid order is cancelled, each of its in-flight attempts is
   * queried, so a payment that succeeded without a callback is confirmed rather than lost. If a query
   * cannot be answered, that order waits for the next run.
   */
  async expirePayments(): Promise<number> {
    const due = (await this.db.query(
      `SELECT id FROM orders.orders WHERE status = 'awaiting_payment' AND payment_due_at <= $1 ORDER BY payment_due_at LIMIT ${BATCH}`,
      [this.clock.now()],
    )) as Ids;
    let n = 0;
    for (const { id } of due) {
      const inFlight = (await this.db.query(`SELECT id FROM payments.attempts WHERE order_id = $1 AND status IN ('created', 'redirected')`, [id])) as Ids;
      if (!(await this.queryAll(inFlight))) continue;
      if (await this.orders.expireUnpaid(id)) n++;
    }
    return n;
  }

  /** Fulfilment deadline (every minute, FR-PAY-08): refund paid orders whose step is overdue. */
  async missedDeadlines(): Promise<number> {
    const due = (await this.db.query(
      `SELECT o.id FROM orders.orders o JOIN orders.escrows e ON e.order_id = o.id
        WHERE o.status = 'paid' AND o.fulfilment_done_at IS NULL AND o.fulfilment_due_at <= $1 AND e.state = 'held'
        ORDER BY o.fulfilment_due_at LIMIT ${BATCH}`,
      [this.clock.now()],
    )) as Ids;
    let n = 0;
    for (const { id } of due) if (await this.escrow.refundMissedDeadline(id)) n++;
    return n;
  }

  /** Auto-release (every minute, FR-PAY-07b, FR-GAM-17). */
  async autoRelease(): Promise<number> {
    const due = (await this.db.query(
      `SELECT order_id AS id FROM orders.escrows WHERE state = 'held' AND auto_release_at <= $1 ORDER BY auto_release_at LIMIT ${BATCH}`,
      [this.clock.now()],
    )) as Ids;
    let n = 0;
    for (const { id } of due) if (await this.escrow.autoRelease(id)) n++;
    return n;
  }

  /**
   * Stalled delivery (hourly, DV-12, FR-DLV-11): picked up by the courier, no delivery event within CP-17 +
   * CP-18 of the pickup (the order's own parameter version) and no dispute: an operator looks at it; nothing
   * is released or refunded automatically. One issue per order.
   */
  async stalledDeliveries(): Promise<number> {
    const rows = (await this.db.query(
      `SELECT o.id, o.fulfilment_done_at, o.params_version FROM orders.orders o JOIN orders.escrows e ON e.order_id = o.id
        WHERE o.status = 'paid' AND o.fulfilment = 'courier' AND o.fulfilment_done_at IS NOT NULL AND o.delivery_event_at IS NULL
          AND e.state = 'held'
          AND NOT EXISTS (SELECT 1 FROM payments.reconciliation_issues i WHERE i.order_id = o.id AND i.kind = 'stalled_delivery')
        ORDER BY o.fulfilment_done_at LIMIT ${BATCH}`,
    )) as { id: string; fulfilment_done_at: Date; params_version: number }[];
    const now = this.clock.now();
    let n = 0;
    for (const r of rows) {
      const v = await this.params.atVersion(r.params_version);
      const stalledAt = new Date(r.fulfilment_done_at.getTime() + v.ms('CP-17') + v.ms('CP-18'));
      if (stalledAt > now) continue;
      const raised = await this.db.transaction(async (m) => {
        await m.query(`SELECT pg_advisory_xact_lock(hashtext('stalled-delivery:' || $1))`, [r.id]); // one issue, even with several instances
        const [found] = (await m.query(`SELECT 1 FROM payments.reconciliation_issues WHERE order_id = $1 AND kind = 'stalled_delivery'`, [r.id])) as unknown[];
        if (found) return false;
        await m.query(
          `INSERT INTO payments.reconciliation_issues (kind, order_id, detail) VALUES ('stalled_delivery', $1, $2)`,
          [r.id, JSON.stringify({ pickedUpAt: r.fulfilment_done_at.toISOString(), stalledAt: stalledAt.toISOString() })],
        );
        return true;
      });
      if (raised) n++;
    }
    return n;
  }

  /** Cancellation lapse (hourly, DV-16): no pending request outlives the delivery event or the fulfilment deadline. */
  async lapseCancellations(): Promise<number> {
    const lapsed = (await this.db.query(
      `UPDATE orders.cancellation_requests c SET status = 'lapsed', decided_at = $1
         FROM orders.orders o
        WHERE c.order_id = o.id AND c.status = 'pending'
          AND (o.delivery_event_at IS NOT NULL OR o.fulfilment_due_at <= $1 OR o.status <> 'paid')
       RETURNING c.id`,
      [this.clock.now()],
    )) as unknown;
    return (Array.isArray(lapsed) && Array.isArray(lapsed[0]) ? lapsed[0] : (lapsed as Ids)).length;
  }

  /**
   * Reconciliation (every CP-46, FR-PAY-15): attempts in flight longer than DV-15 are queried (each answer is
   * a provider event processed on the normal idempotent path); refunds a provider took for later are asked
   * about; a paid order whose successful attempt has no provider transaction id raises provider_disagrees.
   * The daily settlement-report comparison needs a provider report, which the sandboxes do not offer.
   */
  async reconcile(): Promise<number> {
    const stale = (await this.db.query(
      `SELECT id FROM payments.attempts WHERE status IN ('created', 'redirected') AND created_at <= $1 ORDER BY created_at LIMIT ${BATCH}`,
      [new Date(this.clock.now().getTime() - DV_15_MS)],
    )) as Ids;
    let n = 0;
    for (const a of stale) if (await this.queryAll([a])) n++;
    n += await this.refunds.confirmSent();
    const missing = (await this.db.query(
      `SELECT a.id, a.order_id FROM payments.attempts a JOIN orders.orders o ON o.id = a.order_id
        WHERE a.status = 'succeeded' AND a.provider_txn_id IS NULL AND o.status IN ('paid', 'closed')
          AND NOT EXISTS (SELECT 1 FROM payments.reconciliation_issues i WHERE i.attempt_id = a.id AND i.kind = 'provider_disagrees')
        LIMIT ${BATCH}`,
    )) as { id: string; order_id: string }[];
    for (const a of missing) {
      await this.db.query(
        `INSERT INTO payments.reconciliation_issues (kind, order_id, attempt_id, detail) VALUES ('provider_disagrees', $1, $2, $3)`,
        [a.order_id, a.id, JSON.stringify({ problem: 'paid without a provider transaction id' })],
      );
      n++;
    }
    return n;
  }

  /** Queries each attempt with its provider; false if any could not be answered (no adapter, or an error). */
  private async queryAll(attempts: Ids): Promise<boolean> {
    let ok = true;
    for (const { id } of attempts) {
      const [a] = (await this.db.query(`SELECT provider FROM payments.attempts WHERE id = $1`, [id])) as { provider: keyof ProviderRegistry }[];
      if (!this.providers[a.provider]) {
        ok = false; // no adapter in this mode: an operator decides
        continue;
      }
      try {
        await this.payments.reconcile(id);
      } catch (e) {
        ok = false;
        this.log.warn(`attempt ${id} could not be queried: ${(e as Error).message}`);
      }
    }
    return ok;
  }
}
