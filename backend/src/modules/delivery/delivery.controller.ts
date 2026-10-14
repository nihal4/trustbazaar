import { Controller, Get } from '@nestjs/common';
import { DeliveryService } from './delivery.service';

// TODO(FR-DLV-01–FR-DLV-14): Distance computation, self-pickup vs courier decision, fare split
@Controller('delivery')
export class DeliveryController {
  constructor(private readonly deliveryService: DeliveryService) {}

  @Get('health')
  health() {
    return { module: 'delivery', status: 'scaffolded', requirements: 'FR-DLV-01–FR-DLV-14' };
  }
}
