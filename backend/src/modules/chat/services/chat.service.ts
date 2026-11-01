import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { cursorAt, decodeCursor, encodeCursor } from '../../../kernel/http/cursor';
import { Problem } from '../../../kernel/http/problems';
import type { Principal } from '../../../kernel/http/principal';
import { LIVE, LivePort } from '../../../kernel/live/live';
import { FILE_VAULT, FileVaultPort, IDENTITY_QUERY, IdentityQuery, RATE_LIMITER, RateLimiterPort } from '../../identity/ports';
import { LISTINGS_QUERIES, ListingsQueries } from '../../listings/ports';
import { NotificationService } from './notification.service';

// ChatService (docs/design/06_chat_notifications.pdf sections 3.1, 3.2 and 6; FR-CHT-01 to FR-CHT-09; U6-02).
// The database decides: chat.open_thread (one thread per listing and buyer), chat.post (participants only, no
// block, the next sequence number, the detector's flags, a resend recognised by the client's id) and chat.mark
// (marks only move forward). This service checks the request, keeps the chat limit (CP-35), stores images through
// Unit 1's FileVault, and after commit sends chat.message and chat.marks to the users' rooms and the recipient's
// notice (section 7.4). Another user appears only by display name and badge (FR-ACC-10); a message's text never
// leaves the thread (no text in notices, in events or in logs).

/** DV-40 */
export const MAX_TEXT = 2000;
export const MAX_CAPTION = 300;
/** DV-44 */
export const SYNC_PAGE = 200;
const THREAD_PAGE = 50;
/** DV-41: at most one chat e-mail per thread per recipient in this window, and only when not connected. */
export const CHAT_EMAIL_WINDOW = '15 minutes';

interface ThreadRow {
  id: string; listing_id: string; buyer_id: string; seller_id: string; last_seq: string; last_message_at: Date | null; created_at: Date;
  buyer_delivered_seq: string; buyer_read_seq: string; seller_delivered_seq: string; seller_read_seq: string; purged_at: Date | null;
}
interface MessageRow {
  id: string; seq: string; sender_id: string; kind: 'text' | 'image'; body: string | null; image_key: string | null; flags: string[]; created_at: Date; purged_at: Date | null;
}
export interface MessageView {
  seq: number; fromMe: boolean; kind: 'text' | 'image'; text: string | null; caption: string | null;
  image: { url: string; expiresAt: string } | null; flags: string[]; at: string; removed: boolean;
}

/** Maps the database's refusals of chat.post, chat.open_thread and chat.mark to problems. */
export function fromChatDb(err: unknown): never {
  if (err instanceof QueryFailedError) {
    const d = err.driverError as { code?: string; message?: string; constraint?: string };
    if (d.code === '42501' && d.message?.includes('blocked')) throw new Problem('blocked');
    if (d.code === '42501') throw new Problem('not-found'); // not a participant: as for an unknown thread (SEC-SDL-09)
    if (d.code === '23514' && d.message?.includes('purged')) throw new Problem('thread-closed');
    if (d.code === '23514') throw new Problem('validation-failed', { errors: [{ field: 'text', reason: d.constraint ?? 'rule' }] });
  }
  throw err;
}

@Injectable()
export class ChatService {
  private readonly log = new Logger('ChatService');

  constructor(
    private readonly db: DataSource,
    private readonly notices: NotificationService,
    @Inject(LISTINGS_QUERIES) private readonly listings: ListingsQueries,
    @Inject(IDENTITY_QUERY) private readonly identity: IdentityQuery,
    @Inject(FILE_VAULT) private readonly vault: FileVaultPort,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiterPort,
    @Inject(LIVE) private readonly live: LivePort,
  ) {}

  // ---------------------------------------------------------------- threads (FR-CHT-01)

