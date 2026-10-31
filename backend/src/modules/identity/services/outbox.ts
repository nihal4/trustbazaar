import { EntityManager } from 'typeorm';
import { IdentityOutboxEvent } from '../db/entities';

// DC-6: an event is written to the unit's outbox in the same transaction as the change it announces.
// The kernel's dispatcher (K-04) delivers it to the consumers (here mostly Notifications, Unit 6).
export async function publish(
  manager: EntityManager,
  eventType: `identity.${string}.${string}`,
  aggregateId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await manager.getRepository(IdentityOutboxEvent).insert({ eventType, aggregateId, payload });
}
