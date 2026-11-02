import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Credential, SignedIn } from '../../../kernel/http/policies';
import { CurrentPrincipal, Principal } from '../../../kernel/http/principal';
import { Problem } from '../../../kernel/http/problems';
import { ShipmentService } from '../services/shipment.service';
import { StatusService } from '../services/status.service';
import { PickupAddressDto } from './delivery.dto';

// Courier shipments (docs/design/04_delivery.pdf section 3.1; FR-DLV-10 to FR-DLV-14; U4-04). "Buyer or seller" is
// SignedIn here plus ShipmentService's check through Unit 2's getOrderForParty, which answers not-found to anyone
// else (SEC-SDL-09). The webhook has no session: the provider's signature is its credential (IF-COM-03).
const userOf = (p: Principal) => {
  if (p.type !== 'user') throw new Problem('forbidden');
  return p;
};
const Id = (name: string) => Param(name, new ParseUUIDPipe({ exceptionFactory: () => new Problem('not-found') }));

@Controller()
export class ShipmentController {
  constructor(private readonly shipments: ShipmentService) {}

  /** FR-DLV-10, FR-DLV-14: status and history, "simulated", and the caller's own address only. */
  @SignedIn()
  @Get('orders/:id/shipments')
  view(@Id('id') id: string, @CurrentPrincipal() p: Principal) {
    return this.shipments.view(userOf(p).userId, id);
  }

  /** Section 7.2, step 1: the seller's saved pickup address, while the shipment is preparing. */
  @SignedIn()
  @Put('orders/:id/shipment/pickup-address')
  pickupAddress(@Id('id') id: string, @Body() dto: PickupAddressDto, @CurrentPrincipal() p: Principal) {
    return this.shipments.setPickupAddress(userOf(p).userId, id, dto.addressId);
  }

  /** FR-DSP-06(d): the seller confirms the returned item has arrived. */
  @SignedIn()
  @Post('orders/:id/return/received')
  @HttpCode(200)
  returnReceived(@Id('id') id: string, @CurrentPrincipal() p: Principal) {
    return this.shipments.returnReceived(userOf(p).userId, id);
  }
}

@Controller('webhooks/courier')
export class CourierWebhookController {
  constructor(private readonly statuses: StatusService) {}

  /** IF-COM-03, SEC-PAY-03, SEC-PAY-04: verified against the raw body and the CP-32 tolerance. */
  @Credential('provider-signature')
  @Post(':provider')
  @HttpCode(200)
  receive(@Param('provider') provider: string, @Req() req: Request & { rawBody?: Buffer }, @Headers() headers: Record<string, string | string[] | undefined>) {
    return this.statuses.webhook(provider, headers, req.rawBody ?? Buffer.alloc(0));
  }
}
