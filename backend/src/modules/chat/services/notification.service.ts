import { Inject, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { CLOCK, Clock } from '../../../kernel/clock';
import { Problem } from '../../../kernel/http/problems';
import { Language, render, TemplateTexts } from './templates';

// Notifications (docs/design/06_chat_notifications.pdf sections 3.1 and 7; FR-NTF-03 to FR-NTF-06, FR-NTF-08; U6-04).
// A notice is created through notify.create, which applies the template's channels and the user's e-mail
// preference and refuses parameters the template does not declare or that carry contact details or codes
// (FR-NTF-08). Text written by users (listing titles, device names) passes through notify.mask first. The
// dedupe key makes a redelivered event create nothing (DC-6). The e-mail and SMS rows are sent by U6-05's
// delivery worker; the live notification.new push comes with the Socket.IO gateway (K-07).
export interface Subject {
  type: 'order' | 'listing' | 'payout' | 'refund' | 'account';
  id: string;
}

export interface NotificationView {
  id: string;
  code: string;
  title: string;
  body: string;
  subject: Subject | null;
  createdAt: string;
  readAt: string | null;
}

export interface Preferences {
  language: Language;
  emailTransactional: boolean;
}

const PAGE = 50;
/** Parameters written by users, masked before use (section 7.3). */
const USER_TEXT = new Set(['listing_title', 'device', 'sender_name']);
const DEFAULTS: Preferences = { language: 'bn', emailTransactional: true };


@Injectable()
export class NotificationService {
  constructor(
    private readonly db: DataSource,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Creates one notice; null if this dedupe key already made one for the user (an event delivered twice). */
  async create(userId: string, code: string, params: Record<string, string | number | boolean>, dedupeKey: string, subject?: Subject, tx?: EntityManager): Promise<string | null> {
    const work = async (m: EntityManager) => {
      const safe: Record<string, string | number | boolean> = {};
      for (const [k, v] of Object.entries(params)) {
        safe[k] = typeof v === 'string' && USER_TEXT.has(k) ? ((await m.query(`SELECT notify.mask($1) AS t`, [v.slice(0, 200)])) as { t: string }[])[0].t : v;
      }
      const [{ id }] = (await m.query(`SELECT notify.create($1, $2, $3::jsonb, $4) AS id`, [userId, code, JSON.stringify(safe), dedupeKey.slice(0, 200)])) as { id: string | null }[];
      if (id && subject) await m.query(`UPDATE notify.notifications SET subject_type = $2, subject_id = $3 WHERE id = $1`, [id, subject.type, subject.id]);
      return id;
    };
    return tx ? work(tx) : this.db.transaction(work);
  }

  /** FR-NTF-04: the user's notices, newest first, 50 a page, in their language; with the unread count. */
  async list(userId: string, cursor?: string): Promise<{ items: NotificationView[]; unread: number; nextCursor: string | null }> {
    let at: string | null = null;
    let id: string | null = null;
    if (cursor !== undefined) {
      const [t, i] = Buffer.from(cursor, 'base64url').toString().split('|');
      if (!t || Number.isNaN(Date.parse(t)) || !/^[0-9a-f-]{36}$/.test(i ?? '')) throw new Problem('validation-failed', { errors: [{ field: 'cursor', reason: 'format' }] });
      [at, id] = [t, i];
    }
    const { language } = await this.preferences(userId);
    const rows = (await this.db.query(
      `SELECT n.id, n.template_code, n.params, n.subject_type, n.subject_id, n.created_at, n.read_at,
              t.title_en, t.title_bn, t.body_en, t.body_bn
         FROM notify.notifications n JOIN notify.templates t ON t.code = n.template_code AND t.version = n.template_version
        WHERE n.user_id = $1 AND ($2::timestamptz IS NULL OR (n.created_at, n.id) < ($2::timestamptz, $3::uuid))
        ORDER BY n.created_at DESC, n.id DESC LIMIT ${PAGE + 1}`,
      [userId, at, id],
    )) as (Row & { title_en: string; title_bn: string; body_en: string; body_bn: string })[];
    const [{ n: unread }] = (await this.db.query(`SELECT count(*)::int AS n FROM notify.notifications WHERE user_id = $1 AND read_at IS NULL`, [userId])) as { n: number }[];
    const page = rows.slice(0, PAGE);
    const last = page[page.length - 1];
    return {
      items: page.map((r) => this.view(r, { titleEn: r.title_en, titleBn: r.title_bn, bodyEn: r.body_en, bodyBn: r.body_bn }, language)),
      unread,
      nextCursor: rows.length > PAGE ? Buffer.from(`${last.created_at.toISOString()}|${last.id}`).toString('base64url') : null,
    };
  }

  /** Marks the given notices, or all of them, as read; returns the unread count left. */
  async markRead(userId: string, ids: string[] | 'all'): Promise<{ unread: number }> {
    const now = this.clock.now();
    if (ids === 'all') await this.db.query(`UPDATE notify.notifications SET read_at = $2 WHERE user_id = $1 AND read_at IS NULL`, [userId, now]);
    else if (ids.length) await this.db.query(`UPDATE notify.notifications SET read_at = $2 WHERE user_id = $1 AND id = ANY($3::uuid[]) AND read_at IS NULL`, [userId, now, ids]);
    const [{ n }] = (await this.db.query(`SELECT count(*)::int AS n FROM notify.notifications WHERE user_id = $1 AND read_at IS NULL`, [userId])) as { n: number }[];
    return { unread: n };
  }

  /** FR-NTF-05: the language of notices, and whether transactional e-mails are sent (security notices always are). */
  async preferences(userId: string): Promise<Preferences> {
    const [p] = (await this.db.query(`SELECT language, email_transactional FROM notify.preferences WHERE user_id = $1`, [userId])) as { language: Language; email_transactional: boolean }[];
    return p ? { language: p.language, emailTransactional: p.email_transactional } : { ...DEFAULTS };
  }

  async setPreferences(userId: string, p: Partial<Preferences>): Promise<Preferences> {
    const next = { ...(await this.preferences(userId)), ...p };
    await this.db.query(
      `INSERT INTO notify.preferences (user_id, language, email_transactional, updated_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE SET language = EXCLUDED.language, email_transactional = EXCLUDED.email_transactional, updated_at = EXCLUDED.updated_at`,
      [userId, next.language, next.emailTransactional, this.clock.now()],
    );
    return next;
  }

  private view(r: Row, t: TemplateTexts, lang: Language): NotificationView {
    const { title, body } = render(t, (r.params ?? {}) as Record<string, unknown>, lang);
    return {
      id: r.id, code: r.template_code, title, body,
      subject: r.subject_type && r.subject_id ? { type: r.subject_type as Subject['type'], id: r.subject_id } : null,
      createdAt: r.created_at.toISOString(), readAt: r.read_at?.toISOString() ?? null,
    };
  }
}

interface Row {
  id: string;
  template_code: string;
  params: unknown;
  subject_type: string | null;
  subject_id: string | null;
  created_at: Date;
  read_at: Date | null;
}

