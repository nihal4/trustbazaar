import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { timingSafeEqual } from 'crypto';
import type Redis from 'ioredis';
import { STEP_UP_KEY, StepUpAction } from '../../../../kernel/http/policies';
import { Problem } from '../../../../kernel/http/problems';
import { REDIS } from '../../../../kernel/redis.provider';
import { hashGrant, stepUpKey } from '../step-up';
import { requestOf } from './policy-of';

// 5. StepUpGuard (Unit 1 sections 4.1 and 6.3; SEC-AUTH-08). For @StepUp(action): the X-Step-Up header must
// carry a grant whose hash is stored for this session and this action. The key is read and deleted in one
// step (GETDEL), so a grant works once, for one action, in one session. Without one: 403 step-up-required,
// which the web client answers by asking for the second factor.
@Injectable()
export class StepUpGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const action = this.reflector.getAllAndOverride<StepUpAction | undefined>(STEP_UP_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!action) return true;
    const req = requestOf(ctx);
    if (!req.principal) throw new Problem('session-ended');
    const grant = req.header('x-step-up');
    if (!grant) throw new Problem('step-up-required');
    const stored = await this.redis.getdel(stepUpKey(req.principal.sessionId, action));
    const given = Buffer.from(hashGrant(grant), 'hex');
    if (!stored || stored.length !== 64 || !timingSafeEqual(Buffer.from(stored, 'hex'), given)) {
      throw new Problem('step-up-required');
    }
    return true;
  }
}
