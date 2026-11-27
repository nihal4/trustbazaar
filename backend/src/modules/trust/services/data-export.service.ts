import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { CLOCK, Clock } from '../../../kernel/clock';
import type { Principal } from '../../../kernel/http/principal';
import { Problem } from '../../../kernel/http/problems';
import { JobRunner } from '../../../kernel/jobs/job-runner';
import type { DataExportSource } from '../../../kernel/privacy/data-export';
import { zip } from '../../../kernel/privacy/zip';
import { CHAT_DATA_EXPORT, NOTIFIER, Notifier } from '../../chat/ports';
import { DELIVERY_DATA_EXPORT } from '../../delivery/ports';
import { GAME_DATA_EXPORT } from '../../game-accounts/ports';
import { AUDIT_SERVICE, AuditServicePort, FILE_VAULT, FileVaultPort, IDENTITY_DATA_EXPORT } from '../../identity/ports';
import { LISTINGS_DATA_EXPORT } from '../../listings/ports';
import { ORDERS_DATA_EXPORT } from '../../orders/ports';
import { TrustDataExport } from './data-export';

// The data export (docs/design/07_disputes_trust_staff.pdf section 10; FR-PRV-03, DV-49; U7-11).
//  - POST /me/data-export (step-up 'data.export'): one export in preparation at a time ('request-in-progress') and
//    one request every 7 days ('rate-limited' with Retry-After). 202.
//  - GET /me/data-export: the latest request: preparing, ready (with a fresh signed link of CP-31, for this session)
//    or expired.
//  - The build job (every 5 minutes): every unit's DataExportSource, one JSON file (trustbazaar-data.json) in a ZIP,
//    sealed by Unit 1's FileVault (purpose data_export); ready for 7 days; the user is told (privacy.export_ready).
//  - The expiry job (daily): files past their 7 days are deleted; the request row stays (file_key 'erased'), so
//    the 7-day rule still sees it.
// KYC images are never included; the export says they can be asked for from the operator.

export const EXPORT_VALID_DAYS = 7; // DV-49
const DAY_MS = 86_400_000;
const ERASED = 'erased';

export interface ExportStatus {
  id: string;
  status: 'preparing' | 'ready' | 'expired';
  requestedAt: string;
  readyAt: string | null;
  expiresAt: string | null;
  download: { url: string; expiresAt: string } | null;
}

type Row = { id: string; user_id: string; requested_at: Date; ready_at: Date | null; file_key: string | null; expires_at: Date | null };

@Injectable()
export class DataExportService implements OnModuleInit {
  private readonly log = new Logger('DataExportService');
  private readonly sources: DataExportSource[];

  constructor(
    private readonly db: DataSource,
    private readonly jobs: JobRunner,
    @Inject(FILE_VAULT) private readonly vault: FileVaultPort,
    @Inject(NOTIFIER) private readonly notifier: Notifier,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditServicePort,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(IDENTITY_DATA_EXPORT) identity: DataExportSource,
    @Inject(ORDERS_DATA_EXPORT) orders: DataExportSource,
    @Inject(LISTINGS_DATA_EXPORT) listings: DataExportSource,
    @Inject(DELIVERY_DATA_EXPORT) delivery: DataExportSource,
    @Inject(GAME_DATA_EXPORT) game: DataExportSource,
    @Inject(CHAT_DATA_EXPORT) chat: DataExportSource,
    trust: TrustDataExport,
  ) {
    this.sources = [identity, orders, listings, delivery, game, chat, trust];
  }

  onModuleInit(): void {
    this.jobs.register({ name: 'trust.data-export.build', intervalMs: 5 * 60_000, run: () => this.buildDue() });
    this.jobs.register({ name: 'trust.data-export.expire', intervalMs: DAY_MS, run: () => this.expireDue() });
  }

  /** POST /me/data-export. */
  async request(userId: string): Promise<ExportStatus> {
    const now = this.clock.now();
    await this.db.transaction(async (m) => {
      await m.query(`SELECT pg_advisory_xact_lock(hashtextextended('trust.data-export:' || $1, 0))`, [userId]);
      const [last] = (await m.query(`SELECT id, ready_at, requested_at FROM staff.export_requests WHERE user_id = $1 ORDER BY requested_at DESC LIMIT 1`, [
        userId,
      ])) as Row[];
      if (last && last.ready_at === null) throw new Problem('request-in-progress');
      const next = last ? last.requested_at.getTime() + EXPORT_VALID_DAYS * DAY_MS : 0;
      if (next > now.getTime()) throw new Problem('rate-limited', { retryAfter: Math.ceil((next - now.getTime()) / 1000) });
      const [r] = (await m.query(`INSERT INTO staff.export_requests (user_id, requested_at) VALUES ($1, $2) RETURNING id`, [userId, now])) as { id: string }[];
      await this.audit.record(
        { actorType: 'user', actorId: userId, action: 'privacy.export.requested', objectType: 'user', objectId: userId, after: { requestId: r.id } },
        m,
      );
    });
    return (await this.status(userId, null))!;
  }

