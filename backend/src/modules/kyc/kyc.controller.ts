import { Controller, Get } from '@nestjs/common';
import { KycService } from './kyc.service';

// TODO(FR-KYC-01–FR-KYC-12): KYC document submission and operator review queue
@Controller('kyc')
export class KycController {
  constructor(private readonly kycService: KycService) {}

  @Get('health')
  health() {
    return { module: 'kyc', status: 'scaffolded', requirements: 'FR-KYC-01–FR-KYC-12' };
  }
}
