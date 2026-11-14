import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { CLOCK, Clock } from '../../../kernel/clock';
import { Problem } from '../../../kernel/http/problems';
import { REDIS } from '../../../kernel/redis.provider';
import { NOTIFICATION_PORT, NotificationPort } from '../../chat/ports';
import { GAME_ACCOUNT_QUERIES, GameAccountQueries } from '../../game-accounts/ports';
import { STAFF_QUERY, StaffQuery } from '../../identity/ports';
import { PAYOUT_CHECKS, PayoutChecksQuery } from '../../orders/ports';

// The staff console's queues (docs/design/07_disputes_trust_staff.pdf section 2.3; FR-OPS-01, FR-DSP-08, DV-52; U7-06).
// FR-OPS-01 allows exactly eight queues. Each lists its open items oldest first with their age; the disputes queue puts
// the overdue ones (past CP-21's decision target) first (DV-52). The data stays with the unit that owns it: Unit 7
// reads its own three, and asks Unit 1 (KYC) and Unit 2 (bank payout-account checks) through their ports. Listings in
// review (U3-08) and payment discrepancies (Unit 2's reconciliation) answer feature-off until their owners build them
// (Decisions log, U7-06); ownership proofs come from Unit 5's GameAccountQueries (U5-02). Each item names the endpoint that acts on it.
// The decision-target job (hourly) e-mails the active administrators once a day, in Dhaka's calendar, when disputes
// are overdue (FR-DSP-08).

export const QUEUES = ['kyc', 'ownership_proofs', 'listings_review', 'reports', 'flagged_activity', 'disputes', 'payout_accounts', 'payment_discrepancies'] as const;
export type QueueName = (typeof QUEUES)[number];
const NOT_YET: Partial<Record<QueueName, string>> = {
  listings_review: 'listing-review-not-yet-available', // U3-08
  payment_discrepancies: 'payment-discrepancies-not-yet-available', // Unit 2's reconciliation
};
const LIMIT = 200;
const HOUR = 3_600_000;

export interface QueueItem {
  id: string;
  /** Hours since the item entered the queue. */
  ageHours: number;
  since: string;
  status: string;
  assignedTo: string | null;
  overdue?: boolean;
  /** Where the operator acts on it. */
  path: string;
  [field: string]: unknown;
}

@Injectable()
export class QueueService {
  private readonly log = new Logger('StaffQueues');

