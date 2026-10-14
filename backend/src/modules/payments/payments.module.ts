import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

// Payment collection, escrow settlement, commission/delivery-margin calculation (FR-PAY-01–FR-PAY-21, FR-MON-01–FR-MON-10)
@Module({
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
