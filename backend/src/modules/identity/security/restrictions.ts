import type { VerifiedAction } from '../../../kernel/http/policies';

// @Verified(action) also requires that the user has no restriction for the action (Unit 1 section 4.1).
// Restrictions are decided by Unit 7 and read through its SanctionPort (I-43). Until Unit 7 provides it,
// this port answers "no restriction" (Decisions log); U7 replaces the provider.
export interface Restrictions {
  isRestricted(userId: string, action: VerifiedAction): Promise<boolean>;
}

export const RESTRICTIONS = Symbol('RESTRICTIONS');

export const noRestrictionsYet: Restrictions = { isRestricted: async () => false };