  constructor(
    private readonly db: DataSource,
    @Inject(STAFF_QUERY) private readonly staff: StaffQuery,
    @Inject(PAYOUT_CHECKS) private readonly payouts: PayoutChecksQuery,
    @Inject(GAME_ACCOUNT_QUERIES) private readonly games: GameAccountQueries,
    @Inject(NOTIFICATION_PORT) private readonly mail: NotificationPort,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** GET /staff/queues/{queue}. */
  async list(queue: QueueName): Promise<{ queue: QueueName; items: QueueItem[] }> {
    if (NOT_YET[queue]) throw new Problem('feature-off', { errors: [{ field: 'queue', reason: NOT_YET[queue] as string }] });
    const now = this.clock.now().getTime();
    const age = (d: Date) => Math.round(((now - d.getTime()) / HOUR) * 10) / 10;
    const items = await this.items(queue, age);
    return { queue, items };
  }

  private async items(queue: QueueName, age: (d: Date) => number): Promise<QueueItem[]> {
    switch (queue) {
      case 'disputes': {
        const rows = (await this.db.query(
          `SELECT id, order_id, type, status, opened_at, decision_target_at, assigned_to, amount_collected,
                  decision_target_at IS NOT NULL AND decision_target_at < now() AS overdue
             FROM disputes.disputes WHERE status IN ('open', 'under_review', 'awaiting_seller', 'awaiting_return')
            ORDER BY (decision_target_at IS NOT NULL AND decision_target_at < now()) DESC, opened_at LIMIT ${LIMIT}`,
        )) as { id: string; order_id: string; type: string; status: string; opened_at: Date; decision_target_at: Date | null; assigned_to: string | null; amount_collected: string; overdue: boolean }[];
        return rows.map((r) => ({
          id: r.id, ageHours: age(r.opened_at), since: r.opened_at.toISOString(), status: r.status, assignedTo: r.assigned_to, overdue: r.overdue,
          orderId: r.order_id, type: r.type, decisionTargetAt: r.decision_target_at?.toISOString() ?? null, amountCollected: r.amount_collected,
          fourEyes: BigInt(r.amount_collected) >= 2_000_000n, path: `/staff/disputes/${r.id}/case-file`,
        }));
      }
      case 'reports': {
        const rows = (await this.db.query(
          `SELECT id, target_type, target_id, category, subject_user, status, assigned_to, created_at FROM trust.reports
            WHERE status IN ('open', 'under_review') ORDER BY created_at LIMIT ${LIMIT}`,
        )) as { id: string; target_type: string; target_id: string; category: string; subject_user: string; status: string; assigned_to: string | null; created_at: Date }[];
        return rows.map((r) => ({
          id: r.id, ageHours: age(r.created_at), since: r.created_at.toISOString(), status: r.status, assignedTo: r.assigned_to,
          targetType: r.target_type, targetId: r.target_id, category: r.category, subjectUser: r.subject_user, path: `/staff/reports/${r.id}/resolution`,
        }));
      }
      case 'flagged_activity': {
        const rows = (await this.db.query(
          `SELECT id, kind, subject_user, detail, created_at FROM trust.signals WHERE status = 'open' ORDER BY created_at LIMIT ${LIMIT}`,
        )) as { id: string; kind: string; subject_user: string | null; detail: Record<string, unknown>; created_at: Date }[];
        return rows.map((r) => ({
          id: r.id, ageHours: age(r.created_at), since: r.created_at.toISOString(), status: 'open', assignedTo: null,
          kind: r.kind, subjectUser: r.subject_user, detail: r.detail, path: `/staff/signals/${r.id}/review`,
        }));
      }
      case 'kyc':
        return (await this.staff.kycQueue()).map((k) => ({
          id: k.id, ageHours: age(k.submittedAt), since: k.submittedAt.toISOString(), status: 'pending_review', overdue: k.overdue,
          assignedTo: k.claimedUntil && k.claimedUntil.getTime() > this.clock.now().getTime() ? k.claimedBy : null,
          userId: k.userId, docType: k.docType, flags: k.flags, path: `/staff/kyc/submissions/${k.id}`,
        }));
      case 'payout_accounts':
        return (await this.payouts.pendingAccountChecks()).map((a) => ({
          id: a.id, ageHours: age(a.createdAt), since: a.createdAt.toISOString(), status: 'pending_review', assignedTo: null,
          userId: a.userId, path: `/staff/payout-accounts/${a.id}/decision`,
        }));
      case 'ownership_proofs':
        return (await this.games.proofQueue(LIMIT)).map((p) => ({
          id: p.proofId, ageHours: age(p.submittedAt), since: p.submittedAt.toISOString(), status: 'submitted', assignedTo: null,
          listingId: p.listingId, sellerId: p.sellerId, game: p.game, platform: p.platform, playerId: p.playerId, codeExpiresAt: p.codeExpiresAt.toISOString(),
          path: `/staff/game/ownership-proofs/${p.proofId}/review`,
        }));
      default:
        throw new Problem('not-found');
    }
  }

  /**
   * The decision-target job (hourly; FR-DSP-08): when disputes are past CP-21's target, the active administrators get
   * one e-mail a day (Dhaka's date), with the count and the oldest's age. Returns how many were e-mailed.
   */
  async alertOverdue(): Promise<number> {
    const [{ n, oldest }] = (await this.db.query(
      `SELECT count(*)::int AS n, min(opened_at) AS oldest FROM disputes.disputes
        WHERE status IN ('open', 'under_review', 'awaiting_seller', 'awaiting_return') AND decision_target_at < now()`,
    )) as { n: number; oldest: Date | null }[];
    if (n === 0 || !oldest) return 0;
    const [{ day }] = (await this.db.query(`SELECT to_char($1::timestamptz AT TIME ZONE 'Asia/Dhaka', 'YYYY-MM-DD') AS day`, [this.clock.now()])) as { day: string }[];
    if ((await this.redis.set(`disputes:overdue-alert:${day}`, '1', 'EX', 2 * 86_400, 'NX')) !== 'OK') return 0; // once a day, across instances
    const days = String(Math.floor((this.clock.now().getTime() - oldest.getTime()) / 86_400_000));
    let sent = 0;
    for (const admin of await this.staff.activeAdministrators()) {
      try {
        await this.mail.sendEmail(admin.email, 'disputes_overdue', { count: String(n), oldest_days: days });
        sent++;
      } catch (err) {
        this.log.warn(`overdue-disputes e-mail to administrator ${admin.staffId}: ${(err as Error).message}`);
      }
    }
    return sent;
  }
}
