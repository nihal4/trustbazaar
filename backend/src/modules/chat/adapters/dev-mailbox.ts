import type Redis from 'ioredis';

// The development mailbox (docs/design/06_chat_notifications.pdf section 7.2; AS-4). In log mode e-mail and SMS
// are not sent: each message is kept here, labelled simulated, so a developer can read it (registration codes,
// links). It lives in Redis, never in the database or the log (SEC-DAT-07), holds the last 200 messages for 7 days,
// and exists only in log mode. It is read by the staff page GET /staff/dev-mailbox and by the command
//   docker compose exec backend node dist/dev-mailbox.js
// which needs access to the container and so exposes nothing on the network.
export const DEV_MAILBOX_KEY = 'tb:dev-mailbox';
const KEEP = 200;
const TTL_SECONDS = 7 * 24 * 3600;

export interface MailboxEntry {
  at: string;
  channel: 'email' | 'sms';
  to: string;
  subject: string | null;
  text: string;
  simulated: true;
}

export class DevMailbox {
  constructor(private readonly redis: Redis) {}

  async put(e: Omit<MailboxEntry, 'at' | 'simulated'>, now: Date): Promise<void> {
    const entry: MailboxEntry = { at: now.toISOString(), ...e, simulated: true };
    await this.redis.multi().lpush(DEV_MAILBOX_KEY, JSON.stringify(entry)).ltrim(DEV_MAILBOX_KEY, 0, KEEP - 1).expire(DEV_MAILBOX_KEY, TTL_SECONDS).exec();
  }

  /** Newest first; optionally only the messages to one number or address. */
  async list(to?: string, limit = 50): Promise<MailboxEntry[]> {
    const raw = await this.redis.lrange(DEV_MAILBOX_KEY, 0, KEEP - 1);
    const all = raw.map((r) => JSON.parse(r) as MailboxEntry);
    return (to ? all.filter((e) => e.to.toLowerCase() === to.toLowerCase()) : all).slice(0, limit);
  }
}
