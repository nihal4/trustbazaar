import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { collectRows, DataExportSource } from '../../../kernel/privacy/data-export';

// Unit 6's part of the data export (FR-PRV-03; U7-11): the user's conversations and the messages the user sent (text;
// an image as its kind only), blocks, notifications, preferences, reminders and watched listings. Messages already
// purged under the retention schedule are gone.
const Q = {
  threads: `SELECT jsonb_build_object('id', id, 'listingId', listing_id, 'role', CASE WHEN buyer_id = $1 THEN 'buyer' ELSE 'seller' END,
                   'createdAt', created_at, 'lastMessageAt', last_message_at) AS r
              FROM chat.threads WHERE buyer_id = $1 OR seller_id = $1 ORDER BY created_at, id`,
  messagesSent: `SELECT jsonb_build_object('threadId', thread_id, 'seq', seq, 'kind', kind, 'body', body, 'createdAt', created_at) AS r
                   FROM chat.messages WHERE sender_id = $1 AND purged_at IS NULL ORDER BY created_at, id`,
  blocks: `SELECT jsonb_build_object('blockedUserId', blocked_id, 'createdAt', created_at) AS r FROM chat.blocks WHERE blocker_id = $1 ORDER BY created_at`,
  notifications: `SELECT to_jsonb(n) - '{user_id,dedupe_key}'::text[] AS r FROM notify.notifications n WHERE user_id = $1 ORDER BY created_at, id`,
  preferences: `SELECT to_jsonb(p) - 'user_id' AS r FROM notify.preferences p WHERE user_id = $1`,
  reminders: `SELECT to_jsonb(m) - 'user_id' AS r FROM notify.reminders m WHERE user_id = $1 ORDER BY due_at, id`,
  watches: `SELECT to_jsonb(w) - 'user_id' AS r FROM notify.watches w WHERE user_id = $1 ORDER BY created_at`,
};

@Injectable()
export class ChatDataExport implements DataExportSource {
  readonly section = 'chat';
  constructor(private readonly db: DataSource) {}
  exportFor(userId: string) {
    return collectRows(this.db, Q, userId);
  }
}
