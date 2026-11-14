// The public surface of Unit 7: the only files other units may import (DC-1).
// Ports this unit provides (docs/design/09_integration.pdf, section 2.1), added by the unit's tasks:
//   DisputeCommands
//   ReportCommands    (U7-04)
//   SanctionPort      (U7-04)
//   CaseQuery         (U7-04: reports; U7-03: disputes)
//   TrustQuery
//   ConfigPort: the interface and token are the kernel's (kernel/config-port.ts), provided by this unit's
//   ConfigPortModule (U7-01), so that every unit reads parameters without importing Unit 7.

/** docs/design/07_disputes_trust_staff.pdf section 3.3 (FR-TNS-01). */
export type ReportCategory = 'fraudulent' | 'counterfeit' | 'prohibited' | 'misrepresented' | 'abusive';

/**
 * What a report is about (trust.reports): the listing, user or thread, a message by its id within a thread, and the
 * user it concerns (subject_user), which the reporting unit knows (Decisions log, U6-03).
 */
export type ReportTarget =
  | { type: 'listing' | 'user' | 'thread'; id: string; subjectUserId: string }
  | { type: 'message'; id: string; messageId: string; subjectUserId: string };

/** Used by Unit 6 (FR-CHT-06). Implemented with U7-04; returns the report's id. */
export interface ReportCommands {
  report(r: { reporterId: string; target: ReportTarget; category: ReportCategory; text?: string }): Promise<string>;
}
export const REPORT_COMMANDS = Symbol('REPORT_COMMANDS');


/** What a user may do now (trust.restrictions over the live sanctions; FR-TNS-03, FR-TNS-05). Implemented with U7-04. */
export interface Restrictions {
  canSell: boolean;
  canBuyBid: boolean;
  fraudHold: boolean;
}

/** Used by Unit 1 (assertCanTransact and @Verified, I-43) and Unit 2 (payouts). */
export interface SanctionPort {
  restrictions(userId: string): Promise<Restrictions>;
}
export const SANCTION_PORT = Symbol('SANCTION_PORT');

/** The staff cases chat threads may be read through (FR-CHT-10, I-40). */
export type StaffCaseType = 'dispute' | 'report';

/**
 * Used by Unit 6's staff thread read: the operator assigned to a case, or null if nobody has claimed it.
 * Reports with U7-04; disputes with U7-03 (until then null is answered for them, and Unit 6 keeps its hold check).
 */
export interface CaseQuery {
  assignedOperator(type: StaffCaseType, caseId: string): Promise<string | null>;
}
export const CASE_QUERY = Symbol('CASE_QUERY');
