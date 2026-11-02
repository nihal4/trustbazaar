import { Injectable, OnModuleInit } from '@nestjs/common';
import { JobRunner } from '../../../kernel/jobs/job-runner';
import { DeliveryService } from '../services/delivery.service';
import { HoldService } from '../services/hold.service';

// Unit 6's scheduled jobs so far (docs/design/06_chat_notifications.pdf section 8; U6-05). The delivery worker is
// "continuous": every 10 seconds here. The reminder job comes with U6-06, chat retention with U6-03.
export const DAY_MS = 86_400_000;

@Injectable()
export class NotifyJobs implements OnModuleInit {
  constructor(
    private readonly jobs: JobRunner,
    private readonly deliveries: DeliveryService,
    private readonly holds: HoldService,
  ) {}

  onModuleInit(): void {
    this.jobs.register({ name: 'chat.deliveries.send', intervalMs: 10_000, run: () => this.deliveries.processDue() });
    this.jobs.register({ name: 'chat.notifications.retention', intervalMs: DAY_MS, run: () => this.deliveries.purgeExpired() });
    // chat retention (FR-CHT-04): content of threads silent for a year, unless a case holds them
    this.jobs.register({ name: 'chat.threads.retention', intervalMs: DAY_MS, run: () => this.holds.purgeDue() });
  }
}
