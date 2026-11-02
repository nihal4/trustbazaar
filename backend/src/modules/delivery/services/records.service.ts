import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CONFIG_PORT, ConfigPort } from '../../../kernel/config-port';
import { cursorAt, decodeCursor, encodeCursor } from '../../../kernel/http/cursor';
import { Problem } from '../../../kernel/http/problems';
import { AUDIT_SERVICE, AuditServicePort, IDENTITY_CRYPTO, IdentityCryptoPort } from '../../identity/ports';
import type { DeliveryIssue, DeliveryQueries, FulfilmentRecord, IssueKind, Page, RecordAddress } from '../ports';
import { openShipment, type ShipmentColumn } from './shipment-address';

// DeliveryQueries and the operator's issue queue (docs/design/04_delivery.pdf sections 3.1, 3.2 and 7.11; FR-DSP-05;
// FR-DLV-11; SEC-ACC-05; U4-04). The fulfilment record never contains the handover code. Staff see addresses
// masked; the full lines need a reason of at least 10 characters, and each such display is audited.

const PAGE = 50;
const iso = (d: Date | null) => d?.toISOString() ?? null;
/** The first character, then dots: enough to tell two addresses apart, not enough to find anyone. */
export const mask = (v: string | undefined | null): string | null => (v ? `${[...v][0]}•••` : null);

interface IssueRow {
  id: string; order_id: string; kind: IssueKind; detail: Record<string, unknown>; status: 'open' | 'resolved'; created_at: Date;
  resolved_by: string | null; resolved_at: Date | null; resolution: string | null; cursor_at?: string;
}
const issueView = (r: IssueRow): DeliveryIssue => ({
  id: r.id, orderId: r.order_id, kind: r.kind, detail: r.detail, status: r.status, createdAt: r.created_at.toISOString(),
  resolvedBy: r.resolved_by, resolvedAt: iso(r.resolved_at), resolution: r.resolution,
});

@Injectable()
export class RecordsService implements DeliveryQueries {
  constructor(
    private readonly db: DataSource,
    @Inject(IDENTITY_CRYPTO) private readonly crypto: IdentityCryptoPort,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditServicePort,
    @Inject(CONFIG_PORT) private readonly params: ConfigPort,
  ) {}

  async notReceivedAllowed(orderId: string): Promise<boolean> {
    const cp17 = (await this.params.current()).ms('CP-17');
    const [r] = (await this.db.query(`SELECT delivery.not_received_allowed($1, $2 * interval '1 millisecond') AS ok`, [orderId, cp17])) as { ok: boolean }[];
    return r.ok;
  }

  async openIssues(cursor?: string): Promise<Page<DeliveryIssue>> {
    const after = decodeCursor(cursor);
    const rows = (await this.db.query(
      `SELECT *, ${cursorAt('created_at')} AS cursor_at FROM delivery.issues
        WHERE status = 'open' AND ($1::timestamptz IS NULL OR (created_at, id) > ($1::timestamptz, $2::uuid))
        ORDER BY created_at, id LIMIT ${PAGE + 1}`,
      [after?.at ?? null, after?.id ?? null],
    )) as IssueRow[];
    const page = rows.slice(0, PAGE);
    const last = page[page.length - 1];
    return { items: page.map(issueView), nextCursor: rows.length > PAGE && last ? encodeCursor(last.cursor_at!, last.id) : null };
  }

  /** DeliveryCommands.resolveIssue and POST /staff/delivery/issues/{id}/resolve. */
  async resolveIssue(issueId: string, staffId: string, resolution: string): Promise<void> {
    const why = resolution?.trim() ?? '';
    if (why.length < 10) throw new Problem('validation-failed', { errors: [{ field: 'reason', reason: 'too-short' }] });
    await this.db.transaction(async (m) => {
      const [i] = (await m.query(`SELECT id, order_id, kind, status FROM delivery.issues WHERE id = $1 FOR UPDATE`, [issueId])) as IssueRow[];
      if (!i) throw new Problem('not-found');
      if (i.status !== 'open') throw new Problem('validation-failed', { errors: [{ field: 'issue', reason: 'not-open' }] });
      await m.query(`UPDATE delivery.issues SET status = 'resolved', resolved_by = $2, resolved_at = now(), resolution = $3 WHERE id = $1`, [issueId, staffId, why]);
      await this.audit.record({
        actorType: 'staff', actorId: staffId, action: 'delivery.issue.resolved', objectType: 'delivery_issue', objectId: issueId,
        after: { orderId: i.order_id, kind: i.kind }, reason: why,
      }, m);
    });
  }

  /** DeliveryQueries.fulfilmentRecord: addresses masked. */
  fulfilmentRecord(orderId: string): Promise<FulfilmentRecord> {
    return this.record(orderId, null);
  }

  /**
   * GET /staff/orders/{id}/fulfilment-record: masked, or in full with a reason (SEC-ACC-05), which is audited. The
   * check that the operator is assigned to a case on this order comes with Unit 7's cases (U7-03).
   */
  async staffRecord(orderId: string, staffId: string, reason?: string): Promise<FulfilmentRecord> {
    const why = reason?.trim();
    if (why !== undefined && why !== '' && why.length < 10) throw new Problem('validation-failed', { errors: [{ field: 'reason', reason: 'too-short' }] });
    const reveal = !!why;
    const r = await this.record(orderId, reveal ? { staffId, reason: why! } : null);
    if (r.handover === null && r.shipments.length === 0 && r.issues.length === 0) throw new Problem('not-found');
    return r;
  }

