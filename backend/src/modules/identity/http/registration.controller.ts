import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public, RateLimit } from '../../../kernel/http/policies';
import { ContactService } from '../services/contact.service';
import { RegistrationService, RegistrationStarted } from '../services/registration.service';
import { EmailVerifyDto, RegisterDto, RegisterVerifyDto, RegistrationIdDto } from './auth.dto';
import { cookie, ctxOf } from './request';
import { DEVICE_COOKIE, setSessionCookies } from './session-cookies';

// Registration and e-mail verification (Unit 1 sections 4.2 and 6.1, U1-03). Paths under /api/v1/auth.
@Controller('auth')
export class RegistrationController {
  constructor(
    private readonly registration: RegistrationService,
    private readonly contacts: ContactService,
  ) {}

  /** FR-ACC-01: 202 with the registration id and when a new code may be asked for; the same for every number. */
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
  resend(@Body() dto: RegistrationIdDto): Promise<RegistrationStarted> {
    return this.registration.resend(dto.registrationId);
  }

  /** FR-ACC-02: the code creates the account; 204 with the new session's cookies. */
  @Public()
  @RateLimit('otp-verify')
  @Post('register/verify')
  @HttpCode(204)
  async verify(@Body() dto: RegisterVerifyDto, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    setSessionCookies(res, await this.registration.verify(dto.registrationId, dto.code, cookie(req, DEVICE_COOKIE), ctxOf(req)));
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
