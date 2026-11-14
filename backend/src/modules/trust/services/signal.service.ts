import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { OutboxEvent } from '../../../kernel/events/event-bus';
import { Problem } from '../../../kernel/http/problems';
import { AUDIT_SERVICE, AuditServicePort, CallContext, STAFF_QUERY, StaffQuery } from '../../identity/ports';

// The flagged-activity queue's signals (docs/design/07_disputes_trust_staff.pdf section 6.2; FR-OPS-01; U7-08): things
// another unit noticed that an operator should look at. Each is stored once per source (trust.signals, signal_once),
// however often its event is delivered (DC-6):
//   shill_bidding   auctions.flag.raised (Unit 3, FR-AUC-18)                       one per flag
//   relisting       listings.listing.relisting_flagged (Unit 3, FR-TNS-02)          one per new listing, about its seller
//   delivery_issue  delivery.issue.opened (Unit 4, I-46)                            one per issue
//   chat_flags      chat.message.flagged (Unit 6)                                   one per sender per day (DV-51), with
//                   the count, the flags and the threads; a message counted twice is counted once
// An operator dismisses a signal or acts on it, with a note (the action itself, a sanction for example, is taken with
// its own endpoint). The linked-account signals come with U7-09.

const CHAT_DAY_ZONE = 'Asia/Dhaka';

@Injectable()
export class SignalService {
  constructor(
    private readonly db: DataSource,
    @Inject(STAFF_QUERY) private readonly staff: StaffQuery,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditServicePort,
  ) {}

  /** Event type -> the signal it makes. */
  readonly map: Record<string, (e: OutboxEvent) => { kind: string; source: string; subject: string | null; detail: Record<string, unknown> } | null> = {
    'auctions.flag.raised': (e) => {
      const p = e.payload as { auctionId?: string; flagId?: string | number; kind?: string; score?: number };
      return p.flagId === undefined ? null : { kind: 'shill_bidding', source: `auctions.flag:${p.flagId}`, subject: null, detail: { auctionId: p.auctionId ?? e.aggregateId, flag: p.kind ?? null, score: p.score ?? null } };
    },
    'listings.listing.relisting_flagged': (e) => {
      const p = e.payload as { listingId?: string; sellerId?: string; previousListingId?: string; similarity?: number };
      const listingId = p.listingId ?? e.aggregateId;
      return { kind: 'relisting', source: `listing:${listingId}`, subject: p.sellerId ?? null, detail: { listingId, previousListingId: p.previousListingId ?? null, similarity: p.similarity ?? null } };
    },
    'delivery.issue.opened': (e) => {
      const p = e.payload as { issueId?: string; orderId?: string; kind?: string };
      return p.issueId ? { kind: 'delivery_issue', source: `delivery.issue:${p.issueId}`, subject: null, detail: { issueId: p.issueId, orderId: p.orderId ?? e.aggregateId, issue: p.kind ?? null } } : null;
    },
  };

  async onEvent(e: OutboxEvent): Promise<boolean> {
    if (e.type === 'chat.message.flagged') return this.onChatFlag(e);
    const s = this.map[e.type]?.(e);
    if (!s) return false;
    const rows = (await this.db.query(
      `INSERT INTO trust.signals (kind, source_ref, subject_user, detail) VALUES ($1, $2, $3, $4) ON CONFLICT ON CONSTRAINT signal_once DO NOTHING RETURNING id`,
      [s.kind, s.source, s.subject, JSON.stringify(s.detail)],
    )) as unknown[];
    return rows.length > 0;
  }

