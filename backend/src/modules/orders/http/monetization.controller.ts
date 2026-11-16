import { Body, Controller, Headers, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { RateLimit, Verified } from '../../../kernel/http/policies';
import { CurrentPrincipal, Principal } from '../../../kernel/http/principal';
import { Problem } from '../../../kernel/http/problems';
import { MonetizationService } from '../services/monetization.service';
import { FeatureDto } from './orders.dto';

// Monetization (docs/design/02_orders_payments.pdf sections 3.1 and 5.14; U2-06): featured listings here;
// Pro Seller subscriptions follow.
const userOf = (p: Principal) => {
  if (p.type !== 'user') throw new Problem('forbidden');
  return p.userId;
};
const Id = (name: string) => Param(name, new ParseUUIDPipe({ version: '4', exceptionFactory: () => new Problem('not-found') }));

@Controller()
export class MonetizationController {
  constructor(private readonly monetization: MonetizationService) {}

  /** FR-MON-05: the seller pays the CP-37 fee for a featured period; answers the provider's page (I-52 on repeat). */
  @Verified('list')
  @RateLimit('payment-start')
  @Post('listings/:id/feature')
  @HttpCode(201)
  feature(@Id('id') id: string, @Body() dto: FeatureDto, @Headers('idempotency-key') key: string | undefined, @CurrentPrincipal() p: Principal) {
    return this.monetization.feature(userOf(p), id, dto.hours, dto.provider, key);
  }
}
