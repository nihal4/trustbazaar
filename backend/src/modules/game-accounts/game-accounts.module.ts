import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdentityModule } from '../identity/identity.module';
import { ListingsModule } from '../listings/listings.module';
import { ENTITIES } from './db/entities';
import { GameAccountsController } from './http/game-accounts.controller';
import { OwnershipService } from './services/ownership.service';

// Unit 5 (docs/design/05_game_accounts.pdf). Schemas: game_accounts.
// Folder layout and rules: BUILDING.md section 3. This module exports only its ports (ports/),
// and imports other units only through their ports (DC-1; enforced by .eslintrc.js).
// Repositories (DC-2) are TypeORM's, injected with @InjectRepository(Entity) inside this unit only.
@Module({
  imports: [TypeOrmModule.forFeature(ENTITIES), IdentityModule, ListingsModule],
  controllers: [GameAccountsController],
  providers: [OwnershipService],
  exports: [],
})
export class GameAccountsModule {}
