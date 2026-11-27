import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import type { OutboxEvent } from '../../../kernel/events/event-bus';
import { Problem } from '../../../kernel/http/problems';
import { NOTIFIER, Notifier } from '../../chat/ports';
import { DELIVERY_COMMANDS, DeliveryCommands } from '../../delivery/ports';
import {
  Approval,
  APPROVAL_SERVICE,
  ApprovalServicePort,
  AUDIT_SERVICE,
  AuditServicePort,
  CallContext,
  FILE_VAULT,
  FileVaultPort,
  IDENTITY_QUERY,
  IdentityQuery,
  STAFF_QUERY,
  StaffQuery,
} from '../../identity/ports';

// Lawful disclosure and the dispute case-file retention (docs/design/07_disputes_trust_staff.pdf section 9 and the
// retention matrix; FR-PRV-06, I-63; U7-07). Data export (FR-PRV-03) is U7-11's.
//  - An operator records an authority's request with its legal reference and scope, and whether the user may be told
//    (or why the law forbids it). Nothing is disclosed until a second staff member approves it (four-eyes; the
//    database refuses disclosed_at without an approval). The approval marks it disclosed and, unless withheld, tells
//    the user after the commit (staff.disclosure.made). Both steps are audited.
//  - Retention (daily): 2 years after a dispute was decided or withdrawn, its statements' text and evidence files go
//    (disputes.purge_due); the files are erased from Unit 1's FileVault. The dispute, its history and decision stay.

export const CASE_FILE_RETENTION = '2 years';

interface DisclosureRow {
  id: string;
  subject_user: string;
  authority: string;
  legal_reference: string;
  scope: string;
  requested_by: string;
  approval_id: string | null;
  disclosed_at: Date | null;
  user_notified_at: Date | null;
  withheld_reason: string | null;
  created_at: Date;
}

@Injectable()
export class PrivacyService implements OnModuleInit {
  private readonly log = new Logger('Privacy');

  constructor(
    private readonly db: DataSource,
    @Inject(IDENTITY_QUERY) private readonly identity: IdentityQuery,
    @Inject(STAFF_QUERY) private readonly staff: StaffQuery,
    @Inject(APPROVAL_SERVICE) private readonly approvals: ApprovalServicePort,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditServicePort,
    @Inject(FILE_VAULT) private readonly vault: FileVaultPort,
    @Inject(NOTIFIER) private readonly notifier: Notifier,
    @Inject(DELIVERY_COMMANDS) private readonly delivery: DeliveryCommands,
  ) {}

  onModuleInit(): void {
    this.approvals.registerHandler('disclosure.approve', (a, tx) => this.approved(a, tx));
  }