  /** GET /me/data-export; the link is issued only to the signed-in user (viewer), for their session. */
  async status(userId: string, viewer: Principal | null): Promise<ExportStatus | null> {
    const [r] = (await this.db.query(
      `SELECT id, user_id, requested_at, ready_at, file_key, expires_at FROM staff.export_requests WHERE user_id = $1 ORDER BY requested_at DESC LIMIT 1`,
      [userId],
    )) as Row[];
    if (!r) return null;
    const now = this.clock.now();
    const expired = r.expires_at !== null && (r.expires_at <= now || r.file_key === ERASED);
    const status = r.ready_at === null ? 'preparing' : expired ? 'expired' : 'ready';
    const download = status === 'ready' && viewer ? await this.vault.signedLink(r.file_key!, viewer) : null;
    return {
      id: r.id,
      status,
      requestedAt: r.requested_at.toISOString(),
      readyAt: r.ready_at?.toISOString() ?? null,
      expiresAt: r.expires_at?.toISOString() ?? null,
      download,
    };
  }

  /** Every unit's part of the user's data, as the JSON written into the ZIP. */
  async collect(userId: string, now: Date): Promise<Record<string, unknown>> {
    const sections: Record<string, unknown> = {};
    for (const s of this.sources) sections[s.section] = await s.exportFor(userId);
    return {
      format: 'trustbazaar-data-export/1',
      exportedAt: now.toISOString(),
      userId,
      notes: [
        'Amounts are in poisha (100 poisha = 1 taka). Times are UTC.',
        'Identity-document (KYC) images are not included; you can ask the operator for them.',
        'Credentials of game accounts are never kept after delivery and are not included.',
      ],
      ...sections,
    };
  }

  /** The build job: requests waiting, oldest first; each in its own transaction. */
  async buildDue(limit = 10): Promise<number> {
    const due = (await this.db.query(`SELECT id FROM staff.export_requests WHERE ready_at IS NULL ORDER BY requested_at LIMIT $1`, [limit])) as {
      id: string;
    }[];
    let n = 0;
    for (const { id } of due) {
      try {
        if (await this.db.transaction((m) => this.build(m, id))) n++;
      } catch (e) {
        this.log.error({ msg: 'data export not built', requestId: id, error: e as Error });
      }
    }
    return n;
  }

  private async build(m: EntityManager, id: string): Promise<boolean> {
    const [r] = (await m.query(`SELECT id, user_id FROM staff.export_requests WHERE id = $1 AND ready_at IS NULL FOR UPDATE SKIP LOCKED`, [id])) as Row[];
    if (!r) return false;
    const now = this.clock.now();
    const json = Buffer.from(JSON.stringify(await this.collect(r.user_id, now), null, 2), 'utf8');
    const stored = await this.vault.store({
      purpose: 'data_export',
      ownerId: r.user_id,
      bytes: zip([{ name: 'trustbazaar-data.json', data: json, date: now }]),
    });
    const expiresAt = new Date(now.getTime() + EXPORT_VALID_DAYS * DAY_MS);
    await m.query(`UPDATE staff.export_requests SET ready_at = $2, file_key = $3, expires_at = $4 WHERE id = $1`, [id, now, stored.key, expiresAt]);
    await this.audit.record(
      { actorType: 'system', action: 'privacy.export.ready', objectType: 'user', objectId: r.user_id, after: { requestId: id, bytes: stored.size } },
      m,
    );
    await this.notifier.notify(r.user_id, 'privacy.export_ready', { expires_on: expiresAt.toISOString().slice(0, 10) }, `export:${id}`);
    return true;
  }

  /** The expiry job: files past their 7 days are deleted. */
  async expireDue(limit = 200): Promise<number> {
    const due = (await this.db.query(`SELECT id, file_key FROM staff.export_requests WHERE expires_at <= $1 AND file_key <> $2 ORDER BY expires_at LIMIT $3`, [
      this.clock.now(),
      ERASED,
      limit,
    ])) as Row[];
    for (const r of due) {
      await this.vault.erase(r.file_key!).catch((e: Error) => this.log.warn({ msg: 'export file not deleted', requestId: r.id, error: e }));
      await this.db.query(`UPDATE staff.export_requests SET file_key = $2 WHERE id = $1`, [r.id, ERASED]);
    }
    return due.length;
  }
}
