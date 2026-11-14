import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { Problem } from '../../../kernel/http/problems';
import { CHAT_COMMANDS, ChatCommands } from '../../chat/ports';
import { AUDIT_SERVICE, AuditServicePort, CallContext, IDENTITY_QUERY, IdentityQuery, RATE_LIMITER, RateLimiterPort, STAFF_QUERY, StaffQuery } from '../../identity/ports';
import { LISTINGS_PORT, ListingsPort } from '../../listings/ports';
import type { CaseQuery, ReportCategory, ReportCommands, ReportTarget, StaffCaseType } from '../ports';

// Reports (docs/design/07_disputes_trust_staff.pdf section 6.1; FR-TNS-01, FR-TNS-09, FR-OPS-06; U7-04).
//  - A registered user reports a listing or a user here, or a chat thread or message through Unit 6 (FR-CHT-06,
//    ReportCommands). The report names the user it is about. One open report per reporter and target: a second is
//    refused (reports_one_open). CP-35 limits reports to 20 a day, in the same bucket as chat's.
//  - A report on a thread or message holds the thread (Unit 6, I-40), so the assigned operator may read it; the hold
//    is released when the report is resolved.
//  - An operator claims the report (the conflict check of FR-OPS-06), then resolves it as dismissed or actioned with
//    a reason of at least 10 characters. The action itself (a sanction, ...) is taken with its own endpoint.
//    trust.report.resolved tells the reporter only whether action was taken (FR-TNS-09).

export const MAX_REPORT_TEXT = 2000;
const OPEN = ['open', 'under_review'];

interface ReportRow { id: string; reporter_id: string; subject_user: string; target_type: string; target_id: string; status: string; assigned_to: string | null }

@Injectable()
export class TrustReportService implements ReportCommands, CaseQuery {
  private readonly log = new Logger('Reports');

  constructor(
    private readonly db: DataSource,
    @Inject(CHAT_COMMANDS) private readonly chat: ChatCommands,
    @Inject(LISTINGS_PORT) private readonly listings: ListingsPort,
    @Inject(IDENTITY_QUERY) private readonly identity: IdentityQuery,
    @Inject(STAFF_QUERY) private readonly staff: StaffQuery,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiterPort,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditServicePort,
  ) {}

  /** POST /reports: a listing (about its seller) or a user. Chat threads and messages are reported in the chat. */
  async reportFromApi(userId: string, r: { targetType: 'listing' | 'user'; targetId: string; category: ReportCategory; text?: string }): Promise<{ reportId: string }> {
    let subjectUserId = r.targetId;
    if (r.targetType === 'listing') {
      const listing = await this.listings.snapshot(r.targetId).catch(() => null);
      if (!listing || listing.status === 'draft') throw new Problem('not-found');
      subjectUserId = listing.sellerId;
    } else {
      await this.identity.getPublicProfile(r.targetId); // not-found for an unknown user
    }
    await this.limiter.consume('chat-report', `user:${userId}`); // CP-35 reports_per_day, shared with chat (SEC-ABU-01)
    const reportId = await this.report({ reporterId: userId, target: { type: r.targetType, id: r.targetId, subjectUserId }, category: r.category, text: r.text });
    return { reportId };
  }

