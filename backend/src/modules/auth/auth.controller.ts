import { Controller, Get } from '@nestjs/common';
import { AuthService } from './auth.service';

// TODO(FR-ACC-01–FR-ACC-09, SEC-AUTH, SEC-SES): Registration, login, JWT issuance
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('health')
  health() {
    return { module: 'auth', status: 'scaffolded', requirements: 'FR-ACC-01–FR-ACC-09, SEC-AUTH, SEC-SES' };
  }
}
