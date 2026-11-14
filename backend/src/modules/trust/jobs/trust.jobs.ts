import { Injectable, OnModuleInit } from '@nestjs/common';
import { JobRunner } from '../../../kernel/jobs/job-runner';
import { DisputeService } from '../services/dispute.service';

// Unit 7's scheduled jobs (docs/design/07_disputes_trust_staff.pdf section 8), added by its tasks. Each claims its rows
// so that several instances can run it (NFR-REL-03).
@Injectable()
export class TrustJobs implements OnModuleInit {
  constructor(
    private readonly jobs: JobRunner,
    private readonly disputes: DisputeService,
  ) {}

  onModuleInit(): void {
    // response deadlines (U7-03): no response in CP-20, or the operator's deadline passed: the review starts
    this.jobs.register({ name: 'disputes.response_deadlines', intervalMs: 5 * 60_000, run: () => this.disputes.startOverdueReviews() });
  }
}
