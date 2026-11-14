import { Body, Controller, Delete, HttpCode, Param, ParseEnumPipe, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsBoolean, IsDate, IsIn, IsOptional, IsString, IsUUID, Length, MaxLength, ValidateNested } from 'class-validator';
import type { Request, Response } from 'express';
import { correlationId } from '../../../kernel/http/correlation';
import { SignedIn, Staff } from '../../../kernel/http/policies';
import { CurrentPrincipal, Principal } from '../../../kernel/http/principal';
import { Problem } from '../../../kernel/http/problems';
import { REPORT_CATEGORY, SANCTION_KIND, SanctionKind } from '../db/enums';
import type { ReportCategory } from '../ports';
import { TrustReportService } from '../services/report.service';
import { RelatedType, SanctionService } from '../services/sanction.service';

// Unit 7's reports and sanctions API (docs/design/07_disputes_trust_staff.pdf section 3.1; U7-04). Ownership of a case
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

const Id = (name: string) => Param(name, new ParseUUIDPipe({ exceptionFactory: () => new Problem('not-found') }));
const userOf = (p: Principal) => {
  if (p.type !== 'user') throw new Problem('forbidden');
  return p.userId;
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
  ) {}

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
