import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { Logger } from '@nestjs/common';
import { withCorrelation } from '../logging/context';

// Every request gets a correlation id: in X-Correlation-Id on the response, in every problem document
// (SEC-INP-06), and in every log line written while the request is handled (K-02, kernel/logging). A well-formed
// incoming id is kept, so a request can be followed through a proxy; anything else is replaced.
// When the response is sent, one line records the method, the path without its query, the status and the time taken;
// no header, query or body is logged (SEC-DAT-07).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function correlationId(req: Request): string {
  return (req as Request & { correlationId?: string }).correlationId ?? 'unknown';
}

export function correlationMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-correlation-id');
  const id = incoming && UUID.test(incoming) ? incoming.toLowerCase() : randomUUID();
  (req as Request & { correlationId?: string }).correlationId = id;
  res.setHeader('X-Correlation-Id', id);
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number((process.hrtime.bigint() - started) / 1000n) / 1000;
    const line = { msg: 'request', method: req.method, path: req.originalUrl.split('?')[0], status: res.statusCode, ms };
    withCorrelation(id, () => (res.statusCode >= 500 ? access.warn(line) : access.log(line)));
  });
  withCorrelation(id, next);
}

const access = new Logger('http');
