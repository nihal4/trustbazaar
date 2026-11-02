import type { EntityManager } from 'typeorm';

// The public surface of Unit 6: the only files other units may import (DC-1).
// Ports this unit provides (docs/design/09_integration.pdf, section 2.1), added by the unit's tasks:
//   NotificationPort (U6-05)
//   Notifier (U6-04)
//   BlockPort (U6-02, below)
//   ChatCommands (U6-03)

/** Used by Unit 7 for decisions and reports (FR-TNS-09): one notice, once per dedupe key. */
export interface Notifier {
  notify(userId: string, template: string, params: Record<string, string | number | boolean>, dedupeKey: string): Promise<void>;
}
export const NOTIFIER = Symbol('NOTIFIER');

/** Used by Unit 1 (Unit 1 section 4.5; I-36): codes, links and account notices, sent at once. */
export interface NotificationPort {
  sendSms(phone: string, template: string, vars: Record<string, string>): Promise<void>;
  sendEmail(address: string, template: string, vars: Record<string, string>): Promise<void>;
}
export const NOTIFICATION_PORT = Symbol('NOTIFICATION_PORT');

/** What a NotificationPort was asked to send (kept for the tests). */
export interface SentMessage {
  channel: 'sms' | 'email';
  to: string;
  template: string;
  vars: Record<string, string>;
}

/**
 * FR-CHT-08: while a block exists in either direction, the blocked user cannot buy from or bid on the blocker's
 * listings (Units 2 and 3; I-37, I-38). Throws the problem `blocked` (403).
 */
export interface BlockPort {
  /** With tx, read on the caller's transaction (no second pool connection). */
  assertNotBlocked(sellerId: string, buyerId: string, tx?: EntityManager): Promise<void>;
}
export const BLOCK_PORT = Symbol('BLOCK_PORT');
