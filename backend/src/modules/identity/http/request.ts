import type { Request } from 'express';
import { correlationId } from '../../../kernel/http/correlation';
import { wasHumanChecked } from '../security/human-check';
import type { RequestContext } from '../services/session.service';

/** The request's address, browser and correlation id, for sessions and the audit log. */
export const ctxOf = (req: Request): RequestContext => ({
  ip: req.ip ?? null,
  userAgent: req.header('user-agent') ?? null,
  correlationId: correlationId(req),
  humanProof: req.header('x-human-proof') ?? undefined,
  humanChecked: wasHumanChecked(req),
});

/** A cookie's value, or undefined when absent or empty. */
export const cookie = (req: Request, name: string): string | undefined => {
  const v = (req.cookies as Record<string, unknown> | undefined)?.[name];
  return typeof v === 'string' && v !== '' ? v : undefined;
};
