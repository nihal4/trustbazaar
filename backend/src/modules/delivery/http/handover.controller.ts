import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { RateLimit, SignedIn, Staff } from '../../../kernel/http/policies';
import { CurrentPrincipal, Principal } from '../../../kernel/http/principal';
import { Problem } from '../../../kernel/http/problems';
import { HandoverService } from '../services/handover.service';
import { CodeDto, ProposalDto, ReasonDto } from './delivery.dto';

// Meetup handover (docs/design/04_delivery.pdf section 3.1; FR-DLV-03 to FR-DLV-06; U4-03). "Buyer or seller" is
// SignedIn here plus HandoverService's check, which answers not-found to anyone else (SEC-SDL-09). The code appears
// in exactly one response: the buyer's GET /orders/{id}/handover.
const userOf = (p: Principal) => {
  if (p.type !== 'user') throw new Problem('forbidden');
  return p;
};
const staffOf = (p: Principal) => {
  if (p.type !== 'staff') throw new Problem('forbidden');
  return p;
};
const Id = (name: string) => Param(name, new ParseUUIDPipe({ exceptionFactory: () => new Problem('not-found') }));

@Controller()
export class HandoverController {
  constructor(private readonly handovers: HandoverService) {}

  @SignedIn()
  @Get('orders/:id/handover')
  view(@Id('id') id: string, @CurrentPrincipal() p: Principal) {
    return this.handovers.view(userOf(p).userId, id);
  }

  /** FR-DLV-04: replaces an open proposal. */
  @SignedIn()
  @Post('orders/:id/meetup-proposals')
  @HttpCode(201)
  propose(@Id('id') id: string, @Body() dto: ProposalDto, @CurrentPrincipal() p: Principal) {
    return this.handovers.propose(userOf(p).userId, id, dto);
  }

  @SignedIn()
  @Post('orders/:id/meetup-proposals/:pid/accept')
  @HttpCode(200)
  accept(@Id('id') id: string, @Id('pid') pid: string, @CurrentPrincipal() p: Principal) {
    return this.handovers.respond(userOf(p).userId, id, pid, true);
  }

  @SignedIn()
  @Post('orders/:id/meetup-proposals/:pid/decline')
  @HttpCode(200)
  decline(@Id('id') id: string, @Id('pid') pid: string, @CurrentPrincipal() p: Principal) {
    return this.handovers.respond(userOf(p).userId, id, pid, false);
  }

  @SignedIn()
  @Post('orders/:id/meetup-proposals/:pid/withdraw')
  @HttpCode(200)
  withdraw(@Id('id') id: string, @Id('pid') pid: string, @CurrentPrincipal() p: Principal) {
    return this.handovers.withdraw(userOf(p).userId, id, pid);
  }

  /** FR-DLV-06: the seller enters the buyer's code; a correct code is the delivery event. DV-28: 10 a minute. */
  @SignedIn()
  @RateLimit('handover-code')
  @Post('orders/:id/handover-code')
  @HttpCode(200)
  code(@Id('id') id: string, @Body() dto: CodeDto, @CurrentPrincipal() p: Principal) {
    return this.handovers.enterCode(userOf(p).userId, id, dto.code);
  }

  /** After a lock, having spoken to both parties: a new code (audited). */
  @Staff('operator')
  @Post('staff/orders/:id/handover/unlock')
  @HttpCode(204)
  async unlock(@Id('id') id: string, @Body() dto: ReasonDto, @CurrentPrincipal() p: Principal): Promise<void> {
    await this.handovers.unlockHandoverCode(id, staffOf(p).staffId, dto.reason);
  }
}