  /** DV-51: one chat_flags signal per sender and day (Dhaka), counting each flagged message once. */
  private async onChatFlag(e: OutboxEvent): Promise<boolean> {
    const p = e.payload as { messageId?: string | number; flags?: string[]; sender?: string };
    if (!p.sender || p.messageId === undefined) throw new Error(`${e.type} ${e.id}: no sender or messageId`); // retried, then reported (K-04)
    const messageId = String(p.messageId);
    const flags = Array.isArray(p.flags) ? p.flags.filter((f) => typeof f === 'string') : [];
    const [{ day }] = (await this.db.query(`SELECT to_char($1::timestamptz AT TIME ZONE '${CHAT_DAY_ZONE}', 'YYYY-MM-DD') AS day`, [e.createdAt])) as { day: string }[];
    const rows = (await this.db.query(
      `INSERT INTO trust.signals (kind, source_ref, subject_user, detail)
       VALUES ('chat_flags', $1, $2, jsonb_build_object('day', $3::text, 'count', 1, 'messageIds', jsonb_build_array($4::text),
                                                       'threadIds', jsonb_build_array($5::text), 'flags', $6::jsonb))
       ON CONFLICT ON CONSTRAINT signal_once DO UPDATE
          SET detail = jsonb_set(jsonb_set(jsonb_set(jsonb_set(trust.signals.detail,
                '{count}', to_jsonb((trust.signals.detail->>'count')::int + 1)),
                '{messageIds}', (trust.signals.detail->'messageIds') || jsonb_build_array($4::text)),
                '{threadIds}', CASE WHEN (trust.signals.detail->'threadIds') ? $5::text THEN trust.signals.detail->'threadIds'
                                    ELSE (trust.signals.detail->'threadIds') || jsonb_build_array($5::text) END),
                '{flags}', (SELECT coalesce(jsonb_object_agg(k, v), '{}'::jsonb) FROM (
                   SELECT k, sum(v::int) AS v FROM (
                     SELECT key AS k, value AS v FROM jsonb_each_text(trust.signals.detail->'flags')
                     UNION ALL SELECT key, value FROM jsonb_each_text($6::jsonb)) a GROUP BY k) b))
        WHERE NOT ((trust.signals.detail->'messageIds') ? $4::text)
       RETURNING id`,
      [`chat:${p.sender}:${day}`, p.sender, day, messageId, e.aggregateId, JSON.stringify(Object.fromEntries(flags.map((f) => [f, 1])))],
    )) as unknown[];
    return rows.length > 0;
  }

  /** POST /staff/signals/{id}/review: dismissed or actioned, with a note; once. Audited. */
  async review(staffId: string, signalId: string, r: { outcome: 'dismissed' | 'actioned'; note: string }, ctx: CallContext = {}): Promise<{ signalId: string; status: string }> {
    const note = r.note.normalize('NFC').trim();
    if (note.length < 10) throw new Problem('validation-failed', { errors: [{ field: 'note', reason: 'too-short' }] });
    const [s] = (await this.db.query(`SELECT subject_user, status FROM trust.signals WHERE id = $1`, [signalId])) as { subject_user: string | null; status: string }[];
    if (!s) throw new Problem('not-found');
    if (s.status !== 'open') throw new Problem('validation-failed', { errors: [{ field: 'signal', reason: 'closed' }] });
    if (s.subject_user) await this.staff.assertNoConflict(staffId, [s.subject_user]); // FR-OPS-06
    await this.db.transaction(async (m) => {
      const [rows] = (await m.query(
        `UPDATE trust.signals SET status = $2, reviewed_by = $3, reviewed_at = now(), note = $4 WHERE id = $1 AND status = 'open' RETURNING id`,
        [signalId, r.outcome, staffId, note],
      )) as [unknown[], number];
      if (!rows.length) throw new Problem('validation-failed', { errors: [{ field: 'signal', reason: 'closed' }] }); // reviewed meanwhile
      await this.audit.record({
        actorType: 'staff', actorId: staffId, action: `trust.signal.${r.outcome}`, objectType: 'signal', objectId: signalId,
        reason: note, sourceIp: ctx.ip ?? null, correlationId: ctx.correlationId ?? null,
      }, m);
    });
    return { signalId, status: r.outcome };
  }
}
