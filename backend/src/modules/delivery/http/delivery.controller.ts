import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Public, RateLimit, SignedIn, Verified } from '../../../kernel/http/policies';
import { CurrentPrincipal, Principal } from '../../../kernel/http/principal';
import { Problem } from '../../../kernel/http/problems';
import { AddressService } from '../services/address.service';
import { AreasService } from '../services/areas.service';
import { QuoteService } from '../services/quote.service';
import { AddressDto, FulfilmentOptionsQuery, QuoteDto } from './delivery.dto';

// Choosing a method and pricing (docs/design/04_delivery.pdf section 3.1; FR-DLV-01, 02, 07, 08, 09; U4-02). A party
// sees the other party's district only, never coordinates or an address (FR-DLV-07, FR-ACC-10).
const userOf = (p: Principal) => {
  if (p.type !== 'user') throw new Problem('forbidden');
  return p;
};
const Id = (name: string) => Param(name, new ParseUUIDPipe({ exceptionFactory: () => new Problem('not-found') }));

@Controller()
export class DeliveryController {
  constructor(
    private readonly areas: AreasService,
    private readonly quotes: QuoteService,
    private readonly addresses: AddressService,
  ) {}

  @Public()
  @Get('delivery/areas')
  listAreas() {
    return this.areas.list();
  }

  /** The methods the seller allows, the distance, the recommendation and an indicative courier fee. */
  @Verified('buy')
  @Get('listings/:id/fulfilment-options')
  options(@Id('id') id: string, @Query() q: FulfilmentOptionsQuery, @CurrentPrincipal() p: Principal) {
    return this.quotes.options(userOf(p).userId, id, q.areaId, q.quantity ?? 1);
  }

  /** A binding quote, valid for DV-23; at most 30 an hour per user (DV-23). */
  @Verified('buy')
  @RateLimit('delivery-quote')
  @Post('delivery/quotes')
  @HttpCode(201)
  quote(@Body() dto: QuoteDto, @CurrentPrincipal() p: Principal) {
    return this.quotes.issue(userOf(p).userId, dto);
  }

  @SignedIn()
  @Get('me/addresses')
  myAddresses(@CurrentPrincipal() p: Principal) {
    return this.addresses.list(userOf(p).userId);
  }

  @SignedIn()
  @Post('me/addresses')
  @HttpCode(201)
  addAddress(@Body() dto: AddressDto, @CurrentPrincipal() p: Principal) {
    return this.addresses.create(userOf(p).userId, dto);
  }

  @SignedIn()
  @Delete('me/addresses/:id')
  @HttpCode(204)
  async removeAddress(@Id('id') id: string, @CurrentPrincipal() p: Principal): Promise<void> {
    await this.addresses.remove(userOf(p).userId, id);
  }
}
