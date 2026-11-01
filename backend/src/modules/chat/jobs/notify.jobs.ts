import { Injectable, OnModuleInit } from '@nestjs/common';
import { JobRunner } from '../../../kernel/jobs/job-runner';
import { DeliveryService } from '../services/delivery.service';

// Unit 6's scheduled jobs so far (docs/design/06_chat_notifications.pdf section 8; U6-05). The delivery worker is
// "continuous": every 10 seconds here. The reminder job comes with U6-06, chat retention with chat (U6-02).
export const DAY_MS = 86_400_000;

@Injectable()
export class NotifyJobs implements OnModuleInit {
  constructor(
    private readonly jobs: JobRunner,
    private readonly deliveries: DeliveryService,
  ) {}

  onModuleInit(): void {
    this.jobs.register({ name: 'chat.deliveries.send', intervalMs: 10_000, run: () => this.deliveries.processDue() });
    this.jobs.register({ name: 'chat.notifications.retention', intervalMs: DAY_MS, run: () => this.deliveries.purgeExpired() });
  }
}
