import { Controller, Get } from '@nestjs/common';
import { UsersService } from './users.service';

// TODO(FR-ACC-08–FR-ACC-11, FR-PRV-01–FR-PRV-06): User profile management
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('health')
  health() {
    return { module: 'users', status: 'scaffolded', requirements: 'FR-ACC-08–FR-ACC-11, FR-PRV-01–FR-PRV-06' };
  }
}
