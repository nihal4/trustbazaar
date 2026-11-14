import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { IsInt, IsString, Length, Max, Min } from 'class-validator';
import { SignedIn } from '../../../kernel/http/policies';
import { CurrentPrincipal, Principal } from '../../../kernel/http/principal';
import { Problem } from '../../../kernel/http/problems';
import { HandoverService } from '../services/handover.service';

// The handover's checkout routes (docs/design/05_game_accounts.pdf section 3.1; U5-03). The buyer's role on the order is
// checked in the service; binary values travel as base64url.

export class AcknowledgeDto {
  @IsInt()
  @Min(1)
  @Max(32767)
  version!: number;
}

export class BuyerKeyDto {
  /** The raw uncompressed P-256 point (65 bytes), base64url: 87 characters without padding. */
  @IsString()
  @Length(87, 88)
  publicKey!: string;
}

const Id = (name: string) => Param(name, new ParseUUIDPipe({ exceptionFactory: () => new Problem('not-found') }));
const userOf = (p: Principal) => {
  if (p.type !== 'user') throw new Problem('forbidden');
  return p;
};

@Controller('orders/:id/game')
export class HandoverController {
  constructor(private readonly handovers: HandoverService) {}

  /** FR-GAM-05: the buyer accepts the publisher-risk disclosure, by version, before paying. */
  @SignedIn()
  @Post('acknowledge')
  @HttpCode(200)
  acknowledge(@Id('id') id: string, @Body() dto: AcknowledgeDto, @CurrentPrincipal() p: Principal) {
    return this.handovers.acknowledge(userOf(p).userId, id, dto.version);
  }

  /** FR-GAM-07: the browser's public key; fixed once registered, until payment. */
  @SignedIn()
  @Post('key')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  key(@Id('id') id: string, @Body() dto: BuyerKeyDto, @CurrentPrincipal() p: Principal) {
    const u = userOf(p);
    return this.handovers.registerKey(u.userId, id, u.sessionId, dto.publicKey);
  }

  /** NFR-USE-03: the status and deadlines, for the buyer or the seller. */
  @SignedIn()
  @Get()
  @Header('Cache-Control', 'no-store')
  status(@Id('id') id: string, @CurrentPrincipal() p: Principal) {
    return this.handovers.view(userOf(p).userId, id);
  }
}
