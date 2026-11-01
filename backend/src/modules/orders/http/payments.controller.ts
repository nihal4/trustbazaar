import { Body, Controller, Get, Headers, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import type Redis from 'ioredis';
import { CLOCK, Clock } from '../../../kernel/clock';
import { TbConfig } from '../../../kernel/config/config';
import { TB_CONFIG } from '../../../kernel/config/config.provider';
import { CONFIG_PORT, ConfigPort } from '../../../kernel/config-port';
import { Credential, Public, RateLimit, Verified } from '../../../kernel/http/policies';
import { CurrentPrincipal, Principal } from '../../../kernel/http/principal';
import { Problem } from '../../../kernel/http/problems';
import { REDIS } from '../../../kernel/redis.provider';
import { MockProvider } from '../adapters/mock-provider';
import type { ProviderId } from '../adapters/payment-provider';
import { StripeProvider, StripeSignatureError, verifyStripeSignature } from '../adapters/stripe-provider';
import { PaymentService } from '../services/payment.service';
import { MockPayDto, StartPaymentDto } from './orders.dto';

// Payments (docs/design/02_orders_payments.pdf sections 3.1, 5.5 and 7.1), U2-03.
const userOf = (p: Principal) => {
  if (p.type !== 'user') throw new Problem('forbidden');
  return p.userId;
};
const Id = (name: string) => Param(name, new ParseUUIDPipe({ version: '4', exceptionFactory: () => new Problem('not-found') }));
const providerOf = (p: string): ProviderId => {
  if (p !== 'bkash' && p !== 'nagad' && p !== 'stripe') throw new Problem('not-found');
  return p;
};
const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

@Controller()
export class PaymentsController {
  constructor(
    private readonly payments: PaymentService,
    @Inject(TB_CONFIG) private readonly config: TbConfig,
  ) {}

  /** FR-PAY-01: the provider's page to pay on; a repeat with the same Idempotency-Key gives the same attempt (I-52). */
  @Verified('buy')
  @RateLimit('payment-start')
  @Post('orders/:id/payments')
  @HttpCode(201)
  start(@Id('id') id: string, @Body() dto: StartPaymentDto, @Headers('idempotency-key') key: string | undefined, @CurrentPrincipal() p: Principal) {
    return this.payments.start(userOf(p), id, dto.provider, key);
  }

  /** FR-PAY-02: where the browser lands after the provider; it shows the status and never confirms. */
  @Public()
  @Get('payments/return/:provider')
  status(@Param('provider') provider: string, @Query('attempt', new ParseUUIDPipe({ version: '4', exceptionFactory: () => new Problem('not-found') })) attempt: string) {
    providerOf(provider);
    return this.payments.status(attempt);
  }

  /** bKash, Nagad and the mock: the browser's callback. Its content is ignored; the server asks the provider. */
  @Credential('signed-state')
  @Get('callbacks/:provider/:attemptId')
  async callback(@Param('provider') provider: string, @Id('attemptId') attemptId: string, @Query('state') state: string | undefined, @Res() res: Response) {
    const { orderId, outcome } = await this.payments.callback(providerOf(provider), attemptId, state);
    res.redirect(303, `${this.config.publicOrigin}/orders/${orderId}?payment=${attemptId}&result=${outcome}`);
  }
}

/** SEC-PAY-03, SEC-PAY-04: Stripe's webhook, verified against the raw body and the CP-32 tolerance. */
@Controller('webhooks')
export class StripeWebhookController {
  constructor(
    private readonly payments: PaymentService,
    @Inject(TB_CONFIG) private readonly config: TbConfig,
    @Inject(CONFIG_PORT) private readonly params: ConfigPort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Credential('provider-signature')
  @Post('stripe')
  @HttpCode(200)
  async stripe(@Req() req: Request & { rawBody?: Buffer }, @Headers('stripe-signature') signature: string | undefined) {
    const secret = this.config.providers.stripeWebhookSecret;
    if (this.config.paymentMode !== 'sandbox' || !secret) throw new Problem('not-found');
    const tolerance = (await this.params.current()).ms('CP-32', 'tolerance') / 1000;
    const raw = req.rawBody ?? Buffer.alloc(0);
    try {
      verifyStripeSignature(raw, signature, secret.reveal(), tolerance, Math.floor(this.clock.now().getTime() / 1000));
    } catch (err) {
      if (err instanceof StripeSignatureError) throw new Problem('validation-failed', { errors: [{ field: 'Stripe-Signature', reason: 'invalid' }] });
      throw err;
    }
    const result = StripeProvider.fromEvent(raw);
    if (!result) return { received: true, handled: false };
    return { received: true, outcome: await this.payments.confirm('stripe', result) };
  }
}

/**
 * The mock provider's payment page (PAYMENT_MODE=mock only; Decisions log, U2-03). It stands in for the
 * provider's own page: the buyer chooses to pay or to fail, the "provider" records it, and the browser is
 * sent to the callback, where the server asks the mock provider what happened, as it would ask bKash.
 */
@Controller('mock-provider')
export class MockPayController {
  constructor(
    private readonly payments: PaymentService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Credential('signed-state')
  @Get(':attemptId')
  async page(@Id('attemptId') attemptId: string, @Query('state') state: string | undefined, @Res() res: Response) {
    const a = await this.payments.mockAttempt(attemptId, state);
    const taka = (BigInt(a.amount) / 100n).toLocaleString('en-IN') + '.' + (BigInt(a.amount) % 100n).toString().padStart(2, '0');
    const action = `/api/v1/mock-provider/${attemptId}?state=${encodeURIComponent(state ?? '')}`;
    const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mock ${escape(a.provider)} payment</title></head><body>
<h1>Simulated ${escape(a.provider)} payment</h1>
<p>This is the mock payment provider of a TrustBazaar test system. No money moves.</p>
<p>Amount: BDT ${escape(taka)}</p><p>Attempt status: ${escape(a.status)}</p>
<form method="post" action="${escape(action)}"><button name="outcome" value="succeeded">Pay</button> <button name="outcome" value="failed">Fail the payment</button></form>
</body></html>`;
    res
      .status(200)
      .set({
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      })
      .send(body);
  }

  @Credential('signed-state')
  @Post(':attemptId')
  async decide(@Id('attemptId') attemptId: string, @Query('state') state: string | undefined, @Body() dto: MockPayDto, @Res() res: Response) {
    const a = await this.payments.mockAttempt(attemptId, state);
    await MockProvider.decide(this.redis, attemptId, dto.outcome);
    res.redirect(303, a.callbackUrl);
  }
}
