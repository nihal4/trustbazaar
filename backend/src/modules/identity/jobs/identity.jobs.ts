import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { JobRunner } from '../../../kernel/jobs/job-runner';
import { ApprovalService } from '../services/approval.service';
import { AuditService } from '../services/audit.service';

// Unit 1's scheduled jobs (docs/design/09_integration.pdf "Scheduled jobs": Unit 1 runs daily).
// The erasure after closure and the removal of rejected KYC images come with U1-09.
export const DAY_MS = 24 * 3_600_000;

@Injectable()
export class IdentityJobs implements OnModuleInit {
  private readonly log = new Logger('IdentityJobs');

  constructor(
    private readonly jobs: JobRunner,
    private readonly approvals: ApprovalService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    // DV-5: open proposals past their 72 hours become 'expired'. A decision on an expired one is refused
    // at once anyway; this job closes the ones nobody looks at.
    this.jobs.register({ name: 'identity.approvals.expire', intervalMs: DAY_MS, run: () => this.approvals.expireStale() });
    // SEC-LOG-02: the whole hash chain is recomputed; a break is reported to the operators (SEC-LOG-05).
    this.jobs.register({
      name: 'identity.audit.verify',
      intervalMs: DAY_MS,
      run: async () => {
        const r = await this.audit.verifyChain();
        if (!r.intact) {
          this.log.error(`audit hash chain broken at entry ${r.firstBadId} (SEC-LOG-02)`);
          throw new Error(`audit hash chain broken at entry ${r.firstBadId}`);
        }
        return r.entries;
      },
    });
  }
}
