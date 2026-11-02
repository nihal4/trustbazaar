import { Inject, Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { Problem } from '../../../kernel/http/problems';
import { RATE_LIMITER, RateLimiterPort } from '../../identity/ports';
import { REPORT_COMMANDS, ReportCategory, ReportCommands, ReportTarget } from '../../trust/ports';

// Reports from chat (docs/design/06_chat_notifications.pdf section 6.5; FR-CHT-06, FR-TNS-01; U6-03). A participant
// reports the thread or one message; the report goes to Unit 7's queue through ReportCommands, and Unit 7 places the
// hold (I-40). Unit 7 builds ReportCommands with U7-04 and will import this unit (ChatCommands, Notifier), so this
// unit finds it on first use; until it exists the answer is feature-off (Decisions log, U6-03), as checkout did
// before its later ports (U2-02).

export const MAX_REPORT_TEXT = 2000;

@Injectable()
export class ReportService {
  constructor(
    private readonly db: DataSource,
    private readonly modules: ModuleRef,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiterPort,
  ) {}

  /** POST /threads/{id}/reports: about the other participant, never about oneself (report_not_self). */
  async report(userId: string, threadId: string, r: { category: ReportCategory; messageSeq?: number; text?: string }): Promise<{ reportId: string }> {
    const text = r.text?.normalize('NFC').trim() || undefined;
    if (text && text.length > MAX_REPORT_TEXT) throw new Problem('validation-failed', { errors: [{ field: 'text', reason: 'too-long' }] });
    const [t] = (await this.db.query(`SELECT buyer_id, seller_id FROM chat.threads WHERE id = $1`, [threadId])) as { buyer_id: string; seller_id: string }[];
    if (!t || (t.buyer_id !== userId && t.seller_id !== userId)) throw new Problem('not-found'); // participants only (SEC-SDL-09)
    const other = t.buyer_id === userId ? t.seller_id : t.buyer_id;
    let target: ReportTarget = { type: 'thread', id: threadId, subjectUserId: other };
    if (r.messageSeq !== undefined) {
      const [m] = (await this.db.query(`SELECT id::text, sender_id FROM chat.messages WHERE thread_id = $1 AND seq = $2`, [threadId, r.messageSeq])) as {
        id: string; sender_id: string;
      }[];
      if (!m) throw new Problem('not-found');
      if (m.sender_id === userId) throw new Problem('validation-failed', { errors: [{ field: 'messageSeq', reason: 'own-message' }] });
      target = { type: 'message', id: threadId, messageId: m.id, subjectUserId: other };
    }
    const commands = this.commands();
    await this.limiter.consume('chat-report', `user:${userId}`); // CP-35 reports_per_day, SEC-ABU-01
    const reportId = await commands.report({ reporterId: userId, target, category: r.category, text });
    return { reportId };
  }

  private commands(): ReportCommands {
    try {
      return this.modules.get<ReportCommands>(REPORT_COMMANDS, { strict: false });
    } catch {
      throw new Problem('feature-off', { errors: [{ field: 'report', reason: 'reports-not-yet-available' }] });
    }
  }
}
