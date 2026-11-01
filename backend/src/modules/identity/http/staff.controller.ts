import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Credential, Public, RateLimit, Staff } from '../../../kernel/http/policies';
import { CurrentPrincipal, Principal } from '../../../kernel/http/principal';
import { Problem } from '../../../kernel/http/problems';
import { ApprovalService } from '../services/approval.service';
import { AuditService } from '../services/audit.service';
import { SessionService } from '../services/session.service';
import { STAFF_ENROL_TICKET_SECONDS, STAFF_MFA_TICKET_SECONDS, StaffAuthService } from '../services/staff-auth.service';
import { StaffService } from '../services/staff.service';
import { AuditQueryDto, ConflictDto, DecisionDto, MfaDto, NewStaffDto, ReasonDto, StaffEnrolDto, StaffSignInDto } from './auth.dto';
import { cookie, ctxOf } from './request';
import {
  clearStaffSessionCookies, setStaffSessionCookies, setStaffTicketCookie, STAFF_ENROL_COOKIE, STAFF_MFA_COOKIE, STAFF_REFRESH_COOKIE,
} from './session-cookies';

// Staff console API (Unit 1 sections 4.2 and 6.7 to 6.8; I-51). Staff sessions use their own cookies.
const staffOf = (p: Principal) => {
  if (p.type !== 'staff') throw new Problem('forbidden');
  return p;
};

/** Staff sign-in, MFA, first enrolment, refresh, sign-out and /staff/me (SEC-AUTH-07, I-51). */
@Controller('staff')
export class StaffAuthController {
  constructor(
    private readonly auth: StaffAuthService,
    private readonly sessions: SessionService,
  ) {}

  /** 200 {mfaRequired} with an MFA ticket, or 200 {enrolmentRequired} with an enrolment ticket (pending_mfa). */
  @Public()
  @RateLimit('signin')
  @Post('auth/signin')
  @HttpCode(200)
  async signIn(@Body() dto: StaffSignInDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const r = await this.auth.signIn(dto.email, dto.password, ctxOf(req));
    if (r.kind === 'enrol') {
      setStaffTicketCookie(res, STAFF_ENROL_COOKIE, r.ticket, STAFF_ENROL_TICKET_SECONDS * 1000);
      return { enrolmentRequired: true };
    }
    setStaffTicketCookie(res, STAFF_MFA_COOKIE, r.ticket, STAFF_MFA_TICKET_SECONDS * 1000);
    return { mfaRequired: true };
  }

  /** SEC-AUTH-07: the TOTP code; 204 with the staff session's cookies. */
  @Credential('mfa-ticket')
  @RateLimit('otp-verify')
  @Post('auth/mfa')
  @HttpCode(204)
  async mfa(@Body() dto: MfaDto, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    setStaffSessionCookies(res, await this.auth.verifyMfa(cookie(req, STAFF_MFA_COOKIE), dto.code, ctxOf(req)));
  }

  /** Pending staff: a new password and a new TOTP secret ({otpauthUri, secret}) to add to an authenticator. */
  @Credential('pending-staff')
  @Post('auth/mfa/enrol')
  @HttpCode(200)
  enrol(@Body() dto: StaffEnrolDto, @Req() req: Request) {
    return this.auth.startEnrolment(cookie(req, STAFF_ENROL_COOKIE), dto.newPassword, ctxOf(req));
  }

  /** Pending staff: the first code confirms the authenticator; the account becomes active and is signed in. */
  @Credential('pending-staff')
  @RateLimit('otp-verify')
  @Post('auth/mfa/enrol/confirm')
  @HttpCode(204)
  async confirm(@Body() dto: MfaDto, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    setStaffSessionCookies(res, await this.auth.confirmEnrolment(cookie(req, STAFF_ENROL_COOKIE), dto.code, ctxOf(req)));
  }

