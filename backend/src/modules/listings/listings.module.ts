import { Module } from '@nestjs/common';
import { ListingsController } from './listings.controller';
import { ListingsService } from './listings.service';

// Listing creation (fixed/auction), search and discovery (FR-LST-01–FR-LST-13, FR-SRC-01–FR-SRC-06)
@Module({
  controllers: [ListingsController],
  providers: [ListingsService],
  exports: [ListingsService],
})
export class ListingsModule {}
