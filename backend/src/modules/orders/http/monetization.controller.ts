import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { RateLimit, Verified } from '../../../kernel/http/policies';
import { CurrentPrincipal, Principal } from '../../../kernel/http/principal';
import { Problem } from '../../../kernel/http/problems';
import { MonetizationService } from '../services/monetization.service';
import { FeatureDto, StartPaymentDto } from './orders.dto';

// Monetization (docs/design/02_orders_payments.pdf sections 3.1 and 5.14; U2-06): featured listings and the
// Pro Seller subscription.
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

  /** FR-MON-06: the latest subscription, whether the user is Pro now, and CP-48's monthly price (added; Decisions log). */
  @Verified()
  @Get('me/subscription')
  mine(@CurrentPrincipal() p: Principal) {
    return this.monetization.mySubscription(userOf(p));
  }

  /** FR-MON-06, FR-MON-07: pay a month (201, the provider's page), or undo a cancellation within the paid month (200). */
  @Verified()
  @RateLimit('payment-start')
  @Post('me/subscription')
  async subscribe(@Body() dto: StartPaymentDto, @Headers('idempotency-key') key: string | undefined, @CurrentPrincipal() p: Principal, @Res({ passthrough: true }) res: Response) {
    const r = await this.monetization.subscribe(userOf(p), dto.provider, key);
    res.status(r.resumed ? 200 : 201);
    return r;
  }

  /** FR-MON-08: cancel; Pro stays until the paid month ends. */
  @Verified()
  @Delete('me/subscription')
  async cancel(@CurrentPrincipal() p: Principal) {
    return { subscription: await this.monetization.cancel(userOf(p)) };
  }
}
