import { Injectable, OnModuleInit } from '@nestjs/common';
import { JobRunner } from '../../../kernel/jobs/job-runner';
import { AuctionCloser } from '../services/auction-closer.service';
import { SecondChanceService } from '../services/second-chance.service';
import { ShillDetector } from '../services/shill-detector.service';

// Unit 3's scheduled jobs (docs/design/09_integration.pdf section 5, "a few seconds"; NFR-REL-03; U3-05). Each
// claims its rows with SKIP LOCKED and re-checks them under the lock, so every instance may run them at once.
export const CLOSE_INTERVAL_MS = 2_000;
export const OFFER_INTERVAL_MS = 10_000;
/** FR-AUC-18: "every few minutes" (section 5.8). */
export const SHILL_INTERVAL_MS = 5 * 60_000;

@Injectable()
export class AuctionsJobs implements OnModuleInit {
  constructor(
    private readonly jobs: JobRunner,
    private readonly closer: AuctionCloser,
    private readonly secondChance: SecondChanceService,
    private readonly shill: ShillDetector,
  ) {}

  onModuleInit(): void {
    this.jobs.register({ name: 'listings.auctions.close', intervalMs: CLOSE_INTERVAL_MS, run: () => this.closer.closeDue() });
    this.jobs.register({ name: 'listings.offers.expire', intervalMs: OFFER_INTERVAL_MS, run: () => this.secondChance.expireDue() });
    this.jobs.register({ name: 'listings.auctions.shill_scan', intervalMs: SHILL_INTERVAL_MS, run: () => this.shill.scanDue() });
  }
}
