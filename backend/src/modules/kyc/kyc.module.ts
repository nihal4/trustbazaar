import { Module } from '@nestjs/common';
import { KycController } from './kyc.controller';
import { KycService } from './kyc.service';

// KYC document submission and operator review queue (FR-KYC-01–FR-KYC-12)
@Module({
  controllers: [KycController],
  providers: [KycService],
  exports: [KycService],
})
export class KycModule {}
