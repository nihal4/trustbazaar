import { Controller, Get } from '@nestjs/common';
import { DisputesService } from './disputes.service';

// TODO(FR-69–FR-73): Buyer-initiated dispute flow, freezes escrow release
@Controller('disputes')
export class DisputesController {
  constructor(private readonly disputesService: DisputesService) {}

  @Get('health')
  health() {
    return { module: 'disputes', status: 'scaffolded', requirements: 'FR-69–FR-73' };
  }
}
