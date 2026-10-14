import { Controller, Get } from '@nestjs/common';
import { PaymentsService } from './payments.service';

// TODO(FR-PAY-01–FR-PAY-21, FR-MON-01–FR-MON-10): Payment collection, escrow settlement, commission/delivery-margin calculation
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get('health')
  health() {
    return { module: 'payments', status: 'scaffolded', requirements: 'FR-PAY-01–FR-PAY-21, FR-MON-01–FR-MON-10' };
  }
}
