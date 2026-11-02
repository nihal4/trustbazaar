import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { IsString, MaxLength } from 'class-validator';
import { Staff } from '../../../kernel/http/policies';
import { CurrentPrincipal, Principal } from '../../../kernel/http/principal';
import { Problem } from '../../../kernel/http/problems';
import { AuctionStaffService } from '../services/auction-staff.service';

// Operators on auctions and bids (docs/design/03_listings_auctions.pdf section 3.1; FR-AUC-08, FR-AUC-10, FR-LST-08,
// FR-AUC-18; U3-06). Unit 7's queues (U7-06) link here. Listing review, removal and screening terms are U3-08's.
const staffOf = (p: Principal) => {
  if (p.type !== 'staff') throw new Problem('forbidden');
  return p;
};
const Id = (name: string) => Param(name, new ParseUUIDPipe({ exceptionFactory: () => new Problem('not-found') }));

export class ReasonDto {
  @IsString()
  @MaxLength(1000)
  reason!: string;
}

export class NoteDto {
  @IsString()
  @MaxLength(1000)
  note!: string;
}

@Controller('staff')
export class AuctionsStaffController {
  constructor(private readonly staff: AuctionStaffService) {}

  /** FR-AUC-10: void a bid with a reason; the auction is recomputed. */
  @Staff('operator')
  @Post('bids/:bid/void')
  @HttpCode(200)
  voidBid(@Param('bid') bid: string, @Body() dto: ReasonDto, @CurrentPrincipal() p: Principal) {
    return this.staff.voidBid(staffOf(p).staffId, bid, dto.reason);
  }

  /** FR-LST-08: cancel an auction, with bids or without; every bidder is told. */
  @Staff('operator')
  @Post('auctions/:id/cancel')
  @HttpCode(200)
  cancel(@Id('id') id: string, @Body() dto: ReasonDto, @CurrentPrincipal() p: Principal) {
    return this.staff.cancel(staffOf(p).staffId, id, dto.reason);
  }

  /** FR-AUC-08: the bidders' maximums, only while a flag on the auction is open; audited. */
  @Staff('operator')
  @Get('auctions/:id/maximums')
  maximums(@Id('id') id: string, @CurrentPrincipal() p: Principal) {
    return this.staff.maximums(staffOf(p).staffId, id);
  }

  /** Closes a flag with a note (Decisions log, U3-06). */
  @Staff('operator')
  @Post('auctions/:id/flags/:flagId/review')
  @HttpCode(204)
  async review(@Id('id') id: string, @Param('flagId') flagId: string, @Body() dto: NoteDto, @CurrentPrincipal() p: Principal): Promise<void> {
    await this.staff.reviewFlag(staffOf(p).staffId, id, flagId, dto.note);
  }
}
