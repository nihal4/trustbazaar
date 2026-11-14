import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { IsInt, IsString, Length, Max, Min } from 'class-validator';
import type { Request } from 'express';
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

export class SealedDto {
  @IsInt()
  @Min(1)
  @Max(2)
  keyVersion!: number;

  /** The sender's encapsulated key: a 65-byte P-256 point, base64url. */
  @IsString()
  @Length(87, 88)
  enc!: string;

  /** 512 k + 16 bytes (DV-34), at most 4112: base64url. */
  @IsString()
  @Length(704, 5483)
  ciphertext!: string;
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

  /** The buyer's current public key and its version, for the seller's browser to seal for. */
  @SignedIn()
  @Get('buyer-key')
  @Header('Cache-Control', 'no-store')
  buyerKey(@Id('id') id: string, @CurrentPrincipal() p: Principal) {
    return this.handovers.buyerKey(userOf(p).userId, id);
  }

  /** FR-GAM-09, FR-GAM-10: the seller delivers enc and the ciphertext sealed for that version. */
  @SignedIn()
  @Post('sealed')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  deliver(@Id('id') id: string, @Body() dto: SealedDto, @CurrentPrincipal() p: Principal) {
    return this.handovers.deliver(userOf(p).userId, id, dto);
  }

  /** FR-GAM-11: the buyer retrieves them; every call is logged. */
  @SignedIn()
  @Get('sealed')
  @Header('Cache-Control', 'no-store')
  sealed(@Id('id') id: string, @CurrentPrincipal() p: Principal, @Req() req: Request) {
    const u = userOf(p);
    return this.handovers.retrieve(u.userId, id, u.sessionId, req.ip ?? null);
  }
}
