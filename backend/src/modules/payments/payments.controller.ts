import { Controller, Get } from '@nestjs/common';
import { PaymentsService } from './payments.service';

// TODO(FR-39–FR-49, FR-78–FR-86): Payment collection, escrow settlement, commission/delivery-margin calculation
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get('health')
  health() {
    return { module: 'payments', status: 'scaffolded', requirements: 'FR-39–FR-49, FR-78–FR-86' };
  }
}
