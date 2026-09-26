import { Controller, Get } from '@nestjs/common';
import { KycService } from './kyc.service';

// TODO(FR-1–FR-9): KYC document submission and operator review queue
@Controller('kyc')
export class KycController {
  constructor(private readonly kycService: KycService) {}

  @Get('health')
  health() {
    return { module: 'kyc', status: 'scaffolded', requirements: 'FR-1–FR-9' };
  }
}
