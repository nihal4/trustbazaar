import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Put, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import type { Request } from 'express';
import { correlationId } from '../../../kernel/http/correlation';
import { Public, SignedIn, Staff, Verified } from '../../../kernel/http/policies';
import { CurrentPrincipal, Principal } from '../../../kernel/http/principal';
import { Problem } from '../../../kernel/http/problems';
import type { LiveCheck } from '../ports';
import { OwnershipReviewService } from '../services/ownership-review.service';
import { OwnershipService } from '../services/ownership.service';

// Unit 5's listing API (docs/design/05_game_accounts.pdf section 3.1; U5-02). The seller's ownership of the listing is
// checked in the service; the routes declare Public, SignedIn, Verified(list) or Staff.

export class GameDto {
  @IsString()
  @Matches(/^[a-z0-9-]{2,40}$/)
  slug!: string;

  @IsString()
  @Length(2, 80)
  name!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @Length(2, 30, { each: true })
  platforms!: string[];

  @IsString()
  @Length(3, 200)
  codePlacement!: string;

  @IsString()
  @Length(10, 500)
  publisherNote!: string;
}

export class GamePatchDto {
  @IsOptional() @IsString() @Length(2, 80) name?: string;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @IsString({ each: true }) @Length(2, 30, { each: true }) platforms?: string[];
  @IsOptional() @IsString() @Length(3, 200) codePlacement?: string;
  @IsOptional() @IsString() @Length(10, 500) publisherNote?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class GameDetailsDto {
  @IsInt()
  @Min(1)
  @Max(32767)
  gameId!: number;

  @IsString()
  @Length(2, 30)
  platform!: string;

  /** The in-game player ID; never a login detail. */
  @IsString()
  @Length(2, 64)
  playerId!: string;

  @IsString()
  @Length(10, 2000)
  contents!: string;
}

export class ProofReviewDto {
  @IsIn(['approve', 'reject'])
  decision!: 'approve' | 'reject';

  /** What the operator saw on the game's live profile. */
  @IsIn(['matched', 'not_matched', 'not_available'])
  liveCheck!: LiveCheck;

  /** Required for a rejection (10 characters or more); the seller sees it. */
  @IsOptional()
  @IsString()
  @Length(1, 1000)
  reason?: string;
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

@Controller()
export class GameAccountsController {
  constructor(
    private readonly ownership: OwnershipService,
    private readonly review: OwnershipReviewService,
  ) {}

  /** The catalogue: games, platforms, where the code goes, the publisher's note. */
  @Public()
  @Get('games')
  games() {
    return this.ownership.games();
  }

  @Staff('administrator')
  @Post('admin/games')
  @HttpCode(201)
  addGame(@Body() dto: GameDto, @CurrentPrincipal() p: Principal, @Req() req: Request) {
    return this.ownership.addGame(staffOf(p), dto, ctx(req));
  }

  @Staff('administrator')
  @Patch('admin/games/:id')
  updateGame(
    @Param('id', new ParseIntPipe({ exceptionFactory: () => new Problem('not-found') })) id: number,
    @Body() dto: GamePatchDto,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    return this.ownership.updateGame(staffOf(p), id, dto, ctx(req));
  }

  /** FR-GAM-02: game, platform, player ID and contents of the seller's game-account listing. */
  @Verified('list')
  @Put('listings/:id/game-details')
  details(@Id('id') id: string, @Body() dto: GameDetailsDto, @CurrentPrincipal() p: Principal) {
    return this.ownership.setDetails(userOf(p), id, dto);
  }

  /** FR-GAM-03: a fresh ownership code, valid 7 days (DV-33). */
  @SignedIn()
  @Post('listings/:id/ownership-code')
  @HttpCode(201)
  code(@Id('id') id: string, @CurrentPrincipal() p: Principal) {
    return this.ownership.issueCode(userOf(p), id);
  }

  /** The screenshot showing the code and the player ID (multipart field file); submits the proof for review. */
  @SignedIn()
  @Post('listings/:id/ownership-proof')
  @HttpCode(201)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10_485_760, files: 1, fields: 0, parts: 1 } }))
  proof(@Id('id') id: string, @UploadedFile() file: { buffer: Buffer; mimetype: string } | undefined, @CurrentPrincipal() p: Principal) {
    if (!file) throw new Problem('validation-failed', { errors: [{ field: 'file', reason: 'required' }] });
    return this.ownership.submitProof(userOf(p), id, file);
  }

  /** The seller's own view: the details and the latest proof's status (added; Decisions log, U5-02). */
  @SignedIn()
  @Get('listings/:id/ownership')
  status(@Id('id') id: string, @CurrentPrincipal() p: Principal) {
    return this.ownership.status(userOf(p), id);
  }

  // ------------------------------------------------------------------ staff: the ownership review (FR-GAM-03, FR-OPS-01)

  @Staff('operator')
  @Get('staff/game/ownership-proofs')
  proofs() {
    return this.review.queue();
  }

  /** A signed link valid CP-31 for this session; each view is audited. */
  @Staff('operator')
  @Get('staff/game/ownership-proofs/:id/screenshot')
  screenshot(@Id('id') id: string, @CurrentPrincipal() p: Principal, @Req() req: Request) {
    if (p.type !== 'staff') throw new Problem('forbidden');
    return this.review.screenshot(p, id, ctx(req));
  }

  /** Approve (takes the player-ID claim and publishes the listing), or reject with a reason (back to draft). */
  @Staff('operator')
  @Post('staff/game/ownership-proofs/:id/review')
  @HttpCode(200)
  decide(@Id('id') id: string, @Body() dto: ProofReviewDto, @CurrentPrincipal() p: Principal, @Req() req: Request) {
    return this.review.review(staffOf(p), id, { approve: dto.decision === 'approve', liveCheck: dto.liveCheck, reason: dto.reason }, ctx(req));
  }
}
