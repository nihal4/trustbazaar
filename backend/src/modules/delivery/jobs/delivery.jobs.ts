import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { JobRunner } from '../../../kernel/jobs/job-runner';
import { COURIER, CourierPort } from '../adapters/courier-port';
import { MockCourier } from '../adapters/mock-courier';
import { BookingService } from '../services/booking.service';
import { StatusService } from '../services/status.service';
import { UpkeepService } from '../services/upkeep.service';

// Unit 4's scheduled jobs (docs/design/04_delivery.pdf section 8; NFR-REL-03). U4-04: booking (every minute, DV-29),
// and, for the mock courier with MOCK_COURIER_AUTO_ADVANCE_SECONDS set, its automatic steps. U4-05: status
// reconciliation (30 minutes, DV-31), proposal lapse (15 minutes), address erasure (daily, DV-30) and provider-event
// retention (daily, CP-32).
export const MINUTE_MS = 60_000;
export const DAY_MS = 24 * 60 * MINUTE_MS;

@Injectable()
export class DeliveryJobs implements OnModuleInit {
  constructor(
    private readonly jobs: JobRunner,
    private readonly booking: BookingService,
    private readonly statuses: StatusService,
    private readonly upkeep: UpkeepService,
    @Inject(COURIER) private readonly courier: CourierPort,
  ) {}

  onModuleInit(): void {
    this.jobs.register({ name: 'delivery.booking', intervalMs: MINUTE_MS, run: () => this.booking.bookDue() });
    this.jobs.register({ name: 'delivery.reconciliation', intervalMs: 30 * MINUTE_MS, run: async () => (await this.upkeep.reconcile()).done });
    this.jobs.register({ name: 'delivery.proposal_lapse', intervalMs: 15 * MINUTE_MS, run: () => this.upkeep.lapseProposals() });
    this.jobs.register({ name: 'delivery.address_erasure', intervalMs: DAY_MS, run: async () => (await this.upkeep.eraseAddresses()).done });
    this.jobs.register({ name: 'delivery.provider_events', intervalMs: DAY_MS, run: () => this.upkeep.purgeProviderEvents() });
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
