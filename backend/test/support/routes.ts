import { INestApplication, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { Policy, POLICY_KEY, STEP_UP_KEY, StepUpAction } from '../../src/kernel/http/policies';

/** One route of the running backend, as its controller declares it. */
export interface Route {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Without the global prefix, with Nest's parameters: '/orders/:id'. */
  path: string;
  policy: Policy | undefined;
  stepUp: StepUpAction | undefined;
  handler: string;
}

/** Every route of the app's controllers (test-only controllers included), sorted by path and method. */
export function routesOf(app: INestApplication): Route[] {
  const discovery = app.get(DiscoveryService);
  const scanner = app.get(MetadataScanner);
  const reflector = app.get(Reflector);
  const out: Route[] = [];
  for (const wrapper of discovery.getControllers()) {
    const cls = wrapper.metatype as (new (...a: unknown[]) => unknown) | undefined;
    if (!cls) continue;
    const base = ([] as string[]).concat(Reflect.getMetadata(PATH_METADATA, cls) ?? '')[0];
    for (const name of scanner.getAllMethodNames(cls.prototype)) {
      const handler = (cls.prototype as Record<string, (...a: unknown[]) => unknown>)[name];
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
      if (method === undefined) continue;
      for (const sub of ([] as string[]).concat(Reflect.getMetadata(PATH_METADATA, handler) ?? '')) {
        const path = `/${[base, sub].filter((p) => p && p !== '/').join('/')}`.replace(/\/+/g, '/');
        out.push({
          method: RequestMethod[method] as Route['method'],
          path,
          policy: reflector.getAllAndOverride<Policy | undefined>(POLICY_KEY, [handler, cls]),
          stepUp: reflector.getAllAndOverride<StepUpAction | undefined>(STEP_UP_KEY, [handler, cls]),
          handler: `${cls.name}.${name}`,
        });
      }
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

/** 'POST /orders/:id/payments' */
export const routeName = (r: Pick<Route, 'method' | 'path'>): string => `${r.method} ${r.path}`;

/** The route's path with each parameter replaced by `fill(name)`. */
export const fillPath = (path: string, fill: (param: string) => string): string => path.replace(/:(\w+)/g, (_m, p: string) => fill(p));
