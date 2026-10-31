import { HttpException } from '@nestjs/common';

// RFC 9457 problem documents (DC-3, SEC-INP-06): a stable type, a user-safe title, the status and the
// request's correlation id. Types are relative URIs, /problems/<name> (Decisions log); the web client
// recognises /step-up-required (docs/design/web/src/api.js).
export const PROBLEMS = {
  'validation-failed': { status: 400, title: 'Some of the information is not valid.' },
  'session-ended': { status: 401, title: 'Your session has ended. Please sign in again.' },
  forbidden: { status: 403, title: 'You are not allowed to do this.' },
  'csrf-failed': { status: 403, title: 'The request could not be verified. Reload the page and try again.' },
  'step-up-required': { status: 403, title: 'Please confirm it is you to continue.' },
  'not-found': { status: 404, title: 'Not found.' },
  'rate-limited': { status: 429, title: 'Too many requests. Please try again later.' },
  internal: { status: 500, title: 'Something went wrong. Please try again.' },
} as const;
export type ProblemName = keyof typeof PROBLEMS;

export class Problem extends HttpException {
  constructor(
    readonly problem: ProblemName,
    readonly extra: { retryAfter?: number; errors?: unknown } = {},
  ) {
    super(PROBLEMS[problem].title, PROBLEMS[problem].status);
  }
}

export const problemType = (name: string) => `/problems/${name}`;
