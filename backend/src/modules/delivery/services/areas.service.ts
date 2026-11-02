import { Inject, Injectable } from '@nestjs/common';
import { DataSource, QueryFailedError } from 'typeorm';
import { Problem } from '../../../kernel/http/problems';
import { AUDIT_SERVICE, AuditServicePort } from '../../identity/ports';

// Drop-off areas (docs/design/04_delivery.pdf sections 3.1 and 5.2; FR-DLV-08, CP-43; U4-02). Curated reference data:
// an administrator adds and changes them (audited). An area is never deleted, only made inactive, because quotes and
// saved addresses refer to it. Centroids are rounded to 3 decimals (about 110 m; the column's own precision).

export type Zone = 'inside_dhaka' | 'dhaka_suburbs' | 'outside_dhaka';
export const ZONES: Zone[] = ['inside_dhaka', 'dhaka_suburbs', 'outside_dhaka'];

export interface AreaView {
  id: number;
  district: string;
  nameEn: string;
  nameBn: string;
  zone: Zone;
  lat: number;
  lng: number;
  active: boolean;
}

interface AreaRow { id: number; district: string; name_en: string; name_bn: string; zone: Zone; lat: string; lng: string; active: boolean }
const view = (r: AreaRow): AreaView => ({
  id: r.id, district: r.district, nameEn: r.name_en, nameBn: r.name_bn, zone: r.zone, lat: Number(r.lat), lng: Number(r.lng), active: r.active,
});

export interface AreaInput { district: string; nameEn: string; nameBn: string; zone: Zone; lat: number; lng: number; active?: boolean }

@Injectable()
export class AreasService {
  constructor(
    private readonly db: DataSource,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditServicePort,
  ) {}

  /** GET /delivery/areas: the active areas, by district then name (public). */
  async list(): Promise<{ items: AreaView[] }> {
    const rows = (await this.db.query(
      `SELECT id, district, name_en, name_bn, zone, lat::text, lng::text, active FROM delivery.areas WHERE active ORDER BY district, name_en`,
    )) as AreaRow[];
    return { items: rows.map(view) };
  }

  async get(id: number): Promise<AreaView | null> {
    const [r] = (await this.db.query(`SELECT id, district, name_en, name_bn, zone, lat::text, lng::text, active FROM delivery.areas WHERE id = $1`, [id])) as AreaRow[];
    return r ? view(r) : null;
  }

  /** POST /admin/areas */
  async create(staffId: string, a: AreaInput): Promise<AreaView> {
    return this.write(async (m) => {
      const [r] = (await m.query(
        `INSERT INTO delivery.areas (district, name_en, name_bn, zone, lat, lng, active) VALUES ($1, $2, $3, $4, round($5::numeric, 3), round($6::numeric, 3), $7)
         RETURNING id, district, name_en, name_bn, zone, lat::text, lng::text, active`,
        [a.district.trim(), a.nameEn.trim(), a.nameBn.trim(), a.zone, a.lat, a.lng, a.active ?? true],
      )) as AreaRow[];
      await this.audit.record({ actorType: 'staff', actorId: staffId, action: 'delivery.area.added', objectType: 'area', objectId: null, after: { ...view(r) } }, m);
      return view(r);
    });
  }

  /** PATCH /admin/areas/{id}: names, zone, centroid or active; the district and English name are its identity. */
  async update(staffId: string, id: number, a: Partial<Omit<AreaInput, 'district'>>): Promise<AreaView> {
    return this.write(async (m) => {
      const [before] = (await m.query(`SELECT id, district, name_en, name_bn, zone, lat::text, lng::text, active FROM delivery.areas WHERE id = $1 FOR UPDATE`, [id])) as AreaRow[];
      if (!before) throw new Problem('not-found');
      const res = (await m.query(
        `UPDATE delivery.areas SET name_en = coalesce($2, name_en), name_bn = coalesce($3, name_bn), zone = coalesce($4::delivery.zone, zone),
                lat = coalesce(round($5::numeric, 3), lat), lng = coalesce(round($6::numeric, 3), lng), active = coalesce($7, active)
          WHERE id = $1 RETURNING id, district, name_en, name_bn, zone, lat::text, lng::text, active`,
        [id, a.nameEn?.trim() ?? null, a.nameBn?.trim() ?? null, a.zone ?? null, a.lat ?? null, a.lng ?? null, a.active ?? null],
      )) as unknown[];
      const [r] = (Array.isArray(res[0]) ? res[0] : res) as AreaRow[];
      await this.audit.record({
        actorType: 'staff', actorId: staffId, action: 'delivery.area.changed', objectType: 'area', objectId: null, before: { ...view(before) }, after: { ...view(r) },
      }, m);
      return view(r);
    });
  }

  private async write<T>(fn: (m: import('typeorm').EntityManager) => Promise<T>): Promise<T> {
    try {
      return await this.db.transaction(fn);
    } catch (err) {
      if (err instanceof QueryFailedError) {
        const code = (err.driverError as { code?: string }).code;
        if (code === '23505') throw new Problem('validation-failed', { errors: [{ field: 'nameEn', reason: 'exists-in-district' }] });
        if (code === '23514') throw new Problem('validation-failed', { errors: [{ field: 'lat', reason: 'outside-bangladesh' }] });
      }
      throw err;
    }
  }
}
