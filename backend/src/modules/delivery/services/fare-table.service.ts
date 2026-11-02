import { Inject, Injectable } from '@nestjs/common';
import { DataSource, QueryFailedError } from 'typeorm';
import { Problem } from '../../../kernel/http/problems';
import { AUDIT_SERVICE, AuditServicePort } from '../../identity/ports';
import { ZONES, type Zone } from './areas.service';

// FareTableService (docs/design/04_delivery.pdf section 5.4; CP-43, FR-OPS-08; U4-02). The fare table is versioned and
// append-only: a change is a new version with an effective time, a source and the administrator who published it
// (audited). A quote records the version it used. Amounts in poisha, as strings.

export interface FareRowInput { zone: Zone; upTo1kg: string; upTo2kg: string; perExtraKg: string }
export interface FareTableView {
  version: number;
  effectiveFrom: string;
  source: string;
  rows: FareRowInput[];
}

@Injectable()
export class FareTableService {
  constructor(
    private readonly db: DataSource,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditServicePort,
  ) {}

  /** The version in force now (delivery.fare_version_at), for the administrator's form. */
  async current(): Promise<FareTableView | null> {
    const [t] = (await this.db.query(
      `SELECT version, effective_from, source FROM delivery.fare_tables WHERE version = delivery.fare_version_at(now())`,
    )) as { version: number; effective_from: Date; source: string }[];
    return t ? this.withRows(t) : null;
  }

  /** POST /admin/fare-tables: all three zones, effective now or later. */
  async publish(staffId: string, f: { effectiveFrom?: string; source: string; rows: FareRowInput[] }): Promise<FareTableView> {
    const zones = new Set(f.rows.map((r) => r.zone));
    if (f.rows.length !== 3 || ZONES.some((z) => !zones.has(z))) throw new Problem('validation-failed', { errors: [{ field: 'rows', reason: 'one-per-zone' }] });
    if (f.source.trim().length < 10) throw new Problem('validation-failed', { errors: [{ field: 'source', reason: 'too-short' }] });
    const from = f.effectiveFrom ? new Date(f.effectiveFrom) : null;
    if (from && (Number.isNaN(from.getTime()) || from.getTime() < Date.now() - 60_000)) {
      throw new Problem('validation-failed', { errors: [{ field: 'effectiveFrom', reason: 'not-in-the-past' }] });
    }
    try {
      return await this.db.transaction(async (m) => {
        // one version number at a time (the tables are append-only: the app may not lock them for update)
        await m.query(`SELECT pg_advisory_xact_lock(hashtextextended('delivery.fare_tables', 0))`);
        const [{ v }] = (await m.query(`SELECT coalesce(max(version), 0) + 1 AS v FROM delivery.fare_tables`)) as { v: number }[];
        const [t] = (await m.query(
          `INSERT INTO delivery.fare_tables (version, effective_from, source, created_by) VALUES ($1, coalesce($2::timestamptz, now()), $3, $4)
           RETURNING version, effective_from, source`,
          [v, from?.toISOString() ?? null, f.source.trim(), staffId],
        )) as { version: number; effective_from: Date; source: string }[];
        for (const r of f.rows) {
          await m.query(`INSERT INTO delivery.fare_rows (version, zone, up_to_1kg, up_to_2kg, per_extra_kg) VALUES ($1, $2, $3, $4, $5)`,
            [v, r.zone, r.upTo1kg, r.upTo2kg, r.perExtraKg]);
        }
        await this.audit.record({
          actorType: 'staff', actorId: staffId, action: 'delivery.fare_table.published', objectType: 'fare_table', objectId: null,
          after: { version: v, effectiveFrom: t.effective_from.toISOString(), source: t.source, rows: f.rows },
        }, m);
        return this.withRows(t, m);
      });
    } catch (err) {
      if (err instanceof QueryFailedError && (err.driverError as { code?: string }).code === '23514') {
        throw new Problem('validation-failed', { errors: [{ field: 'rows', reason: 'fare-must-rise-with-weight' }] });
      }
      throw err;
    }
  }

  private async withRows(t: { version: number; effective_from: Date; source: string }, q: { query: DataSource['query'] } = this.db): Promise<FareTableView> {
    const rows = (await q.query(
      `SELECT zone, up_to_1kg::text, up_to_2kg::text, per_extra_kg::text FROM delivery.fare_rows WHERE version = $1 ORDER BY zone`, [t.version],
    )) as { zone: Zone; up_to_1kg: string; up_to_2kg: string; per_extra_kg: string }[];
    return {
      version: t.version, effectiveFrom: t.effective_from.toISOString(), source: t.source,
      rows: rows.map((r) => ({ zone: r.zone, upTo1kg: r.up_to_1kg, upTo2kg: r.up_to_2kg, perExtraKg: r.per_extra_kg })),
    };
  }
}
