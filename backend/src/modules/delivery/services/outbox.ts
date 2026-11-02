import type { EntityManager } from 'typeorm';

// The unit's events (DC-6): written in the transaction that makes the change, delivered by the kernel's dispatcher.
export async function publish(m: EntityManager, eventType: string, orderId: string, payload: Record<string, unknown>): Promise<void> {
  await m.query(`INSERT INTO delivery.outbox (event_type, aggregate_id, payload) VALUES ($1, $2, $3)`, [eventType, orderId, JSON.stringify(payload)]);
}

/**
 * I-62: delivery.issue.opened for each issue this transaction opened, whether this code or a database function
 * (apply_status, record_code_entry) opened it. An issue already open for the order and kind is not opened again
 * (issues_one_open_per_kind), so it is not announced again. now() is the transaction's start, as created_at's default.
 */
export async function announceNewIssues(m: EntityManager, orderId: string): Promise<void> {
  const opened = (await m.query(
    `SELECT id, kind FROM delivery.issues WHERE order_id = $1 AND status = 'open' AND created_at = now()`, [orderId],
  )) as { id: string; kind: string }[];
  for (const i of opened) await publish(m, 'delivery.issue.opened', orderId, { issueId: i.id, orderId, kind: i.kind });
}
