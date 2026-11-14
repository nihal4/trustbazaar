import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CLOCK, Clock } from '../../../kernel/clock';
import { CONFIG_PORT, ConfigPort, durationMs } from '../../../kernel/config-port';
import type { DeadlineKind } from '../../orders/ports';
import { ORDER_DEADLINES, OrderDeadlines } from '../adapters/deadlines';
import { NotificationService } from './notification.service';

// Deadline reminders (docs/design/06_chat_notifications.pdf section 7.6; FR-NTF-07; U6-06), over notify.reminders
// and the design's functions schedule_reminder, cancel_reminders and claim_due_reminders.
//  - Scheduling: the event that sets a deadline schedules one reminder per lead of CP-38 (24 and 2 hours before it)
//    and person. Scheduling again moves them (no duplicate); a deadline moved later re-arms one already sent. A lead
//    whose time has already passed is not scheduled: it would arrive together with the notice that set the deadline.
//  - Cancelling: the event that completes the step cancels the reminders still scheduled.
//  - Sending (the job, every minute): claims due reminders once across instances (SKIP LOCKED); one whose deadline
//    has passed is cancelled by the claim, never sent. Each is checked with Unit 2's deadline query first: dropped if
//    the deadline no longer applies (a missed cancellation), moved if the deadline moved later, otherwise sent as an
//    in-app notice with an e-mail unless switched off (category reminder). A failure puts it back for the next run.

const BATCH = 100;

export interface ReminderRun { sent: number; dropped: number; moved: number; failed: number }

interface Claimed { id: string; user_id: string; kind: DeadlineKind; subject_id: string; due_at: Date; lead_s: number; lead_text: string }

@Injectable()
export class ReminderService {
  private readonly log = new Logger('Reminders');

  constructor(
    private readonly db: DataSource,
    private readonly notices: NotificationService,
    @Inject(ORDER_DEADLINES) private readonly deadlines: OrderDeadlines,
    @Inject(CONFIG_PORT) private readonly params: ConfigPort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Schedules (or moves) a deadline's reminders for each person; returns how many leads were scheduled. */
  async schedule(userIds: string[], kind: DeadlineKind, orderId: string, dueAt: Date): Promise<number> {
    const now = this.clock.now().getTime();
    const leads = (await this.params.current()).get<{ reminders: string[] }>('CP-38').reminders;
    let n = 0;
    for (const lead of leads) {
      if (dueAt.getTime() - durationMs(lead) <= now) continue;
      for (const user of new Set(userIds)) {
        await this.db.query(`SELECT notify.schedule_reminder($1, $2, $3, $4, $5::interval)`, [user, kind, orderId, dueAt, lead]);
        n++;
      }
    }
    return n;
  }

  /** The step happened (or the order moved on): cancels the reminders of these kinds still scheduled. */
  async cancel(kinds: readonly DeadlineKind[], orderId: string): Promise<number> {
    let n = 0;
    for (const kind of kinds) {
      const [{ n: c }] = (await this.db.query(`SELECT notify.cancel_reminders($1, $2) AS n`, [kind, orderId])) as { n: number }[];
      n += c;
    }
    return n;
  }

  /** The reminder job (every minute). */
  async sendDue(): Promise<ReminderRun> {
    const due = (await this.db.query(
      `SELECT id, user_id, kind, subject_id, due_at, extract(epoch FROM lead)::float8 AS lead_s, lead::text AS lead_text
         FROM notify.claim_due_reminders($1)`,
      [BATCH],
    )) as Claimed[];
    const run: ReminderRun = { sent: 0, dropped: 0, moved: 0, failed: 0 };
    for (const r of due) {
      try {
        const d = await this.deadlines.deadline(r.subject_id, r.kind);
        if (!d || d.dueAt <= this.clock.now()) {
          // the step happened, the order moved on, or the deadline passed: never sent
          await this.db.query(`UPDATE notify.reminders SET status = 'cancelled', cancelled_at = now(), sent_at = NULL WHERE id = $1`, [r.id]);
          run.dropped++;
          continue;
        }
        if (Math.abs(d.dueAt.getTime() - r.due_at.getTime()) >= 1000) {
          // moved: later re-arms it for its new time; earlier keeps it claimed, and it is sent now (its time has passed)
          await this.db.query(`SELECT notify.schedule_reminder($1, $2, $3, $4, $5::interval)`, [r.user_id, r.kind, r.subject_id, d.dueAt, r.lead_text]);
          if (d.dueAt > r.due_at) {
            run.moved++;
            continue;
          }
        }
        const hours = Math.round((r.lead_s / 3600) * 10) / 10;
        const id = await this.notices.create(
          r.user_id, `reminder.${r.kind}`, { listing_title: d.listingTitle ?? '—', hours },
          `reminder:${r.id}:${d.dueAt.toISOString()}`, { type: 'order', id: r.subject_id },
        );
        if (id) await this.notices.push(r.user_id, id);
        run.sent++;
      } catch (err) {
        await this.db.query(`UPDATE notify.reminders SET status = 'scheduled', sent_at = NULL WHERE id = $1 AND status = 'sent'`, [r.id]).catch(() => undefined);
        run.failed++;
        this.log.warn(`reminder ${r.id} (${r.kind}, order ${r.subject_id}): ${(err as Error).message}`);
      }
    }
    return run;
  }
}
