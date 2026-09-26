import { Controller, Get } from '@nestjs/common';
import { AuctionsService } from './auctions.service';

// TODO(FR-23–FR-34): Server-authoritative bidding, proxy bids, anti-sniping, reserve price
@Controller('auctions')
export class AuctionsController {
  constructor(private readonly auctionsService: AuctionsService) {}

  @Get('health')
  health() {
    return { module: 'auctions', status: 'scaffolded', requirements: 'FR-23–FR-34' };
  }
}