  /** ReportCommands (Unit 6, FR-CHT-06) and POST /reports. */
  async report(r: { reporterId: string; target: ReportTarget; category: ReportCategory; text?: string }): Promise<string> {
    const text = r.text?.normalize('NFC').trim() || null;
    if (text && text.length > MAX_REPORT_TEXT) throw new Problem('validation-failed', { errors: [{ field: 'text', reason: 'too-long' }] });
    if (r.reporterId === r.target.subjectUserId) throw new Problem('validation-failed', { errors: [{ field: 'target', reason: 'own' }] });
    let id: string;
    try {
      [{ id }] = (await this.db.query(
        `INSERT INTO trust.reports (reporter_id, target_type, target_id, message_id, subject_user, category, text)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [r.reporterId, r.target.type, r.target.id, r.target.type === 'message' ? r.target.messageId : null, r.target.subjectUserId, r.category, text],
      )) as { id: string }[];
    } catch (err) {
      if (err instanceof QueryFailedError && (err.driverError as { code?: string }).code === '23505') {
        throw new Problem('validation-failed', { errors: [{ field: 'target', reason: 'already-reported' }] });
      }
      throw err;
    }
    if (r.target.type === 'thread' || r.target.type === 'message') await this.chat.hold(r.target.id, 'report', id); // I-40
    return id;
  }

  /** POST /staff/cases/report/{id}/claim (FR-OPS-06): the conflict check, then the case is the operator's. */
  async claim(staffId: string, reportId: string, ctx: CallContext = {}): Promise<{ reportId: string; status: string }> {
    const r = await this.find(this.db.manager, reportId);
    if (!OPEN.includes(r.status)) throw new Problem('validation-failed', { errors: [{ field: 'report', reason: 'closed' }] });
    if (r.assigned_to && r.assigned_to !== staffId) throw new Problem('already-claimed');
    await this.staff.assertNoConflict(staffId, [r.subject_user, r.reporter_id]);
    await this.db.transaction(async (m) => {
      const rows = (await m.query(
        `UPDATE trust.reports SET assigned_to = $2, status = 'under_review'
          WHERE id = $1 AND status IN ('open', 'under_review') AND (assigned_to IS NULL OR assigned_to = $2) RETURNING id`,
        [reportId, staffId],
      )) as unknown[];
      if ((Array.isArray(rows[0]) ? rows[0] : rows).length === 0) throw new Problem('already-claimed'); // another operator was quicker
      await this.audit.record({ actorType: 'staff', actorId: staffId, action: 'trust.report.claimed', objectType: 'report', objectId: reportId, sourceIp: ctx.ip ?? null, correlationId: ctx.correlationId ?? null }, m);
    });
    return { reportId, status: 'under_review' };
  }

  /** POST /staff/reports/{id}/resolution: the assigned operator dismisses or actions it, with a reason. */
  async resolve(staffId: string, reportId: string, d: { outcome: 'dismissed' | 'actioned'; resolution: string }, ctx: CallContext = {}): Promise<{ reportId: string; status: string }> {
    const resolution = d.resolution.normalize('NFC').trim();
    if (resolution.length < 10) throw new Problem('validation-failed', { errors: [{ field: 'resolution', reason: 'too-short' }] });
    const r = await this.db.transaction(async (m) => {
      const row = await this.find(m, reportId, true);
      if (!OPEN.includes(row.status)) throw new Problem('validation-failed', { errors: [{ field: 'report', reason: 'closed' }] });
      if (row.assigned_to !== staffId) throw new Problem('not-claimed');
      await m.query(`UPDATE trust.reports SET status = $2, resolution = $3, resolved_by = $4, resolved_at = now() WHERE id = $1`, [reportId, d.outcome, resolution, staffId]);
      await this.audit.record({
        actorType: 'staff', actorId: staffId, action: `trust.report.${d.outcome}`, objectType: 'report', objectId: reportId,
        before: { status: row.status }, after: { status: d.outcome }, reason: resolution, sourceIp: ctx.ip ?? null, correlationId: ctx.correlationId ?? null,
      }, m);
      // FR-TNS-09: the reporter learns only whether action was taken
      await m.query(`INSERT INTO disputes.outbox (event_type, aggregate_id, payload) VALUES ('trust.report.resolved', $1, $2)`,
        [reportId, JSON.stringify({ reportId, reporterId: row.reporter_id, actioned: d.outcome === 'actioned' })]);
      return row;
    });
    if (r.target_type === 'thread' || r.target_type === 'message') {
      await this.chat.release(r.target_id, 'report', reportId).catch((err: Error) => this.log.warn(`releasing the hold of report ${reportId}: ${err.message}`));
    }
    return { reportId, status: d.outcome };
  }

  /** CaseQuery (Unit 6's staff thread read): reports here; disputes come with U7-03. */
  async assignedOperator(type: StaffCaseType, caseId: string): Promise<string | null> {
    if (type !== 'report') return null;
    const [r] = (await this.db.query(`SELECT assigned_to FROM trust.reports WHERE id = $1 AND status IN ('open', 'under_review')`, [caseId])) as { assigned_to: string | null }[];
    return r?.assigned_to ?? null;
  }

  private async find(m: EntityManager, id: string, lock = false): Promise<ReportRow> {
    const [r] = (await m.query(
      `SELECT id, reporter_id, subject_user, target_type, target_id, status, assigned_to FROM trust.reports WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id],
    )) as ReportRow[];
    if (!r) throw new Problem('not-found');
    return r;
  }
}
