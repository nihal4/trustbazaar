import { Body, Controller, Delete, Get, HttpCode, Param, ParseEnumPipe, ParseUUIDPipe, Patch, Post, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Type } from 'class-transformer';
import { IsBoolean, IsDate, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import type { Request, Response } from 'express';
import { correlationId } from '../../../kernel/http/correlation';
import { Public, SignedIn, Staff } from '../../../kernel/http/policies';
import { CurrentPrincipal, Principal } from '../../../kernel/http/principal';
import { Problem } from '../../../kernel/http/problems';
import { REPORT_CATEGORY, SANCTION_KIND, SanctionKind } from '../db/enums';
import type { DisputeType, ReportCategory } from '../ports';
import { DisputeService, MAX_EVIDENCE_BYTES } from '../services/dispute.service';
import { RatingService } from '../services/rating.service';
import { TrustReportService } from '../services/report.service';
import { SignalService } from '../services/signal.service';
import { RelatedType, SanctionService } from '../services/sanction.service';

// Unit 7's reports, sanctions and ratings API (docs/design/07_disputes_trust_staff.pdf section 3.1; U7-03, U7-04, U7-05, U7-08). Ownership of a case
// ("Assigned operator") is checked in the services; the routes declare SignedIn or Staff.

export class ReportDto {
  /** A chat thread or message is reported in the chat: POST /threads/{id}/reports. */
  @IsIn(['listing', 'user'])
  targetType!: 'listing' | 'user';

  @IsUUID()
  targetId!: string;

  @IsIn(REPORT_CATEGORY)
  category!: ReportCategory;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  text?: string;
}

export class OpenDisputeDto {
  /** Physical goods (U7-03); the game-account types answer feature-off until U7-10. */
  @IsIn(['not_as_described', 'damaged', 'not_received', 'credentials_invalid', 'seller_recovery', 'other'])
  type!: DisputeType;

  @IsString()
  @Length(20, 4000)
  description!: string;
}

export class StatementDto {
  @IsString()
  @Length(1, 4000)
  text!: string;
}

export class ResolutionDto {
  @IsIn(['dismissed', 'actioned'])
  outcome!: 'dismissed' | 'actioned';

  @IsString()
  @Length(10, 2000)
  resolution!: string;
}

class RelatedDto {
  @IsIn(['report', 'dispute', 'signal'])
  type!: RelatedType;

  @IsUUID()
  id!: string;
}

export class SanctionDto {
  @IsIn(SANCTION_KIND)
  kind!: SanctionKind;

  @IsString()
  @Length(10, 1000)
  reason!: string;

  /** Absent or null: until review. */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  endsAt?: Date | null;

  @IsOptional()
  @IsBoolean()
  fraud?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => RelatedDto)
  related?: RelatedDto;
}

export class LiftDto {
  @IsUUID()
  sanctionId!: string;

  @IsString()
  @Length(10, 1000)
  reason!: string;
}

export class RatingDto {
  @IsInt()
  @Min(1)
  @Max(5)
  stars!: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  text?: string | null;
}

export class RatingEditDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  stars?: number;

  /** null or empty removes the text. */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  text?: string | null;
}

export class ReplyDto {
  @IsString()
  @Length(1, 1000)
  text!: string;
}

export class RemovalDto {
  @IsString()
  @Length(10, 1000)
  reason!: string;
}

export class SignalReviewDto {
  @IsIn(['dismissed', 'actioned'])
  outcome!: 'dismissed' | 'actioned';

  @IsString()
  @Length(10, 2000)
  note!: string;
}

export class ReviewsQuery {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;
}

const Id = (name: string) => Param(name, new ParseUUIDPipe({ exceptionFactory: () => new Problem('not-found') }));
const userOf = (p: Principal) => {
  if (p.type !== 'user') throw new Problem('forbidden');
  return p.userId;
};
const asUser = (p: Principal) => {
  if (p.type !== 'user') throw new Problem('forbidden');
  return p;
};
const staffOf = (p: Principal) => {
  if (p.type !== 'staff') throw new Problem('forbidden');
  return p.staffId;
};
const ctx = (req: Request) => ({ ip: req.ip ?? null, correlationId: correlationId(req) });
/** Case types that can be claimed so far: reports (U7-04); disputes come with U7-03. */
const CLAIMABLE = { report: 'report' } as const;

@Controller()
export class TrustController {
  constructor(
    private readonly reports: TrustReportService,
    private readonly sanctions: SanctionService,
    private readonly ratings: RatingService,
    private readonly signals: SignalService,
    private readonly disputes: DisputeService,
  ) {}

  /** I-56: the dispute types the buyer may open now. */
  @SignedIn()
  @Get('orders/:id/dispute-types')
  disputeTypes(@Id('id') orderId: string, @CurrentPrincipal() p: Principal) {
    return this.disputes.types(userOf(p), orderId);
  }

  /** FR-DSP-01: the buyer opens a dispute; the escrow is frozen (FR-DSP-02). 201 {disputeId}. */
  @SignedIn()
  @Post('orders/:id/disputes')
  @HttpCode(201)
  openDispute(@Id('id') orderId: string, @Body() dto: OpenDisputeDto, @CurrentPrincipal() p: Principal) {
    return this.disputes.openByBuyer(userOf(p), orderId, dto);
  }

  /** The buyer's or the seller's view: status, deadlines, statements, own evidence, outcome. */
  @SignedIn()
  @Get('disputes/:id')
  dispute(@Id('id') id: string, @CurrentPrincipal() p: Principal) {
    return this.disputes.view(asUser(p), id);
  }

