import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CLOCK, Clock } from '../../../kernel/clock';
import { IDENTITY_QUERY, IdentityQuery } from '../../identity/ports';
import { EMAIL_ADAPTER, EmailAdapter, SMS_ADAPTER, SmsAdapter } from '../adapters/channels';
import { DirectMessages } from './direct-messages';
import { Language, render } from './templates';

// The delivery worker (docs/design/06_chat_notifications.pdf sections 7.2 and 8; DV-42, DV-43; U6-05). It sends
// the e-mail and SMS rows notify.create made for each notice:
//  - Lease: due rows are taken with FOR UPDATE SKIP LOCKED in a short transaction that counts the attempt and
//    pushes next_attempt_at forward by LEASE_MS, so no row is sent twice by two workers. The message is sent outside
//    any transaction, and the result recorded after. A worker that dies mid-send leaves the lease to run out, and
//    the row is tried again (at least once).
//  - The address and number come from Unit 1 at send time, so a changed contact applies at once (I-36). No verified
//    address or number: the row is suppressed.
//  - The text is rendered in the recipient's language when sent; nothing rendered is stored.
//  - A failure is retried after 1, 2, 4, 8 and 16 minutes (with up to 20% jitter), six attempts in all (DV-43);
//    then it stays failed, and a security notice that never went out is logged as an error for the operators.
export const RETRY_MINUTES = [1, 2, 4, 8, 16];
export const MAX_ATTEMPTS = RETRY_MINUTES.length + 1;
const LEASE_MS = 5 * 60_000;
const BATCH = 50;
const DAY_MS = 86_400_000;

interface Due {
  notification_id: string;
  channel: 'email' | 'sms';
  attempts: number;
  user_id: string;
  params: Record<string, unknown>;
  category: string;
  title_en: string;
  title_bn: string;
  body_en: string;
  body_bn: string;
  language: Language | null;
}

@Injectable()
export class DeliveryService {
  private readonly log = new Logger('DeliveryWorker');

  constructor(
    private readonly db: DataSource,
    @Inject(EMAIL_ADAPTER) private readonly email: EmailAdapter,
    @Inject(SMS_ADAPTER) private readonly sms: SmsAdapter,
    @Inject(IDENTITY_QUERY) private readonly identity: IdentityQuery,
    private readonly direct: DirectMessages,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** The jitter's source; tests replace it. */
  random: () => number = Math.random;

  /** Sends what is due; returns how many rows were attempted. */
  async processDue(): Promise<number> {
    const now = this.clock.now();
    const due = await this.db.transaction(async (m) => {
      const rows = (await m.query(
        `SELECT d.notification_id, d.channel, d.attempts, n.user_id, n.params, t.category, t.title_en, t.title_bn, t.body_en, t.body_bn, p.language
           FROM notify.deliveries d
           JOIN notify.notifications n ON n.id = d.notification_id
           JOIN notify.templates t ON t.code = n.template_code AND t.version = n.template_version
           LEFT JOIN notify.preferences p ON p.user_id = n.user_id
          WHERE d.status IN ('pending', 'failed') AND d.attempts < $2 AND d.next_attempt_at <= $1
          ORDER BY d.next_attempt_at LIMIT ${BATCH}
          FOR UPDATE OF d SKIP LOCKED`,
        [now, MAX_ATTEMPTS],
      )) as Due[];
      for (const r of rows) {
        await m.query(
          `UPDATE notify.deliveries SET attempts = attempts + 1, next_attempt_at = $3 WHERE notification_id = $1 AND channel = $2`,
          [r.notification_id, r.channel, new Date(now.getTime() + LEASE_MS)],
        );
      }
      return rows;
    });
    for (const r of due) await this.deliver(r);
    return due.length;
  }

  private async deliver(r: Due): Promise<void> {
    const attempt = r.attempts + 1;
    const { title, body } = render({ titleEn: r.title_en, titleBn: r.title_bn, bodyEn: r.body_en, bodyBn: r.body_bn }, r.params ?? {}, r.language ?? 'bn');
    let contact: { email: string | null; phone: string | null; emailVerified: boolean };
    try {
      contact = await this.identity.getContact(r.user_id);
    } catch {
      return this.record(r, 'suppressed', null, 'no-account');
    }
    const to = r.channel === 'email' ? (contact.emailVerified ? contact.email : null) : contact.phone;
    if (!to) return this.record(r, 'suppressed', null, 'no-address');
    try {
      if (r.channel === 'email') {
        const { ref } = await this.email.send(to, title, body);
        return this.record(r, 'sent', ref, null);
      }
      const { ref } = await this.sms.send(to, `${title}: ${body}`);
      await this.db.query(
        `INSERT INTO notify.sms_log (phone_hmac, purpose, status, provider_ref, simulated, at) VALUES ($1, 'security_notice', 'sent', $2, $3, $4)`,
        [this.direct.phoneHmac(to), ref, this.sms.simulated, this.clock.now()],
      );
      return this.record(r, 'sent', ref, null);
    } catch (e) {
      const code = (e as { code?: unknown }).code;
      const error = (typeof code === 'string' ? code : 'send-failed').slice(0, 60); // an error code, never message content
      if (attempt >= MAX_ATTEMPTS) {
        if (r.category === 'security') this.log.error(`security notice ${r.notification_id} (${r.channel}) could not be delivered after ${attempt} attempts`);
        return this.record(r, 'failed', null, error, null);
      }
      const delay = RETRY_MINUTES[attempt - 1] * 60_000 * (1 + this.random() * 0.2);
      return this.record(r, 'failed', null, error, new Date(this.clock.now().getTime() + delay));
    }
  }

  private async record(r: Due, status: 'sent' | 'failed' | 'suppressed', ref: string | null, error: string | null, next?: Date | null): Promise<void> {
    await this.db.query(
      `UPDATE notify.deliveries SET status = $3, provider_ref = $4, last_error = $5, sent_at = $6,
              next_attempt_at = COALESCE($7, next_attempt_at)
        WHERE notification_id = $1 AND channel = $2`,
      [r.notification_id, r.channel, status, ref, error, status === 'sent' ? this.clock.now() : null, next ?? null],
    );
  }

  /**
   * DV-42 (daily): the in-app history after one year, and delivery and SMS records after 90 days.
   * Returns how many rows were deleted.
   */
  async purgeExpired(): Promise<number> {
    const now = this.clock.now().getTime();
    const year = new Date(now - 365 * DAY_MS);
    const days90 = new Date(now - 90 * DAY_MS);
    return this.db.transaction(async (m) => {
      const count = (r: unknown) => (Array.isArray(r) && typeof r[1] === 'number' ? r[1] : 0);
      let n = count(await m.query(`DELETE FROM notify.deliveries d USING notify.notifications o WHERE d.notification_id = o.id AND o.created_at < $1`, [year]));
      n += count(await m.query(`DELETE FROM notify.notifications WHERE created_at < $1`, [year]));
      n += count(await m.query(`DELETE FROM notify.deliveries WHERE status IN ('sent', 'failed', 'suppressed') AND COALESCE(sent_at, next_attempt_at) < $1 AND (status <> 'failed' OR attempts >= $2)`, [days90, MAX_ATTEMPTS]));
      n += count(await m.query(`DELETE FROM notify.sms_log WHERE at < $1`, [days90]));
      return n;
    });
  }
}