  /** POST /listings/{id}/threads: the caller's thread with the seller, opened from an active listing. */
  async open(userId: string, listingId: string): Promise<{ id: string }> {
    const l = await this.listings.threadFacts(listingId);
    if (l.sellerId === userId) throw new Problem('forbidden', { errors: [{ field: 'listingId', reason: 'own-listing' }] });
    const [existing] = (await this.db.query(`SELECT id FROM chat.threads WHERE listing_id = $1 AND buyer_id = $2`, [listingId, userId])) as { id: string }[];
    if (existing) return existing; // the conversation continues after a sale (section 6.1)
    if (l.status !== 'active') throw new Problem('not-found');
    const [{ id }] = (await this.db.query(`SELECT chat.open_thread($1, $2, $3) AS id`, [listingId, userId, l.sellerId]).catch(fromChatDb)) as { id: string }[];
    return { id };
  }

  /** GET /threads: newest first, 50 a page, with the other party by display name and badge and the unread count. */
  async threads(userId: string, cursor?: string) {
    const after = decodeCursor(cursor);
    const rows = (await this.db.query(
      `SELECT t.*, ${cursorAt('coalesce(t.last_message_at, t.created_at)')} AS cursor_at FROM chat.threads t
        WHERE (t.buyer_id = $1 OR t.seller_id = $1)
          ${after ? `AND (coalesce(t.last_message_at, t.created_at), t.id) < ($2::timestamptz, $3::uuid)` : ''}
        ORDER BY coalesce(t.last_message_at, t.created_at) DESC, t.id DESC LIMIT ${THREAD_PAGE + 1}`,
      after ? [userId, after.at, after.id] : [userId],
    )) as (ThreadRow & { cursor_at: string })[];
    const page = rows.slice(0, THREAD_PAGE);
    const items = await Promise.all(page.map(async (t) => {
      const buyer = t.buyer_id === userId;
      const other = await this.identity.getPublicProfile(buyer ? t.seller_id : t.buyer_id).catch(() => null);
      const listing = await this.listings.threadFacts(t.listing_id).catch(() => null);
      const myRead = Number(buyer ? t.buyer_read_seq : t.seller_read_seq);
      return {
        id: t.id,
        listing: { id: t.listing_id, title: listing?.title ?? null },
        role: buyer ? 'buyer' : 'seller',
        other: other ? { displayName: other.displayName, verified: other.verified } : null,
        lastSeq: Number(t.last_seq),
        unread: Math.max(0, Number(t.last_seq) - myRead),
        lastMessageAt: t.last_message_at?.toISOString() ?? null,
        closed: t.purged_at !== null,
      };
    }));
    const last = page[page.length - 1];
    return { items, nextCursor: rows.length > THREAD_PAGE && last ? encodeCursor(last.cursor_at, last.id) : null };
  }

  // ---------------------------------------------------------------- messages (FR-CHT-02, FR-CHT-03, FR-CHT-05)

  /**
   * GET /threads/{id}/messages?after=n: the messages after a sequence number, 200 a page (DV-44): the history, and
   * the resync after a reconnection or a gap (IF-COM-02). Images come with a link for this session (CP-31).
   */
  async messages(viewer: Principal & { type: 'user' }, threadId: string, after = 0) {
    const t = await this.participant(this.db.manager, threadId, viewer.userId);
    const rows = (await this.db.query(
      `SELECT id::text, seq::text, sender_id, kind, body, image_key, flags, created_at, purged_at FROM chat.messages
        WHERE thread_id = $1 AND seq > $2 ORDER BY seq LIMIT ${SYNC_PAGE + 1}`,
      [threadId, after],
    )) as MessageRow[];
    const page = rows.slice(0, SYNC_PAGE);
    const buyer = t.buyer_id === viewer.userId;
    return {
      items: await Promise.all(page.map((m) => this.view(m, viewer))),
      more: rows.length > SYNC_PAGE,
      lastSeq: Number(t.last_seq),
      // the other side's marks, for "delivered" and "read" under one's own messages (FR-CHT-05)
      otherMarks: {
        delivered: Number(buyer ? t.seller_delivered_seq : t.buyer_delivered_seq),
        read: Number(buyer ? t.seller_read_seq : t.buyer_read_seq),
      },
      closed: t.purged_at !== null,
    };
  }

