import { Module } from '@nestjs/common';
import { AuctionsController } from './auctions.controller';
import { AuctionsService } from './auctions.service';

// Server-authoritative bidding, proxy bids, anti-sniping, reserve price (FR-AUC-01–FR-AUC-18)
@Module({
  controllers: [AuctionsController],
  providers: [AuctionsService],
  exports: [AuctionsService],
})
export class AuctionsModule {}