  /** FR-DSP-04: a statement; the seller's first while it is expected is the response. */
  @SignedIn()
  @Post('disputes/:id/statements')
  @HttpCode(201)
  statement(@Id('id') id: string, @Body() dto: StatementDto, @CurrentPrincipal() p: Principal) {
    return this.disputes.statement(userOf(p), id, dto.text);
  }

  /** Evidence: one image (multipart field file); at most CP-33 per dispute. */
  @SignedIn()
  @Post('disputes/:id/evidence')
  @HttpCode(201)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_EVIDENCE_BYTES, files: 1, fields: 0, parts: 1 } }))
  evidence(@Id('id') id: string, @UploadedFile() file: { buffer: Buffer; mimetype: string; size: number } | undefined, @CurrentPrincipal() p: Principal) {
    if (!file) throw new Problem('validation-failed', { errors: [{ field: 'file', reason: 'required' }] });
    return this.disputes.evidence(userOf(p), id, file);
  }

  /** FR-DSP-10: the buyer withdraws before the decision. */
  @SignedIn()
  @Post('disputes/:id/withdraw')
  @HttpCode(200)
  withdraw(@Id('id') id: string, @CurrentPrincipal() p: Principal) {
    return this.disputes.withdraw(userOf(p), id);
  }

  /** The flagged-activity queue (section 6.2): dismiss a signal or act on it, with a note. */
  @Staff('operator')
  @Post('staff/signals/:id/review')
  @HttpCode(200)
  reviewSignal(@Id('id') id: string, @Body() dto: SignalReviewDto, @CurrentPrincipal() p: Principal, @Req() req: Request) {
    return this.signals.review(staffOf(p), id, dto, ctx(req));
  }

  /** FR-REV-01: the buyer or the seller rates the other, once; 201 with the rating. */
  @SignedIn()
  @Post('orders/:id/rating')
  @HttpCode(201)
  rate(@Id('id') orderId: string, @Body() dto: RatingDto, @CurrentPrincipal() p: Principal) {
    return this.ratings.rate(userOf(p), orderId, dto);
  }

  /** FR-REV-03: within the edit period. */
  @SignedIn()
  @Patch('ratings/:id')
  edit(@Id('id') id: string, @Body() dto: RatingEditDto, @CurrentPrincipal() p: Principal) {
    return this.ratings.edit(userOf(p), id, dto);
  }

  /** FR-REV-06: one public reply by the rated user. */
  @SignedIn()
  @Post('ratings/:id/reply')
  @HttpCode(200)
  reply(@Id('id') id: string, @Body() dto: ReplyDto, @CurrentPrincipal() p: Principal) {
    return this.ratings.reply(userOf(p), id, dto.text);
  }

  /** FR-REV-04, FR-REV-05: average, count, completed transactions, badges. */
  @Public()
  @Get('users/:id/trust')
  trust(@Id('id') id: string) {
    return this.ratings.trust(id);
  }

  /** The reviews a user received, newest first (added to the design's API; Decisions log, U7-05). */
  @Public()
  @Get('users/:id/ratings')
  reviews(@Id('id') id: string, @Query() q: ReviewsQuery) {
    return this.ratings.reviews(id, q.cursor);
  }

  /** FR-REV-07: remove a review that breaks the content policy, with a reason. */
  @Staff('operator')
  @Post('staff/ratings/:id/removal')
  @HttpCode(200)
  remove(@Id('id') id: string, @Body() dto: RemovalDto, @CurrentPrincipal() p: Principal, @Req() req: Request) {
    return this.ratings.remove(staffOf(p), id, dto.reason, ctx(req));
  }

  /** FR-TNS-01: report a listing or a user; 201 {reportId}. */
  @SignedIn()
  @Post('reports')
  @HttpCode(201)
  report(@Body() dto: ReportDto, @CurrentPrincipal() p: Principal) {
    return this.reports.reportFromApi(userOf(p), dto);
  }

  /** FR-OPS-06: claim a case, with the conflict check. */
  @Staff('operator')
  @Post('staff/cases/:type/:id/claim')
  @HttpCode(200)
  claim(
    @Param('type', new ParseEnumPipe(CLAIMABLE, { exceptionFactory: () => new Problem('not-found') })) _type: 'report',
    @Id('id') id: string,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    return this.reports.claim(staffOf(p), id, ctx(req));
  }

  /** The assigned operator dismisses or actions a report (FR-TNS-09). */
  @Staff('operator')
  @Post('staff/reports/:id/resolution')
  @HttpCode(200)
  resolve(@Id('id') id: string, @Body() dto: ResolutionDto, @CurrentPrincipal() p: Principal, @Req() req: Request) {
    return this.reports.resolve(staffOf(p), id, dto, ctx(req));
  }

  /** FR-TNS-03: apply a sanction; 201 {sanctionId}. */
  @Staff('operator')
  @Post('staff/users/:id/sanctions')
  @HttpCode(201)
  apply(@Id('id') userId: string, @Body() dto: SanctionDto, @CurrentPrincipal() p: Principal, @Req() req: Request) {
    return this.sanctions.apply(staffOf(p), userId, dto, ctx(req));
  }

  /** Lift a suspension: 200 lifted, or 202 proposed for an account suspension (four-eyes, CP-30). */
  @Staff('operator')
  @Delete('staff/users/:id/sanctions')
  @HttpCode(200)
  async lift(@Id('id') userId: string, @Body() dto: LiftDto, @CurrentPrincipal() p: Principal, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const r = await this.sanctions.lift(staffOf(p), userId, dto.sanctionId, dto.reason, ctx(req));
    if (r.status === 'proposed') res.status(202);
    return r;
  }
}