  /** POST /threads/{id}/messages: plain text, at most DV-40; a resend with the same client id returns the original. */
  async postText(userId: string, threadId: string, clientId: string, text: string) {
    const body = text.normalize('NFC');
    if (body.trim().length === 0) throw new Problem('validation-failed', { errors: [{ field: 'text', reason: 'empty' }] });
    if (body.length > MAX_TEXT) throw new Problem('validation-failed', { errors: [{ field: 'text', reason: 'too-long' }] });
    return this.post(userId, threadId, clientId, 'text', body, null);
  }

  /** POST /threads/{id}/images: checked, re-encoded without metadata and stored privately by Unit 1 (FR-CHT-03). */
  async postImage(userId: string, threadId: string, clientId: string, bytes: Buffer | undefined, caption: string | undefined) {
    if (!bytes || bytes.length === 0) throw new Problem('validation-failed', { errors: [{ field: 'image', reason: 'required' }] });
    const text = caption?.normalize('NFC').trim() || null;
    if (text && text.length > MAX_CAPTION) throw new Problem('validation-failed', { errors: [{ field: 'caption', reason: 'too-long' }] });
    await this.participant(this.db.manager, threadId, userId); // before storing anything
    const [repeat] = (await this.db.query(
      `SELECT seq::text FROM chat.messages WHERE thread_id = $1 AND sender_id = $2 AND client_msg_id = $3`, [threadId, userId, clientId],
    )) as { seq: string }[];
    if (repeat) return this.post(userId, threadId, clientId, 'image', text, null); // chat.post returns the original; nothing is stored again
    const stored = await this.vault.store({ purpose: 'chat_image', ownerId: userId, bytes });
    return this.post(userId, threadId, clientId, 'image', text, stored.key);
  }

  private async post(userId: string, threadId: string, clientId: string, kind: 'text' | 'image', body: string | null, imageKey: string | null) {
    await this.limiter.consume('chat', `user:${userId}`); // CP-35, SEC-ABU-01
    const [r] = (await this.db.query(
      `SELECT message_id::text, seq::text, flags, duplicate FROM chat.post($1, $2, $3, $4::chat.message_kind, $5, $6)`,
      [threadId, userId, clientId, kind, body, imageKey],
    ).catch(fromChatDb)) as { message_id: string; seq: string; flags: string[]; duplicate: boolean }[];
    if (!r.duplicate) await this.delivered(threadId, userId, r.message_id);
    return { seq: Number(r.seq), flags: r.flags, duplicate: r.duplicate };
  }

  /** POST /threads/{id}/marks and the socket's chat.ack: delivered and read up to; the sender is told (chat.marks). */
  async mark(userId: string, threadId: string, delivered: number, read: number): Promise<void> {
    const t = await this.participant(this.db.manager, threadId, userId);
    await this.db.query(`SELECT chat.mark($1, $2, $3, $4)`, [threadId, userId, delivered, read]).catch(fromChatDb);
    const [after] = (await this.db.query(
      `SELECT buyer_delivered_seq::text, buyer_read_seq::text, seller_delivered_seq::text, seller_read_seq::text FROM chat.threads WHERE id = $1`, [threadId],
    )) as { buyer_delivered_seq: string; buyer_read_seq: string; seller_delivered_seq: string; seller_read_seq: string }[];
    const buyer = t.buyer_id === userId;
    this.emit(buyer ? t.seller_id : t.buyer_id, 'chat.marks', {
      threadId,
      delivered: Number(buyer ? after.buyer_delivered_seq : after.seller_delivered_seq),
      read: Number(buyer ? after.buyer_read_seq : after.seller_read_seq),
    });
  }

  // ---------------------------------------------------------------- after commit

