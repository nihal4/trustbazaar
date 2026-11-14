import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdentityModule } from '../identity/identity.module';
import { ListingsModule } from '../listings/listings.module';
import { ENTITIES } from './db/entities';
import { GameAccountsController } from './http/game-accounts.controller';
import { ClaimConsumers } from './consumers/claim.consumers';
import { GAME_ACCOUNT_COMMANDS, GAME_ACCOUNT_QUERIES } from './ports';
import { OwnershipReviewService } from './services/ownership-review.service';
import { OwnershipService } from './services/ownership.service';

// Unit 5 (docs/design/05_game_accounts.pdf). Schemas: game_accounts.
// Folder layout and rules: BUILDING.md section 3. This module exports only its ports (ports/),
// and imports other units only through their ports (DC-1; enforced by .eslintrc.js).
// Repositories (DC-2) are TypeORM's, injected with @InjectRepository(Entity) inside this unit only.
@Module({
  imports: [TypeOrmModule.forFeature(ENTITIES), IdentityModule, ListingsModule],
  controllers: [GameAccountsController],
  providers: [
    OwnershipService,
    OwnershipReviewService,
    ClaimConsumers,
    { provide: GAME_ACCOUNT_COMMANDS, useExisting: OwnershipReviewService },
    { provide: GAME_ACCOUNT_QUERIES, useExisting: OwnershipReviewService },
  ],
  exports: [GAME_ACCOUNT_COMMANDS, GAME_ACCOUNT_QUERIES],
})
export class GameAccountsModule {}
