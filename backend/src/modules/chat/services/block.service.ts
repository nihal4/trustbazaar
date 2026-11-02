import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { Problem } from '../../../kernel/http/problems';
import type { BlockPort } from '../ports';

// BlockService (docs/design/06_chat_notifications.pdf section 6.5; FR-CHT-08; U6-02). A block stops messages in both
// directions and new threads between the two (database rules in chat.post and chat.open_thread), and through
// BlockPort the blocked user's purchases and bids on the blocker's listings (I-37, I-38). Orders already paid go on.
@Injectable()
export class BlockService implements BlockPort {
  constructor(private readonly db: DataSource) {}

  /** POST /blocks/{userId}: idempotent; blocking oneself is refused. */
  async block(blockerId: string, blockedId: string): Promise<void> {
    if (blockerId === blockedId) throw new Problem('validation-failed', { errors: [{ field: 'userId', reason: 'self' }] });
    try {
      await this.db.query(
        `INSERT INTO chat.blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT (blocker_id, blocked_id) DO NOTHING`,
        [blockerId, blockedId],
      );
    } catch (err) {
      // an unknown user: the foreign key; answered like any other unknown id
      if (err instanceof QueryFailedError && (err.driverError as { code?: string }).code === '23503') throw new Problem('not-found');
      throw err;
    }
  }

  /** DELETE /blocks/{userId}: only the blocker lifts their own block. */
  async unblock(blockerId: string, blockedId: string): Promise<void> {
    await this.db.query(`DELETE FROM chat.blocks WHERE blocker_id = $1 AND blocked_id = $2`, [blockerId, blockedId]);
  }

  /** The users the caller has blocked (for the client's list), newest first. */
  async blocked(blockerId: string): Promise<string[]> {
    const rows = (await this.db.query(`SELECT blocked_id FROM chat.blocks WHERE blocker_id = $1 ORDER BY created_at DESC`, [blockerId])) as { blocked_id: string }[];
    return rows.map((r) => r.blocked_id);
  }

  async assertNotBlocked(sellerId: string, buyerId: string, tx?: EntityManager): Promise<void> {
    const [r] = (await (tx ?? this.db.manager).query(
      `SELECT 1 FROM chat.blocks WHERE (blocker_id, blocked_id) IN (($1, $2), ($2, $1)) LIMIT 1`, [sellerId, buyerId],
    )) as unknown[];
    if (r) throw new Problem('blocked');
  }
}