  /** POST /staff/disclosures (FR-PRV-06): recorded and proposed for four-eyes approval; 202. */
  async request(
    staffId: string,
    r: { userId: string; authority: string; legalReference: string; scope: string; notifyUser: boolean; withheldReason?: string },
    ctx: CallContext = {},
  ): Promise<{ disclosureId: string; approvalId: string; status: 'proposed' }> {
    const withheld = r.withheldReason?.normalize('NFC').trim() || null;
    if (r.notifyUser && withheld) throw new Problem('validation-failed', { errors: [{ field: 'withheldReason', reason: 'only-when-not-notified' }] });
    if (!r.notifyUser && (!withheld || withheld.length < 10))
      throw new Problem('validation-failed', { errors: [{ field: 'withheldReason', reason: 'required' }] });
    await this.identity.getPublicProfile(r.userId); // not-found for an unknown user
    await this.staff.assertNoConflict(staffId, [r.userId]); // FR-OPS-06
    return this.db.transaction(async (m) => {
      const [{ id }] = (await m.query(
        `INSERT INTO staff.disclosures (subject_user, authority, legal_reference, scope, requested_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [r.userId, r.authority.normalize('NFC').trim(), r.legalReference.normalize('NFC').trim(), r.scope.normalize('NFC').trim(), staffId],
      )) as { id: string }[];
      const approval = await this.approvals.propose(
        {
          action: 'disclosure.approve',
          targetType: 'disclosure',
          targetId: id,
          requiredRole: 'operator',
          byStaffId: staffId,
          reason: `${r.authority.trim()}, ${r.legalReference.trim()}: ${r.scope.trim()}`.slice(0, 1000),
          payload: { userId: r.userId, notifyUser: r.notifyUser, withheldReason: withheld },
        },
        ctx,
        m,
      );
      await this.audit.record(
        {
          actorType: 'staff',
          actorId: staffId,
          action: 'staff.disclosure.requested',
          objectType: 'user',
          objectId: r.userId,
          approvalId: approval.id,
          after: { disclosureId: id, authority: r.authority.trim(), legalReference: r.legalReference.trim(), notifyUser: r.notifyUser },
          reason: r.scope.trim(),
          sourceIp: ctx.ip ?? null,
          correlationId: ctx.correlationId ?? null,
        },
        m,
      );
      return { disclosureId: id, approvalId: approval.id, status: 'proposed' as const };
    });
  }

  /** GET /staff/disclosures/{id}: the record, for staff. */
  async get(id: string) {
    const [d] = (await this.db.query(`SELECT * FROM staff.disclosures WHERE id = $1`, [id])) as DisclosureRow[];
    if (!d) throw new Problem('not-found');
    const iso = (x: Date | null) => (x ? x.toISOString() : null);
    return {
      id: d.id,
      userId: d.subject_user,
      authority: d.authority,
      legalReference: d.legal_reference,
      scope: d.scope,
      requestedBy: d.requested_by,
      approvalId: d.approval_id,
      status: d.disclosed_at ? 'disclosed' : 'proposed',
      disclosedAt: iso(d.disclosed_at),
      userNotifiedAt: iso(d.user_notified_at),
      withheldReason: d.withheld_reason,
      createdAt: d.created_at.toISOString(),
    };
  }

  /** The approval's handler, in its transaction: disclosed, and the user told (after the commit) or the reason kept. */
  private async approved(a: Approval, tx: EntityManager): Promise<void> {
    const p = a.payload as { userId: string; notifyUser: boolean; withheldReason: string | null };
    const rows = (await tx.query(
      `UPDATE staff.disclosures SET approval_id = $2, disclosed_at = now(), user_notified_at = CASE WHEN $3 THEN now() END, withheld_reason = $4
        WHERE id = $1 AND disclosed_at IS NULL RETURNING subject_user, authority`,
      [a.targetId, a.id, p.notifyUser, p.notifyUser ? null : p.withheldReason],
    )) as [{ subject_user: string; authority: string }[], number];
    if (!rows[0].length) throw new Problem('approval-closed');
    const d = rows[0][0];
    await this.audit.record(
      {
        actorType: 'staff',
        actorId: a.decidedBy ?? a.proposedBy,
        action: 'staff.disclosure.approved',
        objectType: 'user',
        objectId: d.subject_user,
        approvalId: a.id,
        after: { disclosureId: a.targetId, notified: p.notifyUser },
        reason: p.notifyUser ? null : p.withheldReason,
      },
      tx,
    );
    if (p.notifyUser) {
      await tx.query(`INSERT INTO disputes.outbox (event_type, aggregate_id, payload) VALUES ('staff.disclosure.made', $1, $2)`, [
        a.targetId,
        JSON.stringify({ disclosureId: a.targetId, userId: d.subject_user, authority: d.authority }),
      ]);
    }
  }

  /** staff.disclosure.made: the user is told which authority received their data (FR-PRV-06). */
  async onDisclosed(e: OutboxEvent): Promise<void> {
    const p = e.payload as { userId?: string; authority?: string };
    if (!p.userId) throw new Error(`${e.type} ${e.id}: no userId`); // retried, then reported (K-04)
    await this.notifier.notify(p.userId, 'privacy.disclosure_notice', { authority: String(p.authority ?? '').slice(0, 200) }, `disclosure:${e.aggregateId}`);
  }

  /** The retention job (daily; I-63): purges dispute case files past CASE_FILE_RETENTION; returns the files erased. */
  async purgeCaseFiles(after: string = CASE_FILE_RETENTION): Promise<number> {
    const rows = ((await this.db.query(`SELECT disputes.purge_due($1::interval) AS key`, [after])) as { key: string }[]).map((r) => r.key);
    // 'order:<id>' names an order whose disputes are all purged: Unit 4 empties its handover photos (U10-23); the other rows are evidence files
    const keys = rows.filter((k) => !k.startsWith('order:'));
    for (const k of rows.filter((x) => x.startsWith('order:'))) keys.push(...(await this.delivery.purgeHandoverPhotos(k.slice('order:'.length))));
    let erased = 0;
    for (const key of keys) {
      try {
        await this.vault.erase(key);
        erased++;
      } catch (err) {
        this.log.warn(`erasing a purged evidence file: ${(err as Error).message}`); // the key is gone from the database; the file is unreachable
      }
    }
    return erased;
  }
}
