import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public, Verified } from '../../../kernel/http/policies';
import { CurrentPrincipal, Principal } from '../../../kernel/http/principal';
import { Problem } from '../../../kernel/http/problems';
import { BidService } from '../services/bid.service';
import { PlaceBidDto } from './auctions.dto';

// The auctions API of Unit 3 (docs/design/03_listings_auctions.pdf section 3.1), U3-04. An auction's id is its
// listing's id. Second-chance decisions are U3-05.
const userOf = (p: Principal) => {
  if (p.type !== 'user') throw new Problem('forbidden');
  return p.userId;
};
const viewerOf = (p: Principal | undefined) => (p?.type === 'user' ? p.userId : undefined);
/** A malformed id names no auction: not-found, as for an unknown one. */
const Id = () => Param('id', new ParseUUIDPipe({ version: '4', exceptionFactory: () => new Problem('not-found') }));

@Controller('auctions')
export class AuctionsController {
  constructor(private readonly bids: BidService) {}

  /** FR-AUC-01, FR-AUC-11: price, masked leader, end time, server time, reserve status, minimum next bid, seq. */
  @Public()
  @Get(':id/state')
  state(@Id() id: string, @CurrentPrincipal() p: Principal | undefined) {
    return this.bids.state(id, viewerOf(p));
  }

  /** FR-AUC-13: the masked bid history. */
  @Public()
  @Get(':id/bids')
  history(@Id() id: string, @CurrentPrincipal() p: Principal | undefined) {
    return this.bids.history(id, viewerOf(p));
  }

  /**
   * FR-AUC-02 to FR-AUC-07: a bid or a new maximum. 201 with the outcome and the new state; a repeat with the same
   * Idempotency-Key answers 200 with the first bid's outcome (I-53). Refusals: 422 bid-refused, the code in
   * errors[0].reason (below_minimum with the minimum); 409 auction-busy with Retry-After when the lock wait ran out.
   */
  @Verified('bid')
  @Post(':id/bids')
  async place(
    @Id() id: string,
    @Body() dto: PlaceBidDto,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentPrincipal() p: Principal,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { repeated, ...result } = await this.bids.place(userOf(p), id, dto.maximum, key);
    res.status(repeated ? 200 : 201);
    return result;
  }

  /** The caller's own maximum and whether they lead, shown only to them (FR-AUC-08). */
  @Verified()
  @Get(':id/my-status')
  myStatus(@Id() id: string, @CurrentPrincipal() p: Principal) {
    return this.bids.myStatus(id, userOf(p));
  }
}
