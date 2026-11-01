import { EntityManager } from 'typeorm';
import { JournalEntry, JournalLine } from '../db/entities';
import type { EntryKind } from '../db/enums';

// The double-entry ledger (docs/design/02_orders_payments.pdf section 4.3; FR-PAY-13, DR-05). Debits are
// positive, credits negative; the database refuses an entry that does not sum to zero at commit. A line of
// zero is left out (the database refuses those too): a release with no delivery fee has no courier lines.
export type Line = [account: string, partyId: string | null, amount: bigint];

export async function post(m: EntityManager, kind: EntryKind, orderId: string | null, sourceId: string | null, memo: string, lines: Line[]): Promise<void> {
  const { identifiers } = await m.getRepository(JournalEntry).insert({ kind, orderId, sourceId, memo });
  for (const [accountCode, partyId, amount] of lines) {
    if (amount === 0n) continue;
    await m.getRepository(JournalLine).insert({ entryId: identifiers[0].id as string, accountCode, partyId, amount: amount.toString() });
  }
}
