import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { RateLimit, SignedIn, StepUp, Verified } from '../../../kernel/http/policies';
import { CurrentPrincipal, Principal } from '../../../kernel/http/principal';
import { Problem } from '../../../kernel/http/problems';
import { EscrowService } from '../services/escrow.service';
import { OrderService } from '../services/order.service';
import { CancellationDecisionDto, CancellationDto, CheckoutDto, FulfilmentDto, OrdersQuery } from './orders.dto';

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
  @RateLimit('checkout')
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

/**
 * After payment (docs/design/02_orders_payments.pdf sections 5.7 and 5.8), U2-05: the buyer's release and
 * cancellation request, the seller's answer and own cancellation. Each answers with the order as the caller sees it.
 */
@Controller('orders')
export class OrderActionsController {
  constructor(
    private readonly escrow: EscrowService,
    private readonly orders: OrderService,
  ) {}

  /** FR-PAY-07(a): release to the seller after the delivery event. */
  @SignedIn()
  @Post(':id/confirm-receipt')
  @HttpCode(200)
  async confirmReceipt(@Id('id') id: string, @CurrentPrincipal() p: Principal) {
    await this.escrow.confirmReceipt(userOf(p), id);
    return this.orders.getOrderForParty(id, userOf(p));
  }

  /** FR-GAM-17: a game-account buyer releases before the protection period ends; needs a fresh step-up. */
  @SignedIn()
  @StepUp('game.release_early')
  @Post(':id/release-early')
  @HttpCode(200)
  async releaseEarly(@Id('id') id: string, @CurrentPrincipal() p: Principal) {
    await this.escrow.releaseEarly(userOf(p), id);
    return this.orders.getOrderForParty(id, userOf(p));
  }

  /** FR-PAY-09: the buyer asks to cancel before the delivery event. */
  @SignedIn()
  @Post(':id/cancellation-requests')
  async requestCancellation(@Id('id') id: string, @Body() dto: CancellationDto, @CurrentPrincipal() p: Principal) {
    await this.escrow.requestCancellation(userOf(p), id, dto.reason);
    return this.orders.getOrderForParty(id, userOf(p));
  }

  /** FR-PAY-09: the seller accepts (full refund) or declines. */
  @SignedIn()
  @Post(':id/cancellation-requests/:rid/decision')
  @HttpCode(200)
  async decide(@Id('id') id: string, @Id('rid') rid: string, @Body() dto: CancellationDecisionDto, @CurrentPrincipal() p: Principal) {
    await this.escrow.decideCancellation(userOf(p), id, rid, dto.decision);
    return this.orders.getOrderForParty(id, userOf(p));
  }

  /** FR-PAY-09, FR-TNS-04: the seller cancels after payment: a full refund and a strike. */
  @SignedIn()
  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(@Id('id') id: string, @Body() dto: CancellationDto, @CurrentPrincipal() p: Principal) {
    await this.escrow.sellerCancel(userOf(p), id, dto.reason);
    return this.orders.getOrderForParty(id, userOf(p));
  }
}
