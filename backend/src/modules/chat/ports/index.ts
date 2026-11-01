// The public surface of Unit 6: the only files other units may import (DC-1).
// Ports this unit provides (docs/design/09_integration.pdf, section 2.1), added by the unit's tasks:
//   NotificationPort (U6-05, with the e-mail and SMS adapters)
//   Notifier (U6-04)
//   ChatCommands, BlockPort (U6-02, U6-03)

/** Used by Unit 7 for decisions and reports (FR-TNS-09): one notice, once per dedupe key. */
export interface Notifier {
  notify(userId: string, template: string, params: Record<string, string | number | boolean>, dedupeKey: string): Promise<void>;
}
export const NOTIFIER = Symbol('NOTIFIER');
