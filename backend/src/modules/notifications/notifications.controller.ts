import { Controller, Get } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

// TODO(FR-74–FR-77): Real-time and async notification dispatch
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('health')
  health() {
    return { module: 'notifications', status: 'scaffolded', requirements: 'FR-74–FR-77' };
  }
}
