import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdentityModule } from '../identity/identity.module';
import { ENTITIES } from './db/entities';
import { CategoriesController, ListingPhotosController, ListingsController, MyListingsController } from './http/listings.controller';
import { LISTINGS_PORT } from './ports';
import { IdempotencyKeys } from './services/idempotency';
import { ListingService } from './services/listing.service';
import { MediaPipeline } from './services/media';
import { ScreeningService } from './services/screening.service';
import { StockService } from './services/stock.service';

// Unit 3 (docs/design/03_listings_auctions.pdf). Schemas: listings, auctions.
// Folder layout and rules: BUILDING.md section 3. This module exports only its ports (ports/),
// and imports other units only through their ports (DC-1; enforced by .eslintrc.js).
// Repositories (DC-2) are TypeORM's, injected with @InjectRepository(Entity) inside this unit only.
@Module({
  imports: [TypeOrmModule.forFeature(ENTITIES), IdentityModule],
  controllers: [CategoriesController, ListingsController, MyListingsController, ListingPhotosController],
  providers: [
    ListingService,
    MediaPipeline,
    ScreeningService,
    IdempotencyKeys,
    StockService,
    { provide: LISTINGS_PORT, useExisting: StockService },
  ],
  exports: [LISTINGS_PORT],
})
export class ListingsModule {}
