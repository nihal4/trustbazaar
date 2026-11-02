// The public surface of Unit 7: the only files other units may import (DC-1).
// Ports this unit provides (docs/design/09_integration.pdf, section 2.1), added by the unit's tasks:
//   DisputeCommands
//   ReportCommands
//   SanctionPort
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

