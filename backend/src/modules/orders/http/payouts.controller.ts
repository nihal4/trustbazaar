import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { correlationId } from '../../../kernel/http/correlation';
import { Staff, StepUp, Verified } from '../../../kernel/http/policies';
import { CurrentPrincipal, Principal } from '../../../kernel/http/principal';
import { Problem } from '../../../kernel/http/problems';
import { AccountInput, PayoutService } from '../services/payout.service';
import { BankAccountDecisionDto, PayoutAccountDto, PayoutsQuery, StaffReasonDto } from './orders.dto';

// Payout accounts, payouts and their staff endpoints (docs/design/02_orders_payments.pdf section 4; U2-10).
const userOf = (p: Principal) => {
  if (p.type !== 'user') throw new Problem('forbidden');
  return p;
};
const staffOf = (p: Principal) => {
  if (p.type !== 'staff') throw new Problem('forbidden');
  return p;
};
const ctx = (req: Request) => ({ ip: req.ip ?? null, correlationId: correlationId(req) });
const Id = (name: string) => Param(name, new ParseUUIDPipe({ version: '4', exceptionFactory: () => new Problem('not-found') }));

@Controller('me')
export class MyPayoutsController {
  constructor(private readonly payouts: PayoutService) {}

  /** The current (latest) payout account and its status, or null. */
  @Verified('payout')
  @Get('payout-account')
  async account(@CurrentPrincipal() p: Principal) {
    return { account: await this.payouts.getAccount(userOf(p).userId) };
  }

  /** FR-PAY-17, FR-PAY-18: add or replace, after step-up. */
  @Verified('payout')
  @StepUp('payout.change')
  @Post('payout-account')
  @HttpCode(201)
  async setAccount(@CurrentPrincipal() p: Principal, @Body() dto: PayoutAccountDto, @Req() req: Request) {
    return { account: await this.payouts.setAccount(userOf(p).userId, dto as AccountInput, ctx(req)) };
  }

  /** IF-UI-08: payout history. */
  @Verified('payout')
  @Get('payouts')
  list(@CurrentPrincipal() p: Principal, @Query() q: PayoutsQuery) {
    return this.payouts.listPayouts(userOf(p).userId, q.cursor);
  }
}

@Controller('staff')
export class StaffPayoutsController {
  constructor(private readonly payouts: PayoutService) {}

  /** Bank accounts awaiting the name check, with the KYC name to compare (the read is audited). */
  @Staff('operator')
  @Get('payout-accounts/pending')
  async pending(@CurrentPrincipal() p: Principal, @Req() req: Request) {
    return { items: await this.payouts.pendingBankAccounts(staffOf(p).staffId, ctx(req)) };
  }

  @Staff('operator')
  @Post('payout-accounts/:id/decision')
  @HttpCode(200)
  async decide(@CurrentPrincipal() p: Principal, @Id('id') id: string, @Body() dto: BankAccountDecisionDto, @Req() req: Request) {
    return { account: await this.payouts.decideBankAccount(staffOf(p).staffId, id, dto.decision, dto.reason.trim(), ctx(req)) };
  }

  /** FR-TNS-05: lift a fraud hold. */
  @Staff('operator')
  @Post('payouts/:id/release-hold')
  @HttpCode(200)
  async releaseHold(@CurrentPrincipal() p: Principal, @Id('id') id: string, @Body() dto: StaffReasonDto, @Req() req: Request) {
    return { payout: await this.payouts.releaseHold(staffOf(p).staffId, id, dto.reason.trim(), ctx(req)) };
  }
}
