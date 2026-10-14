import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

// Registration, login, JWT issuance (FR-ACC-01–FR-ACC-09, SEC-AUTH, SEC-SES)
@Module({
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
