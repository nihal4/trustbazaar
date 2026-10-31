import { createHash } from 'crypto';

// Step-up grants (Unit 1 section 6.3, SEC-AUTH-08): only the hash of a grant is kept in Redis, under
// stepup:{sid}:{action}, for DV-2 (5 minutes); StepUpGuard consumes it with GETDEL. Issuing is U1-05.
export const STEP_UP_SECONDS = 300; // DV-2
export const stepUpKey = (sessionId: string, action: string) => `stepup:${sessionId}:${action}`;
export const hashGrant = (grant: string) => createHash('sha256').update(grant).digest('hex');
