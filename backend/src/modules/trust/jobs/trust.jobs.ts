import { Injectable, OnModuleInit } from '@nestjs/common';
import { JobRunner } from '../../../kernel/jobs/job-runner';
import { DisputeService } from '../services/dispute.service';
import { PrivacyService } from '../services/privacy.service';
import { QueueService } from '../services/queue.service';

// Unit 7's scheduled jobs (docs/design/07_disputes_trust_staff.pdf section 8), added by its tasks. Each claims its rows
// so that several instances can run it (NFR-REL-03).
@Injectable()
export class TrustJobs implements OnModuleInit {
  constructor(
    private readonly jobs: JobRunner,
    private readonly disputes: DisputeService,
    private readonly queues: QueueService,
    private readonly privacy: PrivacyService,
  ) {}

  onModuleInit(): void {
    // response deadlines (U7-03): no response in CP-20, or the operator's deadline passed: the review starts
    // decision targets (U7-06, FR-DSP-08): overdue disputes come first in the queue; administrators are e-mailed once a day
    this.jobs.register({ name: 'disputes.decision_targets', intervalMs: 60 * 60_000, run: () => this.queues.alertOverdue() });
    // retention (U7-07, I-63): dispute statements and evidence 2 years after the decision
    this.jobs.register({ name: 'disputes.retention', intervalMs: 24 * 60 * 60_000, run: () => this.privacy.purgeCaseFiles() });
    this.jobs.register({ name: 'disputes.response_deadlines', intervalMs: 5 * 60_000, run: () => this.disputes.startOverdueReviews() });
  }
}
