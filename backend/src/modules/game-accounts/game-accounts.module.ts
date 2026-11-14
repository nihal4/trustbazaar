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
import { GAME_ACCOUNT_COMMANDS, GAME_ACCOUNT_PORT, GAME_ACCOUNT_QUERIES } from './ports';
import { HandoverService } from './services/handover.service';
import { OwnershipReviewService } from './services/ownership-review.service';
import { OwnershipService } from './services/ownership.service';

// Unit 5 (docs/design/05_game_accounts.pdf). Schemas: game_accounts.
// Folder layout and rules: BUILDING.md section 3. This module exports only its ports (ports/),
// and imports other units only through their ports (DC-1; enforced by .eslintrc.js).
// Repositories (DC-2) are TypeORM's, injected with @InjectRepository(Entity) inside this unit only.
// Unit 2 does not import this module: it finds GAME_ACCOUNT_PORT on first use (ModuleRef), since this unit imports it.
@Module({
  imports: [TypeOrmModule.forFeature(ENTITIES), IdentityModule, ListingsModule, OrdersModule, ChatModule],
  controllers: [GameAccountsController, HandoverController],
  providers: [
    OwnershipService,
    OwnershipReviewService,
    ClaimConsumers,
    HandoverService,
    HandoverConsumers,
    { provide: GAME_ACCOUNT_PORT, useExisting: HandoverService },
    { provide: GAME_ACCOUNT_COMMANDS, useExisting: OwnershipReviewService },
    { provide: GAME_ACCOUNT_QUERIES, useExisting: OwnershipReviewService },
  ],
  exports: [GAME_ACCOUNT_COMMANDS, GAME_ACCOUNT_QUERIES, GAME_ACCOUNT_PORT],
})
export class GameAccountsModule {}
