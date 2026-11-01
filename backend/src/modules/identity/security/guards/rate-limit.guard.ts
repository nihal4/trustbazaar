import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CLOCK, Clock } from '../../../../kernel/clock';
import { TbConfig } from '../../../../kernel/config/config';
import { TB_CONFIG } from '../../../../kernel/config/config.provider';
import { RATE_LIMIT_KEY } from '../../../../kernel/http/policies';
import { Problem } from '../../../../kernel/http/problems';
import { verifyAccessToken } from '../access-token';
import { cookiesFor } from '../cookies';
import { CONFIG_PORT, ConfigPort } from '../../../../kernel/config-port';
import { RATE_RULES } from '../rate-rules';
import { RateLimiter } from '../rate-limiter.service';
import { policyOf, requestOf } from './policy-of';

// 1. RateLimitGuard (Unit 1 section 4.1): the route's rule, before any database work; 429 with Retry-After.
// A per-principal limit takes the subject from the access token's signature alone (no database read);
// without a valid token it counts against the source address.
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimiter,
    @Inject(TB_CONFIG) private readonly config: TbConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(CONFIG_PORT) private readonly params: ConfigPort,
  ) {}

  private async fromConfig(cp: { code: string; field: string }, fallback: number): Promise<number> {
    const v = (await this.params.current()).get<Record<string, unknown>>(cp.code)?.[cp.field];
    return typeof v === 'number' && v > 0 ? v : fallback;
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const rule = this.reflector.getAllAndOverride<string | undefined>(RATE_LIMIT_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!rule) return true;
    const limits = RATE_RULES[rule];
    if (!limits) throw new Error(`unknown rate-limit rule "${rule}"`);
    const req = requestOf(ctx);
    for (const l of limits) {
      let subject = `ip:${req.ip}`;
      if (l.per === 'principal') {
        const token = req.cookies?.[cookiesFor(policyOf(this.reflector, ctx)).access];
        const claims = typeof token === 'string' ? verifyAccessToken(this.config.keys.jwt, token, this.clock.now()) : null;
        if (claims) subject = `${claims.pt}:${claims.sub}`;
      }
      const limit = l.cp ? await this.fromConfig(l.cp, l.limit) : l.limit;
      const r = await this.limiter.hit(`rl:${rule}:${subject}`, limit, l.windowSeconds);
      if (!r.allowed) throw new Problem('rate-limited', { retryAfter: r.retryAfterSeconds });
    }
    return true;
  }
}
