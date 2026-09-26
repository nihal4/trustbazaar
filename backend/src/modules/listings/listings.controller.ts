import { Controller, Get } from '@nestjs/common';
import { ListingsService } from './listings.service';

// TODO(FR-10–FR-22): Listing creation (fixed/auction), search and discovery
@Controller('listings')
export class ListingsController {
  constructor(private readonly listingsService: ListingsService) {}

  @Get('health')
  health() {
    return { module: 'listings', status: 'scaffolded', requirements: 'FR-10–FR-22' };
  }
}
