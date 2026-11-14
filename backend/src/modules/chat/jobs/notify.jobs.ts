import { Injectable, OnModuleInit } from '@nestjs/common';
import { JobRunner } from '../../../kernel/jobs/job-runner';
import { DeliveryService } from '../services/delivery.service';
import { HoldService } from '../services/hold.service';
import { ReminderService } from '../services/reminder.service';

// Unit 6's scheduled jobs so far (docs/design/06_chat_notifications.pdf section 8; U6-05). The delivery worker is
// "continuous": every 10 seconds here. Chat retention came with U6-03, the reminder job with U6-06.
export const DAY_MS = 86_400_000;

@Injectable()
export class NotifyJobs implements OnModuleInit {
  constructor(
    private readonly jobs: JobRunner,
    private readonly deliveries: DeliveryService,
    private readonly holds: HoldService,
    private readonly reminders: ReminderService,
  ) {}

  onModuleInit(): void {
    this.jobs.register({ name: 'chat.deliveries.send', intervalMs: 10_000, run: () => this.deliveries.processDue() });
    // deadline reminders (FR-NTF-07): claim the due ones, check each with Unit 2, send (U6-06)
    this.jobs.register({ name: 'chat.reminders.send', intervalMs: 60_000, run: async () => (await this.reminders.sendDue()).sent });
    this.jobs.register({ name: 'chat.notifications.retention', intervalMs: DAY_MS, run: () => this.deliveries.purgeExpired() });
    // chat retention (FR-CHT-04): content of threads silent for a year, unless a case holds them
    this.jobs.register({ name: 'chat.threads.retention', intervalMs: DAY_MS, run: () => this.holds.purgeDue() });
  }
}
