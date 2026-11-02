import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdentityModule } from '../identity/identity.module';
import { AUCTION_BLOCKS, ForwardedBlocks } from './adapters/blocks';
import { AUCTION_ORDERS, ForwardedAuctionOrders } from './adapters/orders';
import { ENTITIES } from './db/entities';
import { AuctionsController } from './http/auctions.controller';
import { SearchController } from './http/search.controller';
import { CategoriesController, ListingPhotosController, ListingsController, MyListingsController } from './http/listings.controller';
import { AuctionsJobs } from './jobs/auctions.jobs';
import { AUCTION_QUERY, LISTINGS_PORT, LISTINGS_QUERIES } from './ports';
import { ListingsQueriesService } from './services/listings-queries.service';
import { AuctionCloser } from './services/auction-closer.service';
import { BidService } from './services/bid.service';
import { ListingService } from './services/listing.service';
import { MediaPipeline } from './services/media';
import { ScreeningService } from './services/screening.service';
import { SearchService } from './services/search.service';
import { SecondChanceService } from './services/second-chance.service';
import { StockService } from './services/stock.service';

// Unit 3 (docs/design/03_listings_auctions.pdf). Schemas: listings, auctions.
// Folder layout and rules: BUILDING.md section 3. This module exports only its ports (ports/),
// and imports other units only through their ports (DC-1; enforced by .eslintrc.js).
// Repositories (DC-2) are TypeORM's, injected with @InjectRepository(Entity) inside this unit only.
@Module({
  imports: [TypeOrmModule.forFeature(ENTITIES), IdentityModule],
  controllers: [CategoriesController, ListingsController, MyListingsController, ListingPhotosController, AuctionsController, SearchController],
  providers: [
    AuctionCloser,
    AuctionsJobs,
    BidService,
    ListingService,
    ListingsQueriesService,
    MediaPipeline,
    ScreeningService,
    SearchService,
    SecondChanceService,
    StockService,
    { provide: AUCTION_ORDERS, useClass: ForwardedAuctionOrders },
    { provide: AUCTION_BLOCKS, useClass: ForwardedBlocks },
    { provide: LISTINGS_PORT, useExisting: StockService },
    { provide: AUCTION_QUERY, useExisting: BidService },
    { provide: LISTINGS_QUERIES, useExisting: ListingsQueriesService },
  ],
  exports: [LISTINGS_PORT, AUCTION_QUERY, LISTINGS_QUERIES],
})
export class ListingsModule {}
