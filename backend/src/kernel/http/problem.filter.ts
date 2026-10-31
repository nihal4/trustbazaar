import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { correlationId } from './correlation';
import { Problem, ProblemName, PROBLEMS, problemType } from './problems';

const BY_STATUS: Record<number, ProblemName> = {
  401: 'session-ended',
  403: 'forbidden',
  404: 'not-found',
  429: 'rate-limited',
};

// Turns every error into an RFC 9457 problem document (DC-3). Users get a generic title, never the
// internal message or stack (SEC-INP-06); the log gets the details with the correlation id.
@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly log = new Logger('Problem');

  catch(error: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const cid = correlationId(req);
    let status = 500;
    let body: Record<string, unknown>;

    if (error instanceof Problem) {
      status = PROBLEMS[error.problem].status;
      body = { type: problemType(error.problem), title: PROBLEMS[error.problem].title, status };
      if (error.extra.errors !== undefined) body.errors = error.extra.errors;
      if (error.extra.retryAfter !== undefined) res.setHeader('Retry-After', String(error.extra.retryAfter));
    } else if (error instanceof HttpException && error.getStatus() < 500) {
      status = error.getStatus();
      const known = BY_STATUS[status];
      if (status === 400) {
        // ValidationPipe: the messages name fields and rules, never the submitted values.
        const r = error.getResponse() as { message?: unknown };
        body = { type: problemType('validation-failed'), title: PROBLEMS['validation-failed'].title, status, errors: r.message };
      } else if (known) {
        body = { type: problemType(known), title: PROBLEMS[known].title, status };
      } else {
        body = { type: 'about:blank', title: 'The request could not be completed.', status };
      }
    } else {
      this.log.error(`${cid} ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      body = { type: problemType('internal'), title: PROBLEMS.internal.title, status: 500 };
    }

    res.status(status).type('application/problem+json').json({ ...body, correlationId: cid });
  }
}
