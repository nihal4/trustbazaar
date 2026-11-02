// What Unit 6 answers for chat (docs/design/06_chat_notifications.pdf sections 3.1 and 3.2; Decisions log, U6-02 and
// U6-03), and the bridge to the reference ChatThread (lib/live.js), which orders messages, recognises our own by
// their client id and asks for a resync after a gap (section 5, IF-COM-02).
import type { Api } from '../../shared/api';

export type Flag = 'payment_phrase' | 'off_platform_app' | 'credentials';
export const FLAGS: Flag[] = ['payment_phrase', 'off_platform_app', 'credentials'];

export interface ThreadSummary {
  id: string;
  listing: { id: string; title: string | null };
  role: 'buyer' | 'seller';
  other: { id: string; displayName: string; verified: boolean } | null;
  lastSeq: number;
  unread: number;
  lastMessageAt: string | null;
  closed: boolean;
}
export interface ThreadPage { items: ThreadSummary[]; nextCursor: string | null }

/** A message as GET /threads/{id}/messages gives it. */
export interface ServerMessage {
  clientId: string | null;
  seq: number;
  fromMe: boolean;
  kind: 'text' | 'image';
  text: string | null;
  caption: string | null;
  image: { url: string; expiresAt: string } | null;
  flags: string[];
  at: string;
  removed: boolean;
}
export interface MessagesPage {
  items: ServerMessage[];
  more: boolean;
  lastSeq: number;
  otherMarks: { delivered: number; read: number };
  closed: boolean;
}

/** The live chat.message: the same, but an image comes without its link (it is fetched with the messages). */
export interface LiveMessage extends Omit<ServerMessage, 'image' | 'removed'> {
  threadId: string;
  image: boolean;
}

/** What ChatThread holds: the reference shape plus the server's fields. */
export interface ChatMessage extends ServerMessage {
  clientMsgId: string;
  senderId: string;
}

export const THREADS_KEY = ['threads'] as const;

export function fetchThreads(api: Api, cursor: string | undefined, signal?: AbortSignal): Promise<ThreadPage> {
  return api.get(cursor ? `/threads?cursor=${encodeURIComponent(cursor)}` : '/threads', { signal }) as Promise<ThreadPage>;
}

export function fetchMessages(api: Api, threadId: string, after: number, signal?: AbortSignal): Promise<MessagesPage> {
  return api.get(`/threads/${encodeURIComponent(threadId)}/messages?after=${after}`, { signal }) as Promise<MessagesPage>;
}

/** The server's message in ChatThread's shape. Another's message has no client id: its sequence number stands in. */
export function toChatMessage(m: ServerMessage): ChatMessage {
  return { ...m, clientMsgId: m.clientId ?? `seq:${m.seq}`, senderId: m.fromMe ? 'me' : 'other' };
}

export const knownFlags = (flags: string[]): Flag[] => FLAGS.filter((f) => flags.includes(f));

/** FR-CHT-09: a web address in a message is shown as text, with a warning. */
export const hasWebAddress = (text: string | null): boolean => !!text && /(https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(com|net|org|bd|me|io|xyz|info)\b/i.test(text);

/** A random client id for one message, kept for its resends (section 7.6). */
export const newClientId = (): string => crypto.randomUUID();
