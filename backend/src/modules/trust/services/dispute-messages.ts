// The dispute chat (U10-23, Decisions log): what TrustBazaar tells one party about its dispute, kept as the notice template and its parameters, beside the
// notice itself. The parties never see each other's words; each sees its own statements and these messages.
import { Logger } from '@nestjs/common';

interface Queryable { query(sql: string, params?: unknown[]): Promise<unknown> }
const log = new Logger('DisputeMessages');

/** Keeps one message for one party; the same key twice is one message (the notice's own dedupe key). A failure is logged and never stops the dispute. */
export async function recordMessage(db: Queryable, disputeId: string, userId: string, template: string, params: Record<string, unknown>, key: string): Promise<void> {
  try {
    await db.query(
      `INSERT INTO disputes.messages (dispute_id, user_id, template, params, key) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (user_id, key) DO NOTHING`,
      [disputeId, userId, template, JSON.stringify(params), key],
    );
  } catch (err) {
    log.warn(`message ${template} of dispute ${disputeId}: ${(err as Error).message}`);
  }
}

/** The dispute id inside a notice key `dispute:<id>:...`, or null. */
export const disputeOfKey = (key: string): string | null => /^dispute:([0-9a-f-]{36}):/.exec(key)?.[1] ?? null;
