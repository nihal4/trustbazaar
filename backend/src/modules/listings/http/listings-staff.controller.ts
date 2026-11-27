import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { IsIn, IsString, MaxLength } from 'class-validator';
import type { Request } from 'express';
import { Staff } from '../../../kernel/http/policies';
import { CurrentPrincipal, Principal } from '../../../kernel/http/principal';
import { Problem } from '../../../kernel/http/problems';
import { ListingReviewService } from '../services/listing-review.service';
import { ListingsQueriesService } from '../services/listings-queries.service';

// Operators on listings (docs/design/03_listings_auctions.pdf section 3.1; FR-LST-11, FR-LST-12; U3-08): the review of
// listings held by the screening terms, removal, and the screening terms. Unit 7's listings_review queue links here.
const staffOf = (p: Principal) => {
  if (p.type !== 'staff') throw new Problem('forbidden');
  return p;
};
const Id = (name: string) => Param(name, new ParseUUIDPipe({ exceptionFactory: () => new Problem('not-found') }));
const ctx = (req: Request) => ({ ip: req.ip, correlationId: String(req.headers['x-correlation-id'] ?? '') || undefined });

export class ListingReviewDto {
  @IsIn(['approve', 'return'])
  decision!: 'approve' | 'return';

  /** Shown to the seller when returned (10 characters or more). */
  @IsString()
  @MaxLength(1000)
  reason!: string;
}

export class RemoveDto {
  @IsString()
  @MaxLength(1000)
  reason!: string;
}

export class ScreeningTermDto {
  @IsString()
  @MaxLength(80)
  term!: string;

  @IsIn(['prohibited', 'high_risk'])
  severity!: 'prohibited' | 'high_risk';
}

@Controller('staff')
export class ListingsStaffController {
  constructor(
    private readonly review: ListingReviewService,
    private readonly queries: ListingsQueriesService,
  ) {}

  /** FR-LST-11: the listings held for review, oldest first. */
  @Staff('operator')
  @Get('listings/review')
  async queue() {
    return { items: (await this.queries.reviewQueue()).map((i) => ({ ...i, heldAt: i.heldAt.toISOString() })) };
  }

  /** FR-LST-11: the listing itself, for the operator deciding (Decisions log, U8-10); audited. Declared after the queue. */
  @Staff('operator')
  @Get('listings/:id')
  view(@Id('id') id: string, @CurrentPrincipal() p: Principal, @Req() req: Request) {
    return this.review.staffView(staffOf(p).staffId, id, ctx(req));
  }
  /** FR-LST-11: approve (publish) or return to the seller with a reason. */
  @Staff('operator')
  @Post('listings/:id/review')
  @HttpCode(200)
  decide(@Id('id') id: string, @Body() dto: ListingReviewDto, @CurrentPrincipal() p: Principal, @Req() req: Request) {
    return this.review.review(staffOf(p).staffId, id, dto.decision, dto.reason, ctx(req));
  }

  /** FR-LST-12: remove for a policy breach, with a reason. */
  @Staff('operator')
  @Post('listings/:id/remove')
  @HttpCode(200)
  remove(@Id('id') id: string, @Body() dto: RemoveDto, @CurrentPrincipal() p: Principal, @Req() req: Request) {
    return this.review.remove(staffOf(p).staffId, id, dto.reason, ctx(req));
  }

  @Staff('operator')
  @Get('screening-terms')
  terms() {
    return this.review.terms();
  }

  /** FR-LST-11: a new term holds listings published from now on. */
  @Staff('operator')
  @Post('screening-terms')
  @HttpCode(201)
  addTerm(@Body() dto: ScreeningTermDto, @CurrentPrincipal() p: Principal, @Req() req: Request) {
    return this.review.addTerm(staffOf(p).staffId, dto.term, dto.severity, ctx(req));
  }

  @Staff('operator')
  @Delete('screening-terms/:id')
  @HttpCode(204)
  async deleteTerm(
    @Param('id', new ParseIntPipe({ exceptionFactory: () => new Problem('not-found') })) id: number,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ): Promise<void> {
    await this.review.deleteTerm(staffOf(p).staffId, id, ctx(req));
  }
}
