// The console's data (docs/design/08_frontend.pdf section 7.9; Unit 7 section 2.3; Unit 1 sections 6.7 and 6.8; U8-10).
import { useQuery } from '@tanstack/react-query';
import { useApi } from '../shared/api';
import { STAFF_ME_KEY } from '../shared/me';

export type StaffRole = 'operator' | 'administrator';
/** GET /staff/me, with the session's CP-03 limits (Decisions log, U8-10). */
export interface StaffMe {
  id: string; email: string; displayName: string; role: StaffRole;
  session: { idleExpiresAt: string; absoluteExpiresAt: string } | null;
}

export function useStaffMe() {
  const api = useApi();
  return useQuery({
    queryKey: STAFF_ME_KEY,
    queryFn: ({ signal }) => api.get('/staff/me', { signal }) as Promise<StaffMe>,
    staleTime: Infinity,
    retry: false,
  });
}

/** FR-OPS-01's eight queues, in the console's order (Unit 7 section 2.3). */
export const QUEUES = ['disputes', 'reports', 'flagged_activity', 'kyc', 'listings_review', 'ownership_proofs', 'payout_accounts', 'payment_discrepancies'] as const;
export type QueueName = (typeof QUEUES)[number];

/** GET /staff/queues/{queue}: oldest first, the overdue on top; each item names where it is acted on. */
export interface QueueItem {
  id: string; ageHours: number; since: string; status: string; assignedTo: string | null; overdue?: boolean; path: string;
  [field: string]: unknown;
}

/** Cases taken before acting (FR-OPS-06): disputes and reports through Unit 7, KYC submissions through Unit 1. */
export function claimPath(queue: QueueName, id: string): string | null {
  const e = encodeURIComponent(id);
  if (queue === 'disputes') return `/staff/cases/dispute/${e}/claim`;
  if (queue === 'reports') return `/staff/cases/report/${e}/claim`;
  if (queue === 'kyc') return `/staff/kyc/submissions/${e}/claim`;
  return null;
}

/** GET /staff/approvals: the open four-eyes proposals for my role, never my own (FR-OPS-05). */
export interface Approval {
  id: string; action: string; targetType: string; targetId: string; payload: Record<string, unknown>; reason: string;
  requiredRole: StaffRole; proposedBy: string; proposedAt: string; expiresAt: string;
}
/** The four-eyes actions the server knows (Units 1, 7); any other is shown by its code. */
export const APPROVAL_ACTIONS = new Set(['account.reinstate', 'blacklist.add', 'blacklist.remove', 'disclosure.approve', 'dispute.outcome_20000', 'kyc.revoke', 'staff.mfa_reset']);

/** Hours as the console shows an age: under a day in hours, else days and hours. */
export function ageParts(hours: number): { days: number; hours: number } {
  const whole = Math.max(0, Math.floor(hours));
  return { days: Math.floor(whole / 24), hours: whole % 24 };
}
