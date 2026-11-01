import { EntityManager } from 'typeorm';
import { AuctionsOutboxEvent } from '../db/entities';

// DC-6: an event is written to the unit's outbox (auctions.outbox, which takes listings.* and auctions.*
// names) in the same transaction as the change it announces. The kernel's dispatcher (K-04) delivers it.
export async function publish(
  manager: EntityManager,
  eventType: `listings.${string}.${string}` | `auctions.${string}.${string}`,
  aggregateId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await manager.getRepository(AuctionsOutboxEvent).insert({ eventType, aggregateId, payload });
}
