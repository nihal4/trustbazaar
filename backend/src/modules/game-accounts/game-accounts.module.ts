import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatModule } from '../chat/chat.module';
import { IdentityModule } from '../identity/identity.module';
import { ListingsModule } from '../listings/listings.module';
import { OrdersModule } from '../orders/orders.module';
import { ENTITIES } from './db/entities';
import { GameAccountsController } from './http/game-accounts.controller';
import { HandoverController } from './http/handover.controller';
import { ClaimConsumers } from './consumers/claim.consumers';
import { HandoverConsumers } from './consumers/handover.consumers';
import { ForwardedDisputes, GAME_DISPUTES } from './adapters/disputes';
import { GAME_DATA_EXPORT, GAME_ACCOUNT_COMMANDS, GAME_ACCOUNT_PORT, GAME_ACCOUNT_QUERIES, GameAccountCommands, GameAccountQueries } from './ports';
import { TakeoverService } from './services/takeover.service';
import { GameJobsService } from './services/game-jobs.service';
import { GameJobs } from './jobs/game.jobs';
import { HandoverService } from './services/handover.service';
import { OwnershipReviewService } from './services/ownership-review.service';
import { OwnershipService } from './services/ownership.service';
import { GameAccountsDataExport } from './services/data-export';

// Unit 5 (docs/design/05_game_accounts.pdf). Schemas: game_accounts.
// Folder layout and rules: BUILDING.md section 3. This module exports only its ports (ports/),
// and imports other units only through their ports (DC-1; enforced by .eslintrc.js).
// Repositories (DC-2) are TypeORM's, injected with @InjectRepository(Entity) inside this unit only.
// Two ports cross the import order on first use (ModuleRef): Unit 2 finds GAME_ACCOUNT_PORT, since this unit imports
// Unit 2; this unit finds Unit 7's DISPUTE_COMMANDS, since Unit 7 imports this unit.
@Module({
  imports: [TypeOrmModule.forFeature(ENTITIES), IdentityModule, ListingsModule, OrdersModule, ChatModule],
  controllers: [GameAccountsController, HandoverController],
  providers: [
    GameAccountsDataExport,
    { provide: GAME_DATA_EXPORT, useExisting: GameAccountsDataExport },
    OwnershipService,
    OwnershipReviewService,
    ClaimConsumers,
    HandoverService,
    HandoverConsumers,
    { provide: GAME_ACCOUNT_PORT, useExisting: HandoverService },
    TakeoverService,
    GameJobsService,
    GameJobs,
    { provide: GAME_DISPUTES, useClass: ForwardedDisputes }, // Unit 7's DisputeCommands
    {
      provide: GAME_ACCOUNT_COMMANDS,
      inject: [OwnershipReviewService, TakeoverService],
      useFactory: (r: OwnershipReviewService, t: TakeoverService): GameAccountCommands => ({
        reviewProof: (...a) => r.reviewProof(...a),
        disputeWithdrawn: (...a) => t.disputeWithdrawn(...a),
      }),
    },
    {
      provide: GAME_ACCOUNT_QUERIES,
      inject: [OwnershipReviewService, TakeoverService],
      useFactory: (r: OwnershipReviewService, t: TakeoverService): GameAccountQueries => ({
        proofQueue: (...a) => r.proofQueue(...a),
        credentialsInvalidAllowed: (...a) => t.credentialsInvalidAllowed(...a),
        evidence: (...a) => t.evidence(...a),
      }),
    },
  ],
  exports: [GAME_DATA_EXPORT, GAME_ACCOUNT_COMMANDS, GAME_ACCOUNT_QUERIES, GAME_ACCOUNT_PORT],
})
export class GameAccountsModule {}
