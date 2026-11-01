import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { SignedIn, Verified } from '../../../kernel/http/policies';
import { CurrentPrincipal, Principal } from '../../../kernel/http/principal';
import { Problem } from '../../../kernel/http/problems';
import { OrderService } from '../services/order.service';
import { CheckoutDto, FulfilmentDto, OrdersQuery } from './orders.dto';

// The buyer's side of the orders API (docs/design/02_orders_payments.pdf section 3.1), U2-02. "Party to
// order" and "Buyer" are SignedIn here plus the check in OrderService, which answers not-found to anyone
// else (SEC-SDL-09). Payments are U2-03; receipts, cancellations and releases follow with U2-04 and U2-05.
const userOf = (p: Principal) => {
  if (p.type !== 'user') throw new Problem('forbidden');
  return p.userId;
};
const Id = (name: string) => Param(name, new ParseUUIDPipe({ version: '4', exceptionFactory: () => new Problem('not-found') }));

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrderService) {}

  /** FR-FIX-01, 02, 05: reserve and create the order; a repeat with the same Idempotency-Key answers 200 (I-52). */
  @Verified('buy')
  @Post()
  async checkout(
    @Body() dto: CheckoutDto,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentPrincipal() p: Principal,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { order, repeated } = await this.orders.checkout(userOf(p), dto, key);
    res.status(repeated ? 200 : 201);
    return order;
  }

  @SignedIn()
  @Get()
  list(@Query() q: OrdersQuery, @CurrentPrincipal() p: Principal) {
    return this.orders.list(userOf(p), q.role ?? 'buyer', q.cursor);
  }

  /** IF-UI-05: the order, its escrow and every deadline (I-52). */
  @SignedIn()
  @Get(':id')
  view(@Id('id') id: string, @CurrentPrincipal() p: Principal) {
    return this.orders.getOrderForParty(id, userOf(p));
  }

  /** FR-DLV-02: choose the method before paying. */
  @SignedIn()
  @Put(':id/fulfilment')
  fulfilment(@Id('id') id: string, @Body() dto: FulfilmentDto, @CurrentPrincipal() p: Principal) {
    return this.orders.chooseFulfilment(userOf(p), id, dto.fulfilment);
  }
}
