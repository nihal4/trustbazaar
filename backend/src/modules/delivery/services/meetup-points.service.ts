import { Inject, Injectable } from '@nestjs/common';
import { DataSource, QueryFailedError } from 'typeorm';
import { Problem } from '../../../kernel/http/problems';
import { AUDIT_SERVICE, AuditServicePort } from '../../identity/ports';

// Curated meetup points (docs/design/04_delivery.pdf section 6.2; FR-DLV-03; U4-03): police stations, mall entrances,
// bank branches and other public places, added by an administrator who has checked them (Decisions log, U4-03: no
// seeded list). They are public, so their exact location is shown, with a map link. A point is made inactive, never
// deleted, because proposals refer to it. Suggestions come from delivery.suggest_points, which snaps both parties'
// locations to a 0.02 degree grid before taking the midpoint (DV-27), and the API returns only the points.

export type PointKind = 'police_station' | 'shopping_mall' | 'bank_branch' | 'other_public';
export interface PointInput { kind: PointKind; nameEn: string; nameBn: string; district: string; lat: number; lng: number; guidance?: string | null; active?: boolean }
export interface PointView {
  id: string; kind: PointKind; nameEn: string; nameBn: string; district: string; lat: number; lng: number; guidance: string | null; active: boolean;
  /** "open in maps", built from the public coordinates only */
  mapUrl: string;
}

/** DV-27 */
export const SUGGESTIONS = 3;
export const GRID_DEGREES = 0.02;

interface Row { id: string; kind: PointKind; name_en: string; name_bn: string; district: string; lat: string; lng: string; guidance: string | null; active: boolean }
const COLUMNS = `id, kind, name_en, name_bn, district, lat::text, lng::text, guidance, active`;
export const mapUrl = (lat: number, lng: number) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`;
export const pointView = (r: Row): PointView => {
  const lat = Number(r.lat);
  const lng = Number(r.lng);
  return { id: r.id, kind: r.kind, nameEn: r.name_en, nameBn: r.name_bn, district: r.district, lat, lng, guidance: r.guidance, active: r.active, mapUrl: mapUrl(lat, lng) };
};

@Injectable()
export class MeetupPointsService {
  constructor(
    private readonly db: DataSource,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditServicePort,
  ) {}

  /** GET /admin/meetup-points: all points, active first, for the administrator's list (Decisions log, U4-03). */
  async list(): Promise<{ items: PointView[] }> {
    const rows = (await this.db.query(`SELECT ${COLUMNS} FROM delivery.meetup_points ORDER BY active DESC, district, name_en`)) as Row[];
    return { items: rows.map(pointView) };
  }

  /** The DV-27 nearest active points to the snapped midpoint of two locations (FR-DLV-03). */
  async suggest(a: { lat: number; lng: number }, b: { lat: number; lng: number }): Promise<PointView[]> {
    const rows = (await this.db.query(
      `SELECT ${COLUMNS.split(', ').map((c) => `p.${c}`).join(', ')} FROM delivery.suggest_points($1, $2, $3, $4, $5, $6) s
         JOIN delivery.meetup_points p ON p.id = s.point_id ORDER BY s.km_from_midpoint, p.id`,
      [a.lat, a.lng, b.lat, b.lng, SUGGESTIONS, GRID_DEGREES],
    )) as Row[];
    return rows.map(pointView);
  }

  async get(id: string): Promise<PointView | null> {
    const [r] = (await this.db.query(`SELECT ${COLUMNS} FROM delivery.meetup_points WHERE id = $1`, [id])) as Row[];
    return r ? pointView(r) : null;
  }

  /** POST /admin/meetup-points */
  async create(staffId: string, p: PointInput): Promise<PointView> {
    return this.write(async (m) => {
      const [r] = (await m.query(
        `INSERT INTO delivery.meetup_points (kind, name_en, name_bn, district, lat, lng, guidance, active, added_by)
         VALUES ($1, $2, $3, $4, round($5::numeric, 5), round($6::numeric, 5), $7, $8, $9) RETURNING ${COLUMNS}`,
        [p.kind, p.nameEn.trim(), p.nameBn.trim(), p.district.trim(), p.lat, p.lng, p.guidance?.trim() || null, p.active ?? true, staffId],
      )) as Row[];
      await this.audit.record({ actorType: 'staff', actorId: staffId, action: 'delivery.meetup_point.added', objectType: 'meetup_point', objectId: r.id, after: { ...pointView(r) } }, m);
      return pointView(r);
    });
  }

  /** PATCH /admin/meetup-points/{id} */
  async update(staffId: string, id: string, p: Partial<PointInput>): Promise<PointView> {
    return this.write(async (m) => {
      const [before] = (await m.query(`SELECT ${COLUMNS} FROM delivery.meetup_points WHERE id = $1 FOR UPDATE`, [id])) as Row[];
      if (!before) throw new Problem('not-found');
      const res = (await m.query(
        `UPDATE delivery.meetup_points SET kind = coalesce($2::delivery.point_kind, kind), name_en = coalesce($3, name_en), name_bn = coalesce($4, name_bn),
                district = coalesce($5, district), lat = coalesce(round($6::numeric, 5), lat), lng = coalesce(round($7::numeric, 5), lng),
                guidance = CASE WHEN $8::boolean THEN $9 ELSE guidance END, active = coalesce($10, active)
          WHERE id = $1 RETURNING ${COLUMNS}`,
        [id, p.kind ?? null, p.nameEn?.trim() ?? null, p.nameBn?.trim() ?? null, p.district?.trim() ?? null, p.lat ?? null, p.lng ?? null,
         p.guidance !== undefined, p.guidance?.trim() || null, p.active ?? null],
      )) as unknown[];
      const [r] = (Array.isArray(res[0]) ? res[0] : res) as Row[];
      await this.audit.record({
        actorType: 'staff', actorId: staffId, action: 'delivery.meetup_point.changed', objectType: 'meetup_point', objectId: id,
        before: { ...pointView(before) }, after: { ...pointView(r) },
      }, m);
      return pointView(r);
    });
  }

  private async write<T>(fn: (m: import('typeorm').EntityManager) => Promise<T>): Promise<T> {
    try {
      return await this.db.transaction(fn);
    } catch (err) {
      if (err instanceof QueryFailedError && (err.driverError as { code?: string }).code === '23514') {
        throw new Problem('validation-failed', { errors: [{ field: 'lat', reason: 'outside-bangladesh' }] });
      }
      throw err;
    }
  }
}
