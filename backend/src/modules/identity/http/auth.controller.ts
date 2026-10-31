import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { correlationId } from '../../../kernel/http/correlation';
import { Credential, Public, RateLimit, SignedIn } from '../../../kernel/http/policies';
import { CurrentPrincipal, Principal } from '../../../kernel/http/principal';
import { Problem } from '../../../kernel/http/problems';
import { MFA_TICKET_SECONDS, SignInService } from '../services/signin.service';
import { RequestContext, SessionService, SessionSummary } from '../services/session.service';
import { MfaDto, SignInDto } from './auth.dto';
import { clearSessionCookies, DEVICE_COOKIE, MFA_COOKIE, REFRESH_COOKIE, setMfaCookie, setSessionCookies } from './session-cookies';

// Sign-in, MFA, refresh, sign-out and sessions (Unit 1 section 4.2, U1-04). Paths under /api/v1/auth.
const ctxOf = (req: Request): RequestContext => ({
  ip: req.ip ?? null,
  userAgent: req.header('user-agent') ?? null,
  correlationId: correlationId(req),
});
const cookie = (req: Request, name: string): string | undefined => {
  const v = (req.cookies as Record<string, unknown> | undefined)?.[name];
  return typeof v === 'string' && v !== '' ? v : undefined;
};
const userOf = (p: Principal) => {
  if (p.type !== 'user') throw new Problem('forbidden');
  return p;
};

@Controller('auth')
export class AuthController {
  constructor(
    private readonly signin: SignInService,
    private readonly sessions: SessionService,
  ) {}

  /** FR-ACC-05: 204 with the session's cookies, or 200 {mfaRequired} with an MFA ticket cookie. */
  @Public()
  @RateLimit('signin')
  @Post('signin')
  async signIn(@Body() dto: SignInDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const r = await this.signin.signIn(dto.login, dto.password, cookie(req, DEVICE_COOKIE), ctxOf(req));
    if (r.kind === 'mfa') {
      setMfaCookie(res, r.ticket, MFA_TICKET_SECONDS * 1000);
      res.status(200);
      return { mfaRequired: true };
    }
    setSessionCookies(res, r.cookies);
    res.status(204);
  }

  /** FR-ACC-06: the second factor, with the ticket from the password step. */
  @Credential('mfa-ticket')
  @RateLimit('otp-verify')
  @Post('signin/mfa')
  @HttpCode(204)
  async mfa(@Body() dto: MfaDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    setSessionCookies(res, await this.signin.verifyMfa(cookie(req, MFA_COOKIE), dto.code, cookie(req, DEVICE_COOKIE), ctxOf(req)));
  }

  /** SEC-SES-02: rotate the refresh token. 409 when another tab rotated it a moment ago; 401 ends it. */
  @Credential('refresh-cookie')
  @RateLimit('refresh')
  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      const r = await this.sessions.refresh(cookie(req, REFRESH_COOKIE), ctxOf(req));
      if (r.kind === 'retry') throw new Problem('refresh-retry');
      setSessionCookies(res, r.cookies);
      res.status(204);
    } catch (e) {
      if (e instanceof Problem && e.problem === 'session-ended') clearSessionCookies(res);
      throw e;
    }
  }

  /** SEC-SES-05: end this session now. */
  @SignedIn()
  @Post('signout')
  @HttpCode(204)
  async signOut(@CurrentPrincipal() p: Principal, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const u = userOf(p);
    await this.sessions.end(u.userId, u.sessionId, 'logout', ctxOf(req));
    clearSessionCookies(res);
  }

  /** FR-ACC-08: the user's live sessions. */
  @SignedIn()
  @Get('sessions')
  list(@CurrentPrincipal() p: Principal): Promise<SessionSummary[]> {
    const u = userOf(p);
    return this.sessions.list(u.userId, u.sessionId);
  }

  /** FR-ACC-08: end one session; another user's session is not found (SEC-SDL-09). */
  @SignedIn()
  @Delete('sessions/:id')
  @HttpCode(204)
  async endOne(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const u = userOf(p);
    if (!(await this.sessions.end(u.userId, id, 'user_ended', ctxOf(req)))) throw new Problem('not-found');
    if (id === u.sessionId) clearSessionCookies(res);
  }

  /** FR-ACC-08: end every session except this one. */
  @SignedIn()
  @Post('sessions/end-others')
  @HttpCode(200)
  async endOthers(@CurrentPrincipal() p: Principal, @Req() req: Request) {
    const u = userOf(p);
    return { ended: await this.sessions.endOthers(u.userId, u.sessionId, ctxOf(req)) };
  }
}
