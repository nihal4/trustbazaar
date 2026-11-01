import { Body, Controller, Delete, Get, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Public, RateLimit, SignedIn, StepUp } from '../../../kernel/http/policies';
import { CurrentPrincipal, Principal } from '../../../kernel/http/principal';
import { Problem } from '../../../kernel/http/problems';
import { ContactService, Me } from '../services/contact.service';
import { MfaService } from '../services/mfa.service';
import { PasswordService } from '../services/password.service';
import { StepUpService, StepUpStart } from '../services/step-up.service';
import { CodeDto, EmailChangeDto, MfaDisableDto, PasswordChangeDto, PasswordForgotDto, PasswordResetDto, PhoneChangeDto, StepUpStartDto, StepUpVerifyDto } from './auth.dto';
import { ctxOf } from './request';

// Step-up, password reset and change, contact changes (Unit 1 sections 4.2, 6.3 to 6.5; U1-05).
const userOf = (p: Principal) => {
  if (p.type !== 'user') throw new Problem('forbidden');
  return p;
};

@Controller()
export class AccountController {
  constructor(
    private readonly stepUp: StepUpService,
    private readonly passwords: PasswordService,
    private readonly contacts: ContactService,
    private readonly mfa: MfaService,
  ) {}

  /** I-51 (c): who is signed in; also the web client's refresh probe, so it has no rate-limit rule (U1-13). */
  @SignedIn()
  @Get('me')
  me(@CurrentPrincipal() p: Principal): Promise<Me> {
    return this.contacts.me(userOf(p).userId);
  }

  /** SEC-AUTH-08: begin step-up for one action; {method: 'totp'} or an SMS code ({method: 'sms'}). */
  @SignedIn()
  @RateLimit('otp-send')
  @Post('auth/step-up/start')
  @HttpCode(200)
  start(@Body() dto: StepUpStartDto, @CurrentPrincipal() p: Principal): Promise<StepUpStart> {
    const u = userOf(p);
    return this.stepUp.start(u.userId, u.sessionId, dto.action);
  }

  /** SEC-AUTH-08: a single-use grant for the X-Step-Up header, for this action in this session. */
  @SignedIn()
  @RateLimit('otp-verify')
  @Post('auth/step-up/verify')
  @HttpCode(200)
  verify(@Body() dto: StepUpVerifyDto, @CurrentPrincipal() p: Principal, @Req() req: Request) {
    const u = userOf(p);
    return this.stepUp.verify(u.userId, u.sessionId, dto.action, dto.code, ctxOf(req));
  }

  /** FR-ACC-07: always 202. */
  @Public()
  @RateLimit('reset')
  @Post('auth/password/forgot')
  @HttpCode(202)
  async forgot(@Body() dto: PasswordForgotDto): Promise<void> {
    await this.passwords.forgot(dto.login);
  }

  /** SEC-AUTH-10: ends every session of the account. */
  @Public()
  @RateLimit('token')
  @Post('auth/password/reset')
  @HttpCode(204)
  async reset(@Body() dto: PasswordResetDto, @Req() req: Request): Promise<void> {
    const proof = dto.token !== undefined ? { token: dto.token } : { phone: dto.phone!, code: dto.code! };
    await this.passwords.reset(proof, dto.newPassword, dto.mfaCode, ctxOf(req));
  }

  /** SEC-AUTH-11: ends every other session. */
  @SignedIn()
  @StepUp('password.change')
  @Post('auth/password/change')
  @HttpCode(204)
  async change(@Body() dto: PasswordChangeDto, @CurrentPrincipal() p: Principal, @Req() req: Request): Promise<void> {
    const u = userOf(p);
    await this.passwords.change(u.userId, u.sessionId, dto.currentPassword, dto.newPassword, ctxOf(req));
  }

  /** FR-ACC-09: an SMS code to the new number. */
  @SignedIn()
  @StepUp('phone.change')
  @RateLimit('otp-send')
  @Post('me/phone/change')
  @HttpCode(202)
  phone(@Body() dto: PhoneChangeDto, @CurrentPrincipal() p: Principal) {
    const u = userOf(p);
    return this.contacts.startPhoneChange(u.userId, u.sessionId, dto.phone);
  }

  /** FR-ACC-09: the code replaces the number. */
  @SignedIn()
  @RateLimit('otp-verify')
  @Post('me/phone/change/verify')
  @HttpCode(204)
  async phoneVerify(@Body() dto: CodeDto, @CurrentPrincipal() p: Principal, @Req() req: Request): Promise<void> {
    const u = userOf(p);
    await this.contacts.verifyPhoneChange(u.userId, u.sessionId, dto.code, ctxOf(req));
  }

  /** FR-ACC-09: a link to the new address; it is used through /auth/email/verify. */
  @SignedIn()
  @StepUp('email.change')
  @RateLimit('token')
  @Post('me/email/change')
  @HttpCode(202)
  async email(@Body() dto: EmailChangeDto, @CurrentPrincipal() p: Principal): Promise<void> {
    await this.contacts.startEmailChange(userOf(p).userId, dto.email);
  }

  /** FR-ACC-06: start TOTP enrolment; the otpauth:// URI is shown as a QR code (U1-12). */
  @SignedIn()
  @Post('me/mfa/totp')
  @HttpCode(201)
  startTotp(@CurrentPrincipal() p: Principal, @Req() req: Request) {
    return this.mfa.start(userOf(p).userId, ctxOf(req));
  }

  /** FR-ACC-06: confirm with the first code; MFA is on and the recovery codes are shown once. */
  @SignedIn()
  @RateLimit('otp-verify')
  @Post('me/mfa/totp/confirm')
  @HttpCode(200)
  confirmTotp(@CurrentPrincipal() p: Principal, @Body() dto: CodeDto, @Req() req: Request) {
    return this.mfa.confirm(userOf(p).userId, dto.code, ctxOf(req));
  }

  /** SEC-AUTH-01: turn MFA off (step-up, a current TOTP code, and a 15-character password if needed). */
  @SignedIn()
  @StepUp('mfa.disable')
  @Delete('me/mfa/totp')
  @HttpCode(204)
  async disableTotp(@CurrentPrincipal() p: Principal, @Body() dto: MfaDisableDto, @Req() req: Request): Promise<void> {
    const u = userOf(p);
    await this.mfa.disable(u.userId, u.sessionId, dto.code, dto.newPassword, ctxOf(req));
  }

  /** FR-ACC-06: ten new recovery codes after step-up; the old ones stop working. */
  @SignedIn()
  @StepUp('recovery.regenerate')
  @Post('me/mfa/recovery-codes')
  @HttpCode(200)
  regenerateCodes(@CurrentPrincipal() p: Principal, @Req() req: Request) {
    return this.mfa.regenerate(userOf(p).userId, ctxOf(req));
  }
}
