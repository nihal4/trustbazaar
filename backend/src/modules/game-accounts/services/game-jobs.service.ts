import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { forEachDue } from '../../../kernel/jobs/job-runner';
import { Problem } from '../../../kernel/http/problems';
import { FILE_VAULT, FileVaultPort } from '../../identity/ports';
import { ESCROW_COMMANDS, EscrowCommands, ORDERS_PORT, OrdersPort } from '../../orders/ports';
import type { DisputeCommands } from '../../trust/ports';
import { GAME_DISPUTES } from '../adapters/disputes';
import { TakeoverService } from './takeover.service';

// Unit 5's scheduled work (docs/design/05_game_accounts.pdf section 8; FR-GAM-15, DV-33, DV-37, DV-39, I-63; U5-05).
// Each job claims its rows with SKIP LOCKED (forEachDue) or acts in one statement, so several instances share it.
//  - Takeover window end: complete_if_due completes the takeover at the window's end (not the job's time) and Unit 2's
//    delivery event is recorded in the same transaction; both parties are told.
//  - Re-key overdue (DV-37): rekey_overdue disputes the handover and Unit 7's credentials_invalid dispute is opened in
//    the same transaction. Until U7-10 Unit 7 refuses it (feature-off): the row is left as it was and tried again at the
//    next run (agreed with the user, 2026-11-15).
//  - Proof expiry (DV-33): issued codes past their validity become expired.
//  - Retention (I-63, DV-39): purge_due deletes old access-log rows and clears old screenshot keys; the files are erased.

/** I-63 and DV-39. */
export const RETENTION = { accessLog: '2 years', soldScreenshot: '2 years', otherScreenshot: '30 days' };
const OVERDUE_REKEY = 'The seller did not send the login details again for the buyer\'s new key in time.';

@Injectable()
export class GameJobsService {
  private readonly log = new Logger('GameJobs');

  constructor(
    private readonly db: DataSource,
    @Inject(ORDERS_PORT) private readonly orders: OrdersPort,
    @Inject(ESCROW_COMMANDS) private readonly escrow: EscrowCommands,
    @Inject(GAME_DISPUTES) private readonly disputes: DisputeCommands,
    @Inject(FILE_VAULT) private readonly vault: FileVaultPort,
    private readonly takeover: TakeoverService,
  ) {}

  /** Every minute (FR-GAM-15): takeovers whose window ended without completion or a report. */
  async completeDueTakeovers(): Promise<number> {
    const done: { orderId: string; buyerId: string }[] = [];
    await forEachDue<{ order_id: string; buyer_id: string }>(
      this.db,
      `SELECT order_id, buyer_id FROM game_accounts.handovers WHERE status = 'delivered' AND takeover_due_at <= clock_timestamp()
        ORDER BY takeover_due_at LIMIT 1 FOR UPDATE SKIP LOCKED`,
      [],
      async (h, m) => {
        await this.orders.lockForFulfilment(h.order_id, m);
        const [{ at }] = (await m.query(`SELECT game_accounts.complete_if_due($1) AS at`, [h.order_id])) as { at: Date | null }[];
        if (!at) return;
        await this.escrow.recordDeliveryEvent(h.order_id, 'game_takeover', at, m); // DC-14; the protection period starts at the window's end
        done.push({ orderId: h.order_id, buyerId: h.buyer_id });
      },
    );
    for (const d of done) await this.takeover.completed(d.orderId, d.buyerId);
    return done.length;
  }

  /** Every 5 minutes (DV-37): re-keys the seller did not answer in time become credentials_invalid disputes. */
  async disputeOverdueRekeys(): Promise<number> {
    const waiting: string[] = [];
    let opened = 0;
    await forEachDue<{ order_id: string }>(
      this.db,
      `SELECT order_id FROM game_accounts.handovers WHERE status = 'rekey_requested' AND rekey_due_at <= clock_timestamp() AND NOT (order_id = ANY($1::uuid[]))
        ORDER BY rekey_due_at LIMIT 1 FOR UPDATE SKIP LOCKED`,
      [waiting],
      async (h, m) => {
        await m.query(`SAVEPOINT overdue`);
        try {
          if (!(((await m.query(`SELECT game_accounts.rekey_overdue($1) AS moved`, [h.order_id])) as { moved: boolean }[])[0].moved)) return;
          await this.disputes.open({ orderId: h.order_id, type: 'credentials_invalid', description: OVERDUE_REKEY, by: 'system' }, m);
          opened++;
        } catch (err) {
          await m.query(`ROLLBACK TO SAVEPOINT overdue`);
          waiting.push(h.order_id); // not again in this run
          if (!(err instanceof Problem && err.problem === 'feature-off')) throw err;
          this.log.warn(`re-key overdue on order ${h.order_id}: Unit 7 does not take game-account disputes yet (U7-10); left for the next run`);
        }
      },
    );
    return opened;
  }

  /** Every hour (DV-33): issued ownership codes past their validity. */
  async expireCodes(): Promise<number> {
    const [, n] = (await this.db.query(`UPDATE game_accounts.ownership_proofs SET status = 'expired' WHERE status = 'issued' AND expires_at <= now()`)) as [unknown, number];
    return n;
  }

  /** Daily (I-63, DV-39): the access log and screenshots past retention; returns the screenshot files erased. */
  async purge(r: typeof RETENTION = RETENTION): Promise<number> {
    const keys = ((await this.db.query(`SELECT game_accounts.purge_due($1::interval, $2::interval, $3::interval) AS key`, [r.accessLog, r.soldScreenshot, r.otherScreenshot])) as { key: string }[]).map((k) => k.key);
    let erased = 0;
    for (const key of keys) {
      try {
        await this.vault.erase(key);
        erased++;
      } catch (err) {
        this.log.warn(`erasing a purged ownership screenshot: ${(err as Error).message}`); // the key is gone from the database; the file is unreachable
      }
    }
    return erased;
  }
}
