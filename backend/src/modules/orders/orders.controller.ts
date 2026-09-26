import { Controller, Get } from '@nestjs/common';
import { OrdersService } from './orders.service';

// TODO(FR-35–FR-38): Fixed-price purchase with concurrency-safe stock decrement
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get('health')
  health() {
    return { module: 'orders', status: 'scaffolded', requirements: 'FR-35–FR-38' };
  }
}
