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
  'own-proposal': { status: 403, title: 'A proposal must be decided by another staff member.' },
  'already-proposed': { status: 409, title: 'This action is already waiting for approval.' },
  'approval-closed': { status: 409, title: 'This proposal has already been decided or has expired.' },
  'conflict-of-interest': { status: 403, title: 'You cannot act on this case because of a conflict of interest.' },
  'kyc-not-allowed': { status: 409, title: 'Identity verification cannot be submitted or changed in the current status.' },
  'kyc-limit': { status: 409, title: 'You have reached the number of verification attempts for now. Please try again later.' },
  'already-claimed': { status: 409, title: 'Another operator is reviewing this submission.' },
  'not-claimed': { status: 409, title: 'Claim this submission before reviewing it.' },
  'kyc-cannot-approve': { status: 409, title: 'This submission cannot be approved; reject it with the reason shown.' },
  'transaction-not-allowed': { status: 403, title: 'Your account cannot do this right now.' },
  'config-invalid': { status: 422, title: 'These parameter values break the rules; nothing was changed.' },
  'four-eyes-required': { status: 409, title: 'This change needs a second administrator; propose it instead.' },
  'password-rejected': { status: 422, title: 'Please choose a different password.' },
  'registration-refused': {
    status: 409,
    title: 'We could not create an account with these details. If you already have one, sign in or reset your password.',
  },
  'listing-state': { status: 409, title: 'This listing cannot be changed in its current state.' },
  'listing-locked': { status: 409, title: 'This listing already has a bid or an order; add a clarification instead.' },
  'listing-not-publishable': { status: 422, title: 'This listing is not ready to publish yet.' },
  'listing-limit': { status: 409, title: 'You have reached the number of active listings your account allows.' },
  'photo-rejected': { status: 422, title: 'This photo could not be used. Please upload a JPEG, PNG or WebP image.' },
  'photo-limit': { status: 409, title: 'This listing already has the most photos allowed.' },
  'feature-off': { status: 409, title: 'This is not available right now.' },
  'request-in-progress': { status: 409, title: 'This request is still being processed. Please wait a moment.' },
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
