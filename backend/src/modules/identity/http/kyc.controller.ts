import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, Res, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { Credential, RateLimit, SignedIn, Staff } from '../../../kernel/http/policies';
import { CurrentPrincipal, Principal } from '../../../kernel/http/principal';
import { Problem } from '../../../kernel/http/problems';
import { MAX_UPLOAD_BYTES } from '../crypto/images';
import { KycReviewService } from '../services/kyc-review.service';
import { KycFileKind, KycService } from '../services/kyc.service';
import { BlacklistDto, KycDecisionDto, KycSubmissionDto, ReasonDto } from './auth.dto';
import { ctxOf } from './request';

// KYC (Unit 1 sections 4.2, 6.6 and 6.7, U1-06): the user's submission and status, the operators' review,
// revocation and blacklist proposals, and the signed file links.
const KINDS: KycFileKind[] = ['doc_front', 'doc_back', 'passport_photo_page', 'selfie_neutral', 'selfie_action'];
const kindOf = (k: string): KycFileKind => {
  if (!(KINDS as string[]).includes(k)) throw new Problem('not-found');
  return k as KycFileKind;
};
const userOf = (p: Principal) => {
  if (p.type !== 'user') throw new Problem('forbidden');
  return p;
};
const staffOf = (p: Principal) => {
  if (p.type !== 'staff') throw new Problem('forbidden');
  return p;
};

@Controller('kyc')
export class KycController {
  constructor(
    private readonly kyc: KycService,
    private readonly review: KycReviewService,
  ) {}

  /** IF-UI-02: status, the rejection reason, attempts left and the expected review time. */
  @SignedIn()
  @Get('status')
  status(@CurrentPrincipal() p: Principal) {
    return this.kyc.status(userOf(p).userId);
  }

  /** FR-KYC-02: one random action for the second selfie frame. */
  @SignedIn()
  @RateLimit('kyc')
  @Get('liveness-challenge')
  challenge(@CurrentPrincipal() p: Principal) {
    return this.kyc.livenessChallenge(userOf(p).userId);
  }

  /** FR-KYC-01: multipart; the images are parts named doc_front, doc_back or passport_photo_page, selfie_neutral, selfie_action. */
  @SignedIn()
  @RateLimit('kyc')
  @Post('submissions')
  @HttpCode(202)
  @UseInterceptors(
    FileFieldsInterceptor(KINDS.map((name) => ({ name, maxCount: 1 })), {
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 5, fields: 10, fieldSize: 1024, parts: 15 },
    }),
  )
  submit(
    @Body() dto: KycSubmissionDto,
    @UploadedFiles() files: Partial<Record<KycFileKind, { buffer: Buffer }[]>> | undefined,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const images: Partial<Record<KycFileKind, Buffer>> = {};
    // Only the fixed kinds are read (multer also refuses any other part name).
    for (const kind of KINDS) {
      const part = files?.[kind]?.[0];
      if (part) images[kind] = part.buffer;
    }
    return this.kyc.submit(userOf(p).userId, dto, images, ctxOf(req));
  }

  /** SEC-ACC-06: the owner's own image of their latest submission, through a signed link. */
  @SignedIn()
  @RateLimit('files')
  @Post('files/:kind/view')
  @HttpCode(200)
  view(@Param('kind') kind: string, @CurrentPrincipal() p: Principal) {
    const u = userOf(p);
    return this.review.ownFileLink(u.userId, u.sessionId, kindOf(kind));
  }
}

/** Operators only (FR-OPS-03: administrators never see KYC documents). */
@Controller('staff')
export class StaffKycController {
  constructor(private readonly review: KycReviewService) {}

  @Staff('operator')
  @Get('kyc/queue')
  queue() {
    return this.review.queue();
  }

  @Staff('operator')
  @Post('kyc/submissions/:id/claim')
  @HttpCode(200)
  claim(@Param('id', ParseUUIDPipe) id: string, @CurrentPrincipal() p: Principal, @Req() req: Request) {
    return this.review.claim(staffOf(p).staffId, id, ctxOf(req));
  }

  @Staff('operator')
  @Get('kyc/submissions/:id')
  details(@Param('id', ParseUUIDPipe) id: string, @CurrentPrincipal() p: Principal, @Req() req: Request) {
    return this.review.details(staffOf(p).staffId, id, ctxOf(req));
  }

  /** SEC-ACC-06: a reason is required and recorded with the view. */
  @Staff('operator')
  @RateLimit('files')
  @Post('kyc/submissions/:id/files/:kind/view')
  @HttpCode(200)
  view(@Param('id', ParseUUIDPipe) id: string, @Param('kind') kind: string, @Body() dto: ReasonDto, @CurrentPrincipal() p: Principal, @Req() req: Request) {
    const s = staffOf(p);
    return this.review.staffFileLink(s.staffId, s.sessionId, id, kindOf(kind), dto.reason, ctxOf(req));
  }

  /** FR-KYC-06: approve, or reject with a reason code. */
  @Staff('operator')
  @Post('kyc/submissions/:id/decision')
  @HttpCode(200)
  decide(@Param('id', ParseUUIDPipe) id: string, @Body() dto: KycDecisionDto, @CurrentPrincipal() p: Principal, @Req() req: Request) {
    return this.review.decide(staffOf(p).staffId, id, dto, ctxOf(req));
  }

  /** FR-KYC-10: proposes kyc.revoke; a second operator decides it under /staff/approvals. */
  @Staff('operator')
  @Post('users/:id/kyc/revoke')
  @HttpCode(202)
  revoke(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto, @CurrentPrincipal() p: Principal, @Req() req: Request) {
    return this.review.proposeRevoke(staffOf(p).staffId, id, dto.reason, ctxOf(req));
  }

  /** FR-TNS-06: proposes blacklist.add for the user's verified identity. */
  @Staff('operator')
  @Post('blacklist')
  @HttpCode(202)
  blacklist(@Body() dto: BlacklistDto, @CurrentPrincipal() p: Principal, @Req() req: Request) {
    return this.review.proposeBlacklist(staffOf(p).staffId, dto.userId, dto.source, dto.relatedOrderId ?? null, dto.reason, ctxOf(req));
  }

  @Staff('operator')
  @Post('blacklist/:id/remove')
  @HttpCode(202)
  unblacklist(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto, @CurrentPrincipal() p: Principal, @Req() req: Request) {
    return this.review.proposeUnblacklist(staffOf(p).staffId, id, dto.reason, ctxOf(req));
  }
}

/** SEC-DAT-04: a signed link, used by the session it was issued to; served with fixed, safe headers. */
@Controller('files')
export class FilesController {
  constructor(private readonly review: KycReviewService) {}

  @Credential('signed-link')
  @RateLimit('files')
  @Get('v/:token')
  async serve(@Param('token') token: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    if (token.length > 600) throw new Problem('link-invalid');
    const bytes = await this.review.serve(token, (req.cookies ?? {}) as Record<string, string | undefined>);
    res.set({
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'",
      'Content-Disposition': 'inline',
    });
    res.status(200).end(bytes);
  }
}
