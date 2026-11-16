import { AuctionsStaffController } from './http/auctions-staff.controller';
import { AuctionStaffService } from './services/auction-staff.service';
import { ShillDetector } from './services/shill-detector.service';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdentityModule } from '../identity/identity.module';
import { AUCTION_BLOCKS, ForwardedBlocks } from './adapters/blocks';
import { ForwardedProStatus, LISTING_PRO_STATUS } from './adapters/pro-status';
import { AUCTION_ORDERS, ForwardedAuctionOrders } from './adapters/orders';
import { ENTITIES } from './db/entities';
import { AuctionsController } from './http/auctions.controller';
import { SearchController } from './http/search.controller';
import { CategoriesController, ListingPhotosController, ListingsController, MyListingsController } from './http/listings.controller';
import { AuctionsJobs } from './jobs/auctions.jobs';
import { AUCTION_QUERY, LISTINGS_COMMANDS, LISTINGS_PORT, LISTINGS_QUERIES } from './ports';
import { ListingCommandsService } from './services/listing-commands.service';
import { ListingsQueriesService } from './services/listings-queries.service';
import { AuctionCloser } from './services/auction-closer.service';
import { BidService } from './services/bid.service';
import { ListingService } from './services/listing.service';
import { MediaPipeline } from './services/media';
import { ScreeningService } from './services/screening.service';
import { SearchService } from './services/search.service';
import { SecondChanceService } from './services/second-chance.service';
import { StockService } from './services/stock.service';
import { FeaturedConsumers } from './services/featured.consumers';

// Unit 3 (docs/design/03_listings_auctions.pdf). Schemas: listings, auctions.
// Folder layout and rules: BUILDING.md section 3. This module exports only its ports (ports/),
// and imports other units only through their ports (DC-1; enforced by .eslintrc.js).
// Repositories (DC-2) are TypeORM's, injected with @InjectRepository(Entity) inside this unit only.
@Module({
  imports: [TypeOrmModule.forFeature(ENTITIES), IdentityModule],
  controllers: [AuctionsStaffController, CategoriesController, ListingsController, MyListingsController, ListingPhotosController, AuctionsController, SearchController],
  providers: [
    AuctionCloser,
    AuctionStaffService,
    AuctionsJobs,
    BidService,
    FeaturedConsumers,
    ListingService,
    ListingCommandsService,
    ListingsQueriesService,
    MediaPipeline,
    ScreeningService,
    SearchService,
    SecondChanceService,
    ShillDetector,
    StockService,
    { provide: AUCTION_ORDERS, useClass: ForwardedAuctionOrders },
    { provide: AUCTION_BLOCKS, useClass: ForwardedBlocks },
    { provide: LISTING_PRO_STATUS, useClass: ForwardedProStatus },
    { provide: LISTINGS_PORT, useExisting: StockService },
    { provide: AUCTION_QUERY, useExisting: BidService },
    { provide: LISTINGS_QUERIES, useExisting: ListingsQueriesService },
    { provide: LISTINGS_COMMANDS, useExisting: ListingCommandsService },
  ],
  exports: [LISTINGS_PORT, AUCTION_QUERY, LISTINGS_QUERIES, LISTINGS_COMMANDS],
})
export class ListingsModule {}
