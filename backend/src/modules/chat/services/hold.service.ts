import { Inject, Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { DataSource, QueryFailedError } from 'typeorm';
import { Problem } from '../../../kernel/http/problems';
import type { Principal } from '../../../kernel/http/principal';
import { FILE_VAULT, FileVaultPort, IDENTITY_QUERY, IdentityQuery } from '../../identity/ports';
import { CASE_QUERY, CaseQuery } from '../../trust/ports';
import type { CaseType, ChatCommands } from '../ports';

// HoldService and the retention job (docs/design/06_chat_notifications.pdf sections 3.3, 6.5 and 6.6; FR-CHT-04,
// FR-CHT-10, SEC-LOG-01; U6-03). Unit 7 places a hold on a thread for each dispute or report that concerns it
// (ChatCommands, I-40). A live hold keeps the thread past retention and is the only ground on which an operator reads
// it: chat.staff_read checks the hold of that very case and logs the read. Whether the operator is the one working the
// case is Unit 7's check (CaseQuery, found on first use since Unit 7 imports this unit): reports since U7-04,
// disputes since U7-03 (Decisions log, U6-03).

/** The SRS retention schedule: a thread's content is kept 1 year after its last message. */
export const CHAT_RETENTION = '1 year';

export interface StaffMessageView {
  seq: number;
  from: 'buyer' | 'seller';
  kind: 'text' | 'image';
  text: string | null;
  caption: string | null;
  image: { url: string; expiresAt: string } | null;
  flags: string[];
  at: string;
  removed: boolean;
}

@Injectable()
export class HoldService implements ChatCommands {
  private readonly log = new Logger('HoldService');

  constructor(
    private readonly db: DataSource,
    @Inject(IDENTITY_QUERY) private readonly identity: IdentityQuery,
    @Inject(FILE_VAULT) private readonly vault: FileVaultPort,
    private readonly modules: ModuleRef,
  ) {}

  async hold(threadId: string, caseType: CaseType, caseId: string): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO chat.thread_holds (thread_id, case_type, case_id) VALUES ($1, $2, $3) ON CONFLICT (thread_id, case_type, case_id) DO NOTHING`,
        [threadId, caseType, caseId],
      );
    } catch (err) {
      if (err instanceof QueryFailedError && (err.driverError as { code?: string }).code === '23503') throw new Problem('not-found');
      throw err;
    }
  }

  async release(threadId: string, caseType: CaseType, caseId: string): Promise<void> {
    await this.db.query(
      `UPDATE chat.thread_holds SET released_at = now() WHERE thread_id = $1 AND case_type = $2 AND case_id = $3 AND released_at IS NULL`,
      [threadId, caseType, caseId],
    );
  }

  async threadFor(listingId: string, buyerId: string): Promise<string | null> {
    const [t] = (await this.db.query(`SELECT id FROM chat.threads WHERE listing_id = $1 AND buyer_id = $2`, [listingId, buyerId])) as { id: string }[];
    return t?.id ?? null;
  }

  /**
   * GET /staff/cases/{type}/{caseId}/threads/{id} (FR-CHT-10): the whole thread, read and logged by chat.staff_read in
   * one statement. Without a live hold of this case the answer is not-found, as for an unknown thread. Images come
   * with a link for the operator's session; Unit 1 records the file view with the case as its reason.
   */
  async staffRead(staff: Principal & { type: 'staff' }, caseType: CaseType, caseId: string, threadId: string) {
    // only the operator who claimed the case reads through it (FR-OPS-06; reports U7-04, disputes U7-03)
    if ((await this.modules.get<CaseQuery>(CASE_QUERY, { strict: false }).assignedOperator(caseType, caseId)) !== staff.staffId) {
      throw new Problem('not-found');
    }
    const [t] = (await this.db.query(`SELECT listing_id, buyer_id, seller_id, purged_at FROM chat.threads WHERE id = $1`, [threadId])) as {
      listing_id: string; buyer_id: string; seller_id: string; purged_at: Date | null;
    }[];
    if (!t) throw new Problem('not-found');
    let rows: { seq: string; sender_id: string; kind: 'text' | 'image'; body: string | null; image_key: string | null; flags: string[]; created_at: Date; purged_at: Date | null }[];
    try {
      rows = await this.db.query(
        `SELECT seq::text, sender_id, kind, body, image_key, flags, created_at, purged_at FROM chat.staff_read($1, $2, $3::chat.case_type, $4)`,
        [threadId, staff.staffId, caseType, caseId],
      );
    } catch (err) {
      if (err instanceof QueryFailedError && (err.driverError as { code?: string }).code === '42501') throw new Problem('not-found');
      throw err;
    }
    const [buyer, seller] = await Promise.all([t.buyer_id, t.seller_id].map((id) => this.identity.getPublicProfile(id).catch(() => null)));
    const reason = `Chat thread for ${caseType} case ${caseId}`;
    return {
      threadId,
      listingId: t.listing_id,
      buyer: buyer ? { displayName: buyer.displayName, verified: buyer.verified } : null,
      seller: seller ? { displayName: seller.displayName, verified: seller.verified } : null,
      closed: t.purged_at !== null,
      messages: await Promise.all(rows.map(async (m): Promise<StaffMessageView> => ({
        seq: Number(m.seq),
        from: m.sender_id === t.buyer_id ? 'buyer' : 'seller',
        kind: m.kind,
        text: m.kind === 'text' ? m.body : null,
        caption: m.kind === 'image' ? m.body : null,
        image: m.kind === 'image' && m.image_key ? await this.vault.signedLink(m.image_key, staff, reason) : null,
        flags: m.flags,
        at: m.created_at.toISOString(),
        removed: m.purged_at !== null,
      }))),
    };
  }

  /**
   * The daily retention job (section 8): chat.purge_due removes the content of threads silent for a year without a
   * live hold and returns their image keys; the files are then erased. A file that cannot be erased is logged and
   * left; its key is gone from the database, so it is unreachable.
   */
  async purgeDue(): Promise<number> {
    const keys = (await this.db.query(`SELECT k FROM chat.purge_due($1::interval) AS k`, [CHAT_RETENTION])) as { k: string }[];
    for (const { k } of keys) {
      try {
        await this.vault.erase(k);
      } catch (err) {
        this.log.warn(`chat image not erased: ${(err as Error).message}`);
      }
    }
    return keys.length;
  }
}
