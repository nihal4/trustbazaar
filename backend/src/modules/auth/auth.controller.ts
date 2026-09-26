import { Controller, Get } from '@nestjs/common';
import { AuthService } from './auth.service';

// TODO(FR-1–FR-9): Registration, login, JWT issuance
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('health')
  health() {
    return { module: 'auth', status: 'scaffolded', requirements: 'FR-1–FR-9' };
  }
}