  /** SEC-SES-02, I-51: staff refresh rotation on its own path and cookie. */
  @Credential('refresh-cookie')
  @RateLimit('refresh')
  @Post('auth/refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      const r = await this.sessions.refresh(cookie(req, STAFF_REFRESH_COOKIE), ctxOf(req), 'staff');
      if (r.kind === 'retry') throw new Problem('refresh-retry');
      setStaffSessionCookies(res, r.cookies);
      res.status(204);
    } catch (e) {
      if (e instanceof Problem && e.problem === 'session-ended') clearStaffSessionCookies(res);
      throw e;
    }
  }

  @Staff()
  @Post('auth/signout')
  @HttpCode(204)
  async signOut(@CurrentPrincipal() p: Principal, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const s = staffOf(p);
    await this.sessions.endStaff(s.staffId, s.sessionId, ctxOf(req));
    clearStaffSessionCookies(res);
  }

  /** I-51: who is signed in to the console (also the console's refresh probe). */
  @Staff()
  @Get('me')
  me(@CurrentPrincipal() p: Principal) {
    return this.auth.me(staffOf(p).staffId);
  }
}

/** Four-eyes approvals and conflicts of interest, for any staff role (FR-OPS-05, FR-OPS-06). */
@Controller('staff')
export class StaffController {
  constructor(
    private readonly approvals: ApprovalService,
    private readonly staff: StaffService,
  ) {}

  /** The open proposals for my role, never my own. */
  @Staff()
  @Get('approvals')
  open(@CurrentPrincipal() p: Principal) {
    const s = staffOf(p);
    return this.approvals.openFor(s.staffId, s.role);
  }

  @Staff()
  @Post('approvals/:id/decision')
  @HttpCode(200)
  decide(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisionDto, @CurrentPrincipal() p: Principal, @Req() req: Request) {
    const s = staffOf(p);
    return this.approvals.decide(id, { staffId: s.staffId, role: s.role }, dto.decision, dto.note, ctxOf(req));
  }

  @Staff()
  @Post('conflicts')
  @HttpCode(204)
  async conflict(@Body() dto: ConflictDto, @CurrentPrincipal() p: Principal, @Req() req: Request): Promise<void> {
    await this.staff.declareConflict(staffOf(p).staffId, dto.userId, dto.reason, ctxOf(req));
  }
}

/** Administrators only (FR-OPS-03): staff accounts and the read-only audit log (SEC-LOG-04). */
@Controller('admin')
export class AdminController {
  constructor(
    private readonly staff: StaffService,
    private readonly audit: AuditService,
  ) {}

  @Staff('administrator')
  @Get('staff')
  list() {
    return this.staff.list();
  }

  /** 201 with the account and its first password, shown this once. */
  @Staff('administrator')
  @Post('staff')
  create(@Body() dto: NewStaffDto, @CurrentPrincipal() p: Principal, @Req() req: Request) {
    return this.staff.create(staffOf(p).staffId, dto, ctxOf(req));
  }

  @Staff('administrator')
  @Post('staff/:id/disable')
  @HttpCode(200)
  disable(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto, @CurrentPrincipal() p: Principal, @Req() req: Request) {
    return this.staff.disable(staffOf(p).staffId, id, dto.reason, ctxOf(req));
  }

  /** Proposes staff.mfa_reset; a second administrator decides it under /staff/approvals. */
  @Staff('administrator')
  @Post('staff/:id/mfa-reset')
  @HttpCode(202)
  mfaReset(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto, @CurrentPrincipal() p: Principal, @Req() req: Request) {
    return this.staff.proposeMfaReset(staffOf(p).staffId, id, dto.reason, ctxOf(req));
  }

  @Staff('administrator')
  @Get('audit')
  read(@Query() q: AuditQueryDto) {
    return this.audit.list({
      actorId: q.actorId, objectId: q.objectId, action: q.action, before: q.before,
      from: q.from ? new Date(q.from) : undefined, to: q.to ? new Date(q.to) : undefined, limit: q.limit ? Number(q.limit) : undefined,
    });
  }

  /** SEC-LOG-02: recomputes the whole chain. */
  @Staff('administrator')
  @Get('audit/verify')
  verify() {
    return this.audit.verifyChain();
  }
}
