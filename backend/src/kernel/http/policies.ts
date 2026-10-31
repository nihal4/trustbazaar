import { SetMetadata } from '@nestjs/common';

// Route policies (DC-7; docs/design/01_identity_access.pdf section 4.1). Every controller method declares
// one; a method without a policy cannot be reached. These decorators only record the policy: Unit 1's
// guards enforce it. They live in the kernel so that every unit, and the kernel's own routes, can declare
// policies without importing Unit 1's internals (DC-1).
//
// Ownership rules in the design's API tables (Seller, Buyer, Participant, Assigned operator, ...) are
// checks on one object and belong in the unit's service; the route declares SignedIn or Staff.

export const VERIFIED_ACTIONS = ['list', 'bid', 'buy', 'payout'] as const;
export type VerifiedAction = (typeof VERIFIED_ACTIONS)[number];

// Must equal identity.staff_role (checked by a test in Unit 1).
export const STAFF_ROLES = ['operator', 'administrator'] as const;
export type StaffRoleName = (typeof STAFF_ROLES)[number];

// The fixed list of section 6.3 (Unit 1, step-up authentication).
export const STEP_UP_ACTIONS = [
  'password.change', 'phone.change', 'email.change', 'mfa.disable', 'recovery.regenerate',
  'payout.change', 'game.release_early', 'account.close',
] as const;
export type StepUpAction = (typeof STEP_UP_ACTIONS)[number];

// Credentials other than a session, verified by the endpoint's own service. Cross-site ones (a provider
// calling a webhook, a payment provider redirecting back) skip the Origin and CSRF checks.
export const CREDENTIALS = {
  'mfa-ticket': { crossSite: false },
  'refresh-cookie': { crossSite: false },
  'pending-staff': { crossSite: false },
  'signed-link': { crossSite: false },
  'signed-state': { crossSite: true },
  'provider-signature': { crossSite: true },
} as const;
export type CredentialKind = keyof typeof CREDENTIALS;

export type Policy =
  | { kind: 'public' }
  | { kind: 'signed-in' }
  | { kind: 'verified'; action?: VerifiedAction }
  | { kind: 'staff'; roles: StaffRoleName[] }
  | { kind: 'credential'; credential: CredentialKind };

export const POLICY_KEY = 'tb:policy';
export const STEP_UP_KEY = 'tb:step-up';
export const RATE_LIMIT_KEY = 'tb:rate-limit';

/** Anyone, including guests. */
export const Public = () => SetMetadata(POLICY_KEY, { kind: 'public' } satisfies Policy);
/** Any user with an active or suspended account. */
export const SignedIn = () => SetMetadata(POLICY_KEY, { kind: 'signed-in' } satisfies Policy);
/** FR-KYC-07: verified KYC and e-mail, an active account, and no restriction for the action. */
export const Verified = (action?: VerifiedAction) => SetMetadata(POLICY_KEY, { kind: 'verified', action } satisfies Policy);
/** An active staff account with one of the roles (none listed: any role); staff sessions exist only after MFA. */
export const Staff = (...roles: StaffRoleName[]) => SetMetadata(POLICY_KEY, { kind: 'staff', roles } satisfies Policy);
/** No session: the endpoint's service verifies this credential itself. */
export const Credential = (credential: CredentialKind) =>
  SetMetadata(POLICY_KEY, { kind: 'credential', credential } satisfies Policy);
/** In addition to the policy: a fresh single-use step-up grant for the action, in X-Step-Up (SEC-AUTH-08). */
export const StepUp = (action: StepUpAction) => SetMetadata(STEP_UP_KEY, action);
/** The rate-limit rule of Unit 1 section 5.4 that applies to this route (SEC-ABU-01). */
export const RateLimit = (rule: string) => SetMetadata(RATE_LIMIT_KEY, rule);

