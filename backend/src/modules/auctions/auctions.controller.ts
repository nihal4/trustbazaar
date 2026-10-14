import { Controller, Get } from '@nestjs/common';
import { AuctionsService } from './auctions.service';

// TODO(FR-AUC-01–FR-AUC-18): Server-authoritative bidding, proxy bids, anti-sniping, reserve price
@Controller('auctions')
export class AuctionsController {
  constructor(private readonly auctionsService: AuctionsService) {}

  @Get('health')
  health() {
    return { module: 'auctions', status: 'scaffolded', requirements: 'FR-AUC-01–FR-AUC-18' };
  }
}
