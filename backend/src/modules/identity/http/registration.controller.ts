import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Public, RateLimit } from '../../../kernel/http/policies';
import { ContactService } from '../services/contact.service';
import { RegistrationService, RegistrationStarted } from '../services/registration.service';
import { EmailVerifyDto, RegisterCompleteDto, RegisterDto, RegisterResendDto, RegisterVerifyDto } from './auth.dto';
import { ctxOf } from './request';

// Registration (Unit 1 sections 4.2 and 6.1, U1-03; U10-25: name, e-mail, password, e-mail code, then number and terms) and the e-mail link. Paths under /api/v1/auth.
@Controller('auth')
export class RegistrationController {
  constructor(
    private readonly registration: RegistrationService,
    private readonly contacts: ContactService,
  ) {}

  /** FR-ACC-01: 202 with the registration id and when a new code may be asked for; the same for every address. */
  @Public()
  @RateLimit('register')
  @Post('register')
  @HttpCode(202)
  register(@Body() dto: RegisterDto, @Req() req: Request): Promise<RegistrationStarted> {
    return this.registration.register(dto, ctxOf(req));
  }

  /** SEC-AUTH-09: a new code; the previous one stops working. */
  @Public()
  @RateLimit('otp-send')
  @Post('register/resend')
  @HttpCode(202)
  resend(@Body() dto: RegisterResendDto): Promise<RegistrationStarted> {
    return this.registration.resend(dto.registrationId);
  }

  /** FR-ACC-02: the code confirms the e-mail address; 204, no account yet and no session. */
  @Public()
  @RateLimit('otp-verify')
  @Post('register/verify')
  @HttpCode(204)
  async verify(@Body() dto: RegisterVerifyDto): Promise<void> {
    await this.registration.verify(dto.registrationId, dto.code);
  }

  /** FR-ACC-01, FR-ACC-04: the number, the age confirmation and the accepted terms create the account; 204, the person signs in next. */
  @Public()
  @RateLimit('otp-verify')
  @Post('register/complete')
  @HttpCode(204)
  async complete(@Body() dto: RegisterCompleteDto, @Req() req: Request): Promise<void> {
    await this.registration.complete(dto, ctxOf(req));
  }

  /** FR-ACC-02, FR-ACC-09: the single-use link from a verification or e-mail change message. */
  @Public()
  @RateLimit('token')
  @Post('email/verify')
  @HttpCode(204)
  async verifyEmail(@Body() dto: EmailVerifyDto, @Req() req: Request): Promise<void> {
    await this.contacts.verifyEmail(dto.token, ctxOf(req));
  }
}