  private async record(orderId: string, reveal: { staffId: string; reason: string } | null): Promise<FulfilmentRecord> {
    const [h] = (await this.db.query(`SELECT * FROM delivery.handovers WHERE order_id = $1`, [orderId])) as {
      status: string; due_at: Date; code_version: number; wrong_entries: number; locked_at: Date | null; completed_at: Date | null; cancelled_at: Date | null;
    }[];
    let handover: FulfilmentRecord['handover'] = null;
    if (h) {
      const proposals = (await this.db.query(
        `SELECT p.id, p.proposed_by, mp.name_en AS point, p.place_name, p.meet_at, p.status, p.created_at, p.responded_at
           FROM delivery.meetup_proposals p LEFT JOIN delivery.meetup_points mp ON mp.id = p.point_id WHERE p.order_id = $1 ORDER BY p.created_at, p.id`, [orderId],
      )) as { id: string; proposed_by: string; point: string | null; place_name: string | null; meet_at: Date; status: string; created_at: Date; responded_at: Date | null }[];
      const entries = (await this.db.query(
        `SELECT code_version, correct, at FROM delivery.code_entries WHERE order_id = $1 ORDER BY at, id`, [orderId],
      )) as { code_version: number; correct: boolean; at: Date }[];
      handover = {
        status: h.status, dueAt: h.due_at.toISOString(), codeVersion: h.code_version, wrongEntries: h.wrong_entries,
        lockedAt: iso(h.locked_at), completedAt: iso(h.completed_at), cancelledAt: iso(h.cancelled_at),
        proposals: proposals.map((p) => ({
          id: p.id, proposedBy: p.proposed_by, point: p.point, place: p.place_name, meetAt: p.meet_at.toISOString(), status: p.status,
          createdAt: p.created_at.toISOString(), respondedAt: iso(p.responded_at),
        })),
        codeEntries: entries.map((e) => ({ codeVersion: e.code_version, correct: e.correct, at: e.at.toISOString() })),
      };
    }

    const rows = (await this.db.query(
      `SELECT s.*, pa.district AS p_district, pa.name_en AS p_name, da.district AS d_district, da.name_en AS d_name
         FROM delivery.shipments s LEFT JOIN delivery.areas pa ON pa.id = s.pickup_area_id LEFT JOIN delivery.areas da ON da.id = s.dropoff_area_id
        WHERE s.order_id = $1 ORDER BY s.direction, s.created_at`, [orderId],
    )) as Record<string, unknown>[];
    const address = async (s: Record<string, unknown>, column: ShipmentColumn, prefix: 'p' | 'd'): Promise<RecordAddress> => {
      const areaId = s[column === 'pickup_address_enc' ? 'pickup_area_id' : 'dropoff_area_id'] as number | null;
      const area = areaId === null ? null : { id: areaId, district: s[`${prefix}_district`] as string, nameEn: s[`${prefix}_name`] as string };
      const sealed = s[column] as Buffer | null;
      if (!sealed) return { area, line1: null, line2: null, landmark: null, contactName: null, masked: !reveal, erased: s.addresses_erased_at !== null };
      const l = await openShipment(this.crypto, s.id as string, column, sealed);
      if (!reveal) return { area, line1: mask(l.line1), line2: mask(l.line2), landmark: mask(l.landmark), contactName: mask(l.contactName), masked: true, erased: false };
      return { area, line1: l.line1, line2: l.line2 ?? null, landmark: l.landmark ?? null, contactName: l.contactName, masked: false, erased: false };
    };
    const shipments = await Promise.all(rows.map(async (s) => {
      const history = (await this.db.query(
        `SELECT from_status, to_status, source, event_id, at FROM delivery.shipment_history WHERE shipment_id = $1 ORDER BY id`, [s.id],
      )) as { from_status: string | null; to_status: string; source: string; event_id: string | null; at: Date }[];
      return {
        id: s.id as string, direction: s.direction as 'forward' | 'return', provider: s.provider as string, simulated: s.simulated as boolean,
        consignmentId: s.consignment_id as string | null, status: s.status as string, fee: String(s.fee),
        pickupDueAt: iso(s.pickup_due_at as Date | null), bookedAt: iso(s.booked_at as Date | null), pickedUpAt: iso(s.picked_up_at as Date | null),
        deliveredAt: iso(s.delivered_at as Date | null), returnedAt: iso(s.returned_at as Date | null), cancelledAt: iso(s.cancelled_at as Date | null),
        orderCancelledAt: iso(s.order_cancelled_at as Date | null), failedAttempts: s.failed_attempts as number,
        returnCharge: s.return_charge === null ? null : String(s.return_charge), bookingAttempts: s.booking_attempts as number,
        pickup: await address(s, 'pickup_address_enc', 'p'), dropoff: await address(s, 'dropoff_address_enc', 'd'),
        history: history.map((x) => ({ from: x.from_status, to: x.to_status, source: x.source, eventId: x.event_id, at: x.at.toISOString() })),
      };
    }));
    const issues = (await this.db.query(`SELECT * FROM delivery.issues WHERE order_id = $1 ORDER BY created_at, id`, [orderId])) as IssueRow[];

    if (reveal && shipments.length > 0) {
      await this.db.transaction((m) => this.audit.record({
        actorType: 'staff', actorId: reveal.staffId, action: 'delivery.address.revealed', objectType: 'order', objectId: orderId,
        after: { shipments: shipments.map((s) => s.id) }, reason: reveal.reason,
      }, m));
    }
    return { orderId, handover, shipments, issues: issues.map(issueView) };
  }
}
