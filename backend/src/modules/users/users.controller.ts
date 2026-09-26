import { Controller, Get } from '@nestjs/common';
import { UsersService } from './users.service';

// TODO(FR-1–FR-9): User profile management
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('health')
  health() {
    return { module: 'users', status: 'scaffolded', requirements: 'FR-1–FR-9' };
  }
}
