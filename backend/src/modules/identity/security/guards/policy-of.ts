import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { POLICY_KEY, Policy } from '../../../../kernel/http/policies';
import type { PrincipalRequest } from '../../../../kernel/http/principal';
import type { CookieSet } from '../cookies';

export type TbRequest = Request & PrincipalRequest & { tbCookies?: CookieSet };

export const policyOf = (reflector: Reflector, ctx: ExecutionContext): Policy | undefined =>
  reflector.getAllAndOverride<Policy | undefined>(POLICY_KEY, [ctx.getHandler(), ctx.getClass()]);

export const requestOf = (ctx: ExecutionContext): TbRequest => ctx.switchToHttp().getRequest<TbRequest>();
