import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

// Every request gets a correlation id: in X-Correlation-Id on the response, in every problem document
// (SEC-INP-06), and (with K-02) in every log line. A well-formed incoming id is kept, so a request can
// be followed through a proxy; anything else is replaced.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function correlationId(req: Request): string {
  return (req as Request & { correlationId?: string }).correlationId ?? 'unknown';
}

export function correlationMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-correlation-id');
  const id = incoming && UUID.test(incoming) ? incoming.toLowerCase() : randomUUID();
  (req as Request & { correlationId?: string }).correlationId = id;
  res.setHeader('X-Correlation-Id', id);
  next();
}
