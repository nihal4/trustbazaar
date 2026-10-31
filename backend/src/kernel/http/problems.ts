import { HttpException } from '@nestjs/common';

// RFC 9457 problem documents (DC-3, SEC-INP-06): a stable type, a user-safe title, the status and the
// request's correlation id. Types are relative URIs, /problems/<name> (Decisions log); the web client
// recognises /step-up-required (docs/design/web/src/api.js).
export const PROBLEMS = {
  'validation-failed': { status: 400, title: 'Some of the information is not valid.' },
  'session-ended': { status: 401, title: 'Your session has ended. Please sign in again.' },
  'signin-failed': { status: 401, title: 'The number, e-mail or password is not correct.' },
  'mfa-failed': { status: 401, title: 'The code is not correct.' },
  'otp-failed': { status: 400, title: 'The code is not correct.' },
  'otp-expired': { status: 410, title: 'This code has expired or was used too many times. Please ask for a new one.' },
  'link-invalid': { status: 410, title: 'This link is not valid or has expired.' },
  'mfa-required': { status: 403, title: 'Please also enter the code from your authenticator app or a recovery code.' },
  'password-incorrect': { status: 400, title: 'The current password is not correct.' },
  'contact-unavailable': { status: 409, title: 'This number or e-mail cannot be used. Please try another one.' },
  'password-rejected': { status: 422, title: 'Please choose a different password.' },
  'registration-refused': {
    status: 409,
    title: 'We could not create an account with these details. If you already have one, sign in or reset your password.',
  },
  forbidden: { status: 403, title: 'You are not allowed to do this.' },
  'csrf-failed': { status: 403, title: 'The request could not be verified. Reload the page and try again.' },
  'step-up-required': { status: 403, title: 'Please confirm it is you to continue.' },
  'not-found': { status: 404, title: 'Not found.' },
  'refresh-retry': { status: 409, title: 'Your session was just renewed in another tab. Please try again.' },
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
