import { Controller, Get } from '@nestjs/common';
import { DeliveryService } from './delivery.service';

// TODO(FR-50–FR-58): Distance computation, self-pickup vs courier decision, fare split
@Controller('delivery')
export class DeliveryController {
  constructor(private readonly deliveryService: DeliveryService) {}

  @Get('health')
  health() {
    return { module: 'delivery', status: 'scaffolded', requirements: 'FR-50–FR-58' };
  }
}
