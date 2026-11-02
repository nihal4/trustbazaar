import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { JobRunner } from '../../../kernel/jobs/job-runner';
import { COURIER, CourierPort } from '../adapters/courier-port';
import { MockCourier } from '../adapters/mock-courier';
import { BookingService } from '../services/booking.service';
import { StatusService } from '../services/status.service';

// Unit 4's scheduled jobs (docs/design/04_delivery.pdf section 8; NFR-REL-03). U4-04: booking (every minute, DV-29),
// and, for the mock courier with MOCK_COURIER_AUTO_ADVANCE_SECONDS set, its automatic steps. Status reconciliation,
// proposal lapse and the retention jobs come with U4-05.
export const MINUTE_MS = 60_000;

@Injectable()
export class DeliveryJobs implements OnModuleInit {
  constructor(
    private readonly jobs: JobRunner,
    private readonly booking: BookingService,
    private readonly statuses: StatusService,
    @Inject(COURIER) private readonly courier: CourierPort,
  ) {}

  onModuleInit(): void {
    this.jobs.register({ name: 'delivery.booking', intervalMs: MINUTE_MS, run: () => this.booking.bookDue() });
    if (this.courier instanceof MockCourier) {
      const mock = this.courier;
      // the mock's webhooks go to the same handler as a provider's, signature check included (section 7.4, step 1)
      mock.setWebhookSink((headers, body) => this.statuses.webhook(mock.provider, headers, body));
      if (mock.autoAdvanceSeconds > 0) {
        this.jobs.register({ name: 'delivery.mock_courier.advance', intervalMs: Math.max(5, Math.min(mock.autoAdvanceSeconds, 60)) * 1000, run: () => mock.advanceDue() });
      }
    }
  }
}
