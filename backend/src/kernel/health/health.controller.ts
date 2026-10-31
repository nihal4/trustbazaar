import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { Public } from '../http/policies';
import type { Response } from 'express';
import { HealthService } from './health.service';

// GET /api/v1/health/live and /api/v1/health/ready (NFR-OBS-01; docs/design/09_integration.pdf,
// section 5.2). Compose uses ready for the backend's health check (DV-61). The answer is only a status:
// which dependency failed goes to the log, not to whoever asks. Public: Compose calls them without a session.
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response): Promise<{ status: 'ok' | 'unavailable' }> {
    const { ready } = await this.health.readiness();
    res.status(ready ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return { status: ready ? 'ok' : 'unavailable' };
  }
}
