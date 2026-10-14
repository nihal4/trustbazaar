import { Controller, Get } from '@nestjs/common';
import { ListingsService } from './listings.service';

// TODO(FR-LST-01–FR-LST-13, FR-SRC-01–FR-SRC-06): Listing creation (fixed/auction), search and discovery
@Controller('listings')
export class ListingsController {
  constructor(private readonly listingsService: ListingsService) {}

  @Get('health')
  health() {
    return { module: 'listings', status: 'scaffolded', requirements: 'FR-LST-01–FR-LST-13, FR-SRC-01–FR-SRC-06' };
  }
}