  /** chat.message to both participants (section 3.2), then the recipient's notice (section 7.4). */
  private async delivered(threadId: string, senderId: string, messageId: string): Promise<void> {
    const [m] = (await this.db.query(
      `SELECT m.seq::text, m.kind, m.body, m.flags, m.created_at, t.buyer_id, t.seller_id, t.listing_id
         FROM chat.messages m JOIN chat.threads t ON t.id = m.thread_id WHERE m.id = $1`, [messageId],
    )) as { seq: string; kind: 'text' | 'image'; body: string | null; flags: string[]; created_at: Date; buyer_id: string; seller_id: string; listing_id: string }[];
    const recipient = m.buyer_id === senderId ? m.seller_id : m.buyer_id;
    const message = (fromMe: boolean) => ({
      threadId, seq: Number(m.seq), fromMe, kind: m.kind,
      text: m.kind === 'text' ? m.body : null, caption: m.kind === 'image' ? m.body : null,
      // an image's link belongs to one session (CP-31): the client fetches it with the messages (Decisions log, U6-02)
      image: m.kind === 'image', flags: m.flags, at: m.created_at.toISOString(),
    });
    this.emit(senderId, 'chat.message', message(true));
    this.emit(recipient, 'chat.message', message(false));
    try {
      await this.notify(recipient, senderId, threadId, m.listing_id, messageId);
    } catch (err) {
      this.log.warn(`chat notice for message ${messageId} not created: ${(err as Error).message}`);
    }
  }

  /**
   * Section 7.4: an in-app notice for every message, never with its text; an e-mail only when the recipient is not
   * connected and had no chat e-mail for this thread in DV-41 (notify.chat_email_allowed), else it is suppressed.
   */
  private async notify(recipient: string, senderId: string, threadId: string, listingId: string, messageId: string): Promise<void> {
    const [sender, listing, online] = await Promise.all([
      this.identity.getPublicProfile(senderId), this.listings.threadFacts(listingId), this.live.isConnected(recipient),
    ]);
    const id = await this.db.transaction(async (tx) => {
      const nid = await this.notices.create(recipient, 'chat.message_received', { listing_title: listing.title, sender_name: sender.displayName },
        `chat.message:${messageId}`, { type: 'thread', id: threadId }, tx);
      if (!nid) return null;
      const [{ allowed }] = online
        ? [{ allowed: false }]
        : ((await tx.query(`SELECT notify.chat_email_allowed($1, $2, $3::interval) AS allowed`, [recipient, threadId, CHAT_EMAIL_WINDOW])) as { allowed: boolean }[]);
      if (!allowed) await tx.query(`UPDATE notify.deliveries SET status = 'suppressed' WHERE notification_id = $1 AND channel = 'email' AND status = 'pending'`, [nid]);
      return nid;
    });
    if (id) await this.notices.push(recipient, id);
  }

  private emit(userId: string, event: string, payload: Record<string, unknown>): void {
    try {
      this.live.toUser(userId, event, payload);
    } catch (err) {
      this.log.warn(`${event} not sent: ${(err as Error).message}`); // best effort: the client resyncs (IF-COM-02)
    }
  }

  // ---------------------------------------------------------------- helpers

  /** The thread, if the user is one of its two participants; otherwise not-found, as for an unknown id (SEC-SDL-09). */
  private async participant(m: EntityManager, threadId: string, userId: string): Promise<ThreadRow> {
    const [t] = (await m.query(`SELECT * FROM chat.threads WHERE id = $1`, [threadId])) as ThreadRow[];
    if (!t || (t.buyer_id !== userId && t.seller_id !== userId)) throw new Problem('not-found');
    return t;
  }

  private async view(m: MessageRow, viewer: Principal & { type: 'user' }): Promise<MessageView> {
    const removed = m.purged_at !== null;
    return {
      seq: Number(m.seq), fromMe: m.sender_id === viewer.userId, kind: m.kind,
      text: m.kind === 'text' ? m.body : null, caption: m.kind === 'image' ? m.body : null,
      image: m.kind === 'image' && m.image_key ? await this.vault.signedLink(m.image_key, viewer) : null,
      flags: m.flags, at: m.created_at.toISOString(), removed,
    };
  }
}
