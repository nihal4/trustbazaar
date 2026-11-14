import { Injectable, OnModuleInit } from '@nestjs/common';
import { JobRunner } from '../../../kernel/jobs/job-runner';
import { GameJobsService } from '../services/game-jobs.service';

// Unit 5's scheduled jobs (docs/design/05_game_accounts.pdf section 8; U5-05). Each claims its rows so that several
// instances can run it (NFR-REL-03).
@Injectable()
export class GameJobs implements OnModuleInit {
  constructor(
    private readonly jobs: JobRunner,
    private readonly game: GameJobsService,
  ) {}

  onModuleInit(): void {
    this.jobs.register({ name: 'game_accounts.takeover_window_end', intervalMs: 60_000, run: () => this.game.completeDueTakeovers() });
    this.jobs.register({ name: 'game_accounts.rekey_overdue', intervalMs: 5 * 60_000, run: () => this.game.disputeOverdueRekeys() });
    this.jobs.register({ name: 'game_accounts.proof_expiry', intervalMs: 60 * 60_000, run: () => this.game.expireCodes() });
    this.jobs.register({ name: 'game_accounts.retention', intervalMs: 24 * 60 * 60_000, run: () => this.game.purge() });
  }
}
