import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { CLOCK, Clock } from '../../../kernel/clock';
import { CONFIG_PORT, ConfigPort } from '../../../kernel/config-port';
import { REDIS } from '../../../kernel/redis.provider';
import { FULFILMENT_ORDERS, FulfilmentOrders } from '../adapters/orders';
import { StatusService } from './status.service';

// Unit 4's upkeep jobs (docs/design/04_delivery.pdf section 8; U4-05): status reconciliation (DV-31), proposal lapse,
// address erasure (DV-30) and provider-event retention (CP-32). Each works in small batches, is safe on several
// instances at once (NFR-REL-03), and lets one bad row fail alone: the rest of the batch goes on (logged).

/** DV-31: shipments in flight with no report for 6 hours are asked about; at most once per 25 minutes each. */
export const DV_31 = { silentMs: 6 * 3_600_000, leaseSeconds: 25 * 60 } as const;
/** DV-30: shipment addresses are kept 30 days after the order closes (or after a cancelled shipment is final). */
export const DV_30_MS = 30 * 86_400_000;
const BATCH = 100;
const IN_FLIGHT = ['booked', 'picked_up', 'in_transit', 'delivery_failed'] as const;

export interface UpkeepRun { done: number; failed: number }

@Injectable()
export class UpkeepService {
  private readonly log = new Logger('DeliveryUpkeep');

  constructor(
    private readonly db: DataSource,
    private readonly statuses: StatusService,
    @Inject(FULFILMENT_ORDERS) private readonly orders: FulfilmentOrders,
    @Inject(CONFIG_PORT) private readonly params: ConfigPort,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Status reconciliation (every 30 minutes, DV-31): asks the courier about each shipment in flight whose last
   * report is older than 6 hours, and applies the answer as a status query (section 7.4). A lost webhook is caught
   * this way, as FR-PAY-15 does for payments. A Redis lease keeps two instances from asking about the same one.
   */
  async reconcile(): Promise<UpkeepRun> {
    const silentSince = new Date(this.clock.now().getTime() - DV_31.silentMs);
    const due = (await this.db.query(
      `SELECT s.id, s.consignment_id FROM delivery.shipments s
        WHERE s.status = ANY($1::delivery.shipment_status[]) AND s.consignment_id IS NOT NULL
          AND (SELECT max(h.at) FROM delivery.shipment_history h WHERE h.shipment_id = s.id) < $2
        ORDER BY s.created_at LIMIT ${BATCH}`,
      [IN_FLIGHT, silentSince],
    )) as { id: string; consignment_id: string }[];
    const run: UpkeepRun = { done: 0, failed: 0 };
    for (const s of due) {
      if ((await this.redis.set(`delivery:reconcile:${s.id}`, '1', 'EX', DV_31.leaseSeconds, 'NX')) !== 'OK') continue;
      try {
        await this.statuses.query(s.id, s.consignment_id);
        run.done++;
      } catch (err) {
        run.failed++;
        this.log.warn(`reconciling shipment ${s.id}: ${(err as Error).message}`);
      }
    }
    return run;
  }

  /** Proposal lapse (every 15 minutes): an open proposal whose meeting time has passed can no longer be accepted. */
  async lapseProposals(): Promise<number> {
    const res = (await this.db.query(
      `UPDATE delivery.meetup_proposals SET status = 'lapsed', responded_at = now()
        WHERE id IN (SELECT id FROM delivery.meetup_proposals WHERE status = 'proposed' AND meet_at <= $1
                      ORDER BY meet_at LIMIT ${BATCH * 5} FOR UPDATE SKIP LOCKED)
        RETURNING id`,
      [this.clock.now()],
    )) as unknown[];
    return ((Array.isArray(res[0]) ? res[0] : res) as unknown[]).length;
  }

  /**
   * Address erasure (daily, DV-30): a final shipment's two addresses are erased 30 days after the order closed, or
   * 30 days after a cancelled shipment became final, unless a dispute is open on the order. The order's close time
   * and open dispute come from Unit 2's EscrowQuery (Decisions log, U4-05). The database allows erasure only once a
   * shipment is final (shipment_erase_only_when_final).
   */
  async eraseAddresses(): Promise<UpkeepRun> {
    const now = this.clock.now();
    const before = new Date(now.getTime() - DV_30_MS);
    const candidates = (await this.db.query(
      `SELECT id, order_id, status, coalesce(delivered_at, returned_at, cancelled_at) AS final_at FROM delivery.shipments
        WHERE addresses_erased_at IS NULL AND status IN ('delivered', 'returned_to_seller', 'cancelled')
          AND coalesce(delivered_at, returned_at, cancelled_at) <= $1
        ORDER BY coalesce(delivered_at, returned_at, cancelled_at) LIMIT ${BATCH * 5}`,
      [before],
    )) as { id: string; order_id: string; status: string; final_at: Date }[];
    const run: UpkeepRun = { done: 0, failed: 0 };
    const orders = new Map<string, { closedAt: Date | null; openDisputeId: string | null } | null>();
    for (const s of candidates) {
      try {
        if (!orders.has(s.order_id)) {
          const e = await this.orders.getEscrow(s.order_id).catch(() => null);
          orders.set(s.order_id, e && { closedAt: e.closedAt, openDisputeId: e.openDisputeId });
        }
        const o = orders.get(s.order_id);
        if (o?.openDisputeId) continue; // a dispute needs the addresses
        // a cancelled shipment counts from its own end; any other from the order's close
        const since = s.status === 'cancelled' ? s.final_at : o?.closedAt;
        if (!since || since > before) continue;
        const res = (await this.db.query(
          `UPDATE delivery.shipments SET pickup_address_enc = NULL, dropoff_address_enc = NULL, addresses_erased_at = now()
            WHERE id = $1 AND addresses_erased_at IS NULL RETURNING id`, [s.id],
        )) as unknown[];
        if (((Array.isArray(res[0]) ? res[0] : res) as unknown[]).length > 0) run.done++;
      } catch (err) {
        run.failed++;
        this.log.warn(`erasing the addresses of shipment ${s.id}: ${(err as Error).message}`);
      }
    }
    return run;
  }

  /** Provider events (daily, SEC-PAY-04): event ids are kept CP-32's retention (30 days) to refuse replays, then deleted. */
  async purgeProviderEvents(): Promise<number> {
    const keep = (await this.params.current()).ms('CP-32', 'retention');
    const res = (await this.db.query(
      `DELETE FROM delivery.provider_events WHERE received_at < $1`, [new Date(this.clock.now().getTime() - keep)],
    )) as unknown;
    return Array.isArray(res) && typeof res[1] === 'number' ? res[1] : 0;
  }
}
