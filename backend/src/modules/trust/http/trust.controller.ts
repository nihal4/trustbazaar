import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseEnumPipe, ParseUUIDPipe, Patch, Post, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Type } from 'class-transformer';
import { IsBoolean, IsDate, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import type { Request, Response } from 'express';
import { correlationId } from '../../../kernel/http/correlation';
import { Public, RateLimit, SignedIn, Staff, StepUp } from '../../../kernel/http/policies';
import { CurrentPrincipal, Principal } from '../../../kernel/http/principal';
import { Problem } from '../../../kernel/http/problems';
import { REPORT_CATEGORY, SANCTION_KIND, SanctionKind } from '../db/enums';
import type { DisputeType, ReportCategory } from '../ports';
import { DecisionOutcome, DisputeCaseService } from '../services/dispute-case.service';
import { DisputeService, EVIDENCE_MIME, EVIDENCE_VIDEO_MIME, MAX_EVIDENCE_VIDEO_BYTES } from '../services/dispute.service';
import { PrivacyService } from '../services/privacy.service';
import { EvidencePackService } from '../services/evidence-pack.service';
import { QueueName, QUEUES, QueueService } from '../services/queue.service';
import { RatingService } from '../services/rating.service';
import { TrustReportService } from '../services/report.service';
import { SignalService } from '../services/signal.service';
import { RelatedType, SanctionService } from '../services/sanction.service';
import { DataExportService } from '../services/data-export.service';

// Unit 7's reports, sanctions and ratings API (docs/design/07_disputes_trust_staff.pdf section 3.1; U7-03 to U7-08). Ownership of a case
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

export class DecisionDto {
  @IsIn(['release', 'full_refund', 'partial_refund', 'refund_after_return'])
  outcome!: DecisionOutcome;

  /** The parties see it (FR-DSP-07). */
  @IsString()
  @Length(20, 4000)
  reason!: string;

  /** Poisha, for a partial refund: above zero and below the item price. */
  @IsOptional()
  @IsString()
  @MaxLength(15)
  itemRefund?: string;

  /** Who pays the return, for refund after return. */
  @IsOptional()
  @IsIn(['buyer', 'seller'])
  returnPayer?: 'buyer' | 'seller';
}

export class OutcomePreviewQuery {
  @Matches(/^[1-9]\d{0,14}$/)
  itemRefund!: string;
}

export class ReturnCheckDto {
  @IsString()
  @Length(6, 40)
  value!: string;
}

export class ResolveReturnDto {
  @IsIn(['refund', 'release'])
  outcome!: 'refund' | 'release';

  @IsString()
  @Length(20, 2000)
  reason!: string;
}

export class BuyerFindingDto {
  @IsIn(['false_claim', 'swap'])
  finding!: 'false_claim' | 'swap';

  @IsString()
  @Length(20, 2000)
  reason!: string;
}

export class InfoRequestDto {
  @IsString()
  @Length(10, 2000)
  note!: string;
}

export class DisclosureDto {
  @IsUUID()
  userId!: string;

  @IsString()
  @Length(3, 200)
  authority!: string;

  /** The request's reference (case, GD or court order number). */
  @IsString()
  @Length(5, 300)
  legalReference!: string;

  @IsString()
  @Length(10, 2000)
  scope!: string;

  /** false only where the law forbids telling the user; then withheldReason says why. */
  @IsBoolean()
  notifyUser!: boolean;

  @IsOptional()
  @IsString()
  @Length(10, 1000)
  withheldReason?: string;
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
/** The case types an operator claims (FR-OPS-06): disputes (U7-03) and reports (U7-04). */
const CLAIMABLE = { dispute: 'dispute', report: 'report' } as const;

@Controller()
export class TrustController {
  constructor(
    private readonly reports: TrustReportService,
    private readonly sanctions: SanctionService,
    private readonly ratings: RatingService,
    private readonly signals: SignalService,
    private readonly disputes: DisputeService,
    private readonly cases: DisputeCaseService,
    private readonly queues: QueueService,
    private readonly privacy: PrivacyService,
    private readonly packs: EvidencePackService,
    private readonly exports: DataExportService,
  ) {}

  /** FR-PRV-03: ask for a copy of one's data (step-up); one in preparation, one every 7 days (DV-49). 202. */
  @SignedIn()
  @StepUp('data.export')
  @Post('me/data-export')
  @HttpCode(202)
  requestExport(@CurrentPrincipal() p: Principal) {
    return this.exports.request(userOf(p));
  }

  /** FR-PRV-03: the latest export: preparing, ready (with a signed link for this session) or expired; 204 if none. */
  @SignedIn()
  @Get('me/data-export')
  async exportStatus(@CurrentPrincipal() p: Principal, @Res({ passthrough: true }) res: Response) {
    const s = await this.exports.status(userOf(p), p);
    if (!s) res.status(204);
    return s ?? undefined;
  }

  /** FR-PRV-06: record a lawful request; 202 with the four-eyes proposal. */
  @Staff('operator')
  @Post('staff/disclosures')
  @HttpCode(202)
  disclose(@Body() dto: DisclosureDto, @CurrentPrincipal() p: Principal, @Req() req: Request) {
    return this.privacy.request(staffOf(p), dto, ctx(req));
  }

  /** The disclosure's record. */
  @Staff('operator')
  @Get('staff/disclosures/:id')
  disclosure(@Id('id') id: string) {
    return this.privacy.get(id);
  }

  /** FR-OPS-01: one of the eight queues, oldest first, with age; disputes overdue first (DV-52). */
  @Staff('operator')
  @Get('staff/queues/:queue')
  queue(@Param('queue', new ParseEnumPipe(Object.fromEntries(QUEUES.map((q) => [q, q])), { exceptionFactory: () => new Problem('not-found') })) queue: QueueName) {
    return this.queues.list(queue);
  }

  /** I-56: the dispute types the buyer may open now. */
  @SignedIn()
  @Get('orders/:id/dispute-types')
  disputeTypes(@Id('id') orderId: string, @CurrentPrincipal() p: Principal) {
    return this.disputes.types(userOf(p), orderId);
  }

  /** The order's disputes for either party, newest first (U8-09). */
  @SignedIn()
  @Get('orders/:id/disputes')
  orderDisputes(@Id('id') orderId: string, @CurrentPrincipal() p: Principal) {
    return this.disputes.forOrder(userOf(p), orderId);
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

  /** U10-23: the party's chat with TrustBazaar about the dispute. */
  @SignedIn()
  @Get('disputes/:id/chat')
  disputeChat(@Id('id') id: string, @CurrentPrincipal() p: Principal) {
    return this.disputes.messages(asUser(p), id);
  }

  /** U10-23: the party has read its dispute chat. */
  @SignedIn()
  @Post('disputes/:id/chat/seen')
  @HttpCode(200)
  disputeChatSeen(@Id('id') id: string, @CurrentPrincipal() p: Principal) {
    return this.disputes.markSeen(userOf(p), id);
  }

  /** FR-DSP-04: a statement; the seller's first while it is expected is the response. */
  @SignedIn()
  @Post('disputes/:id/statements')
  @HttpCode(201)
  statement(@Id('id') id: string, @Body() dto: StatementDto, @CurrentPrincipal() p: Principal) {
    return this.disputes.statement(userOf(p), id, dto.text);
  }

  /** Evidence: one image or video (multipart field file); at most CP-33 per dispute. */
  @SignedIn()
  @RateLimit('dispute-evidence')
  @Post('disputes/:id/evidence')
  @HttpCode(201)
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: MAX_EVIDENCE_VIDEO_BYTES, files: 1, fields: 0, parts: 1 },
    // a type that is not evidence is refused before the body is buffered
    fileFilter: (_req, f, cb) => ([...EVIDENCE_MIME, ...EVIDENCE_VIDEO_MIME] as string[]).includes(f.mimetype) ? cb(null, true) : cb(new Problem('validation-failed', { errors: [{ field: 'file', reason: 'type' }] }), false),
  }))
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

  /** FR-REV-01 to FR-REV-03, FR-REV-06: the rating window, one's own rating and the one received, for either party (U8-09). */
  @SignedIn()
  @Get('orders/:id/ratings')
  orderRatings(@Id('id') orderId: string, @CurrentPrincipal() p: Principal) {
    return this.ratings.forOrder(userOf(p), orderId);
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
    @Param('type', new ParseEnumPipe(CLAIMABLE, { exceptionFactory: () => new Problem('not-found') })) type: 'dispute' | 'report',
    @Id('id') id: string,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    return type === 'dispute' ? this.cases.claim(staffOf(p), id, ctx(req)) : this.reports.claim(staffOf(p), id, ctx(req));
  }

  /** FR-DSP-05: the case file, for the assigned operator; each view audited. */
  @Staff('operator')
  @Get('staff/disputes/:id/case-file')
  caseFile(@Id('id') id: string, @CurrentPrincipal() p: Principal, @Req() req: Request) {
    if (p.type !== 'staff') throw new Problem('forbidden');
    return this.cases.caseFile(p, id, ctx(req));
  }

  /** FR-DSP-06: Unit 2's exact split of a partial refund, before the decision (Decisions log, U8-10). */
  @Staff('operator')
  @Get('staff/disputes/:id/outcome-preview')
  @Header('Cache-Control', 'no-store')
  outcomePreview(@Id('id') id: string, @Query() q: OutcomePreviewQuery, @CurrentPrincipal() p: Principal) {
    if (p.type !== 'staff') throw new Problem('forbidden');
    return this.cases.outcomePreview(p.staffId, id, q.itemRefund);
  }

  /** FR-GAM-18: the evidence pack for law enforcement, one PDF with a hash list, for the assigned operator; audited. */
  @Staff('operator')
  @Get('staff/disputes/:id/evidence-pack')
  @Header('Cache-Control', 'no-store')
  evidencePack(@Id('id') id: string, @CurrentPrincipal() p: Principal, @Req() req: Request) {
    if (p.type !== 'staff') throw new Problem('forbidden');
    return this.packs.create(p, id, ctx(req));
  }

  /** FR-DSP-09: ask the seller for more; they have 24 hours (DV-47). */
  @Staff('operator')
  @Post('staff/disputes/:id/request-info')
  @HttpCode(200)
  requestInfo(@Id('id') id: string, @Body() dto: InfoRequestDto, @CurrentPrincipal() p: Principal) {
    return this.cases.requestInfo(staffOf(p), id, dto.note);
  }

  /** FR-DSP-06: 200 decided (or awaiting the return), or 202 proposed for four-eyes approval (CP-30). */
  @Staff('operator')
  @Post('staff/disputes/:id/decision')
  @HttpCode(200)
  async decide(@Id('id') id: string, @Body() dto: DecisionDto, @CurrentPrincipal() p: Principal, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const r = await this.cases.decide(staffOf(p), id, dto, ctx(req));
    if (r.status === 'proposed') res.status(202);
    return r;
  }

  /** U10-23, FR-TNS-10: the seller checks the identifier of the item taken back. */
  @SignedIn()
  @Post('disputes/:id/return-check')
  @HttpCode(200)
  returnCheck(@Id('id') id: string, @Body() dto: ReturnCheckDto, @CurrentPrincipal() p: Principal) {
    return this.cases.returnCheck(userOf(p), id, dto.value);
  }

  /** U10-23, FR-TNS-10: an operator closes a dispute that awaits a return which is stuck (a mismatch, or the target has passed). */
  @Staff('operator')
  @Post('staff/disputes/:id/resolve-return')
  @HttpCode(200)
  resolveReturn(@Id('id') id: string, @Body() dto: ResolveReturnDto, @CurrentPrincipal() p: Principal) {
    return this.cases.resolveReturn(staffOf(p), id, dto.outcome, dto.reason);
  }

  /** U10-23, FR-TNS-10: an operator's finding of a buyer's bad faith on a decided dispute: a buyer strike, and a suspension of buying for a swap. */
  @Staff('operator')
  @Post('staff/disputes/:id/buyer-finding')
  @HttpCode(200)
  buyerFinding(@Id('id') id: string, @Body() dto: BuyerFindingDto, @CurrentPrincipal() p: Principal) {
    return this.cases.buyerFinding(staffOf(p), id, dto.finding, dto.reason);
  }

  /** Outcome (d): the seller records that the returned item has arrived; the buyer's refund follows. */
  @SignedIn()
  @Post('disputes/:id/return-received')
  @HttpCode(200)
  returnReceived(@Id('id') id: string, @CurrentPrincipal() p: Principal) {
    return this.cases.returnReceived(userOf(p), id);
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
