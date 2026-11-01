import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CONFIG_PORT, ConfigPort } from '../../../kernel/config-port';
import { cursorAt } from '../../../kernel/http/cursor';
import { Problem } from '../../../kernel/http/problems';
import { IDENTITY_QUERY, IdentityQuery } from '../../identity/ports';
import type { SearchQuery, Sort } from '../http/search.dto';
import { photoUrl } from './listing.service';

// SearchService (docs/design/03_listings_auctions.pdf section 7; FR-SRC-01 to FR-SRC-05, FR-MON-05; U3-03). Over the
// view listings.searchable, which holds only active listings of visible sellers and open auctions (FR-SRC-04); while
// CP-36 is off, active game-account listings are left out too, as on the listing page (I-30).
//   Text: the 'simple' full-text vector (title weighted over description) or a trigram word match on the title,
//         so Bangla and English words, parts of words and small misspellings are found (FR-SRC-01).
//   Distance: a bounding box on the rounded coordinates, then listings.distance_km; shown and sorted in whole
//         kilometres, so no position finer than a kilometre can be worked out from results or cursors (FR-SRC-05).
//   Pages: keyset cursors on the sort key and the id, so a page never repeats or skips a listing (section 7.2).
// Every value reaches SQL as a parameter; only the fixed fragments below are put together.

export const PAGE = 20;
/** DV-21: featured listings shown above the results. */
export const FEATURED = 3;
const KM_PER_DEG_LAT = 111.32;
const NO_DISTANCE = 2147483647; // listings without a location (game accounts) sort last by distance

type KeyType = 'timestamptz' | 'bigint' | 'int' | 'float8';
interface Key { expr: string; type: KeyType }
interface SortSpec { keys: Key[]; dir: 'ASC' | 'DESC' }

interface Row {
  id: string; title: string; item_kind: string; sale_format: string; condition: string | null; area_district: string | null;
  price: string; auction_end_at: Date | null; reserve_not_met: boolean; featured: boolean; currently_reserved: boolean;
  bid_count: number | null; photo_key: string | null; distance_km: number | null; k: string[];
}

const PATTERNS: Record<KeyType, RegExp> = {
  timestamptz: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/,
  bigint: /^-?\d{1,19}$/,
  int: /^-?\d{1,10}$/,
  float8: /^-?\d+(\.\d+)?(e[-+]?\d+)?$/i,
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const badCursor = () => new Problem('validation-failed', { errors: [{ field: 'cursor', reason: 'format' }] });

export function encodeSearchCursor(sort: Sort, k: string[], id: string): string {
  return Buffer.from(JSON.stringify({ s: sort, k, id })).toString('base64url');
}

/** A cursor names its sort, so a cursor from another sort is refused rather than misread. */
export function decodeSearchCursor(cursor: string | undefined, sort: Sort, types: KeyType[]): { k: string[]; id: string } | null {
  if (cursor === undefined || cursor === '') return null;
  let c: unknown;
  try {
    c = JSON.parse(Buffer.from(cursor, 'base64url').toString());
  } catch {
    throw badCursor();
  }
  const { s, k, id } = (c ?? {}) as { s?: unknown; k?: unknown; id?: unknown };
  if (s !== sort || typeof id !== 'string' || !UUID.test(id) || !Array.isArray(k) || k.length !== types.length) throw badCursor();
  if (!k.every((v, i) => typeof v === 'string' && PATTERNS[types[i]].test(v))) throw badCursor();
  return { k: k as string[], id };
}

@Injectable()
export class SearchService {
  constructor(
    private readonly db: DataSource,
    @Inject(IDENTITY_QUERY) private readonly identity: IdentityQuery,
    @Inject(CONFIG_PORT) private readonly params: ConfigPort,
  ) {}

  async search(viewerId: string | undefined, q: SearchQuery) {
    const errors: { field: string; reason: string }[] = [];
    if ((q.lat === undefined) !== (q.lng === undefined)) errors.push({ field: q.lat === undefined ? 'lat' : 'lng', reason: 'lat-and-lng-together' });
    if (q.minPrice && q.maxPrice && BigInt(q.minPrice) > BigInt(q.maxPrice)) errors.push({ field: 'maxPrice', reason: 'below-min-price' });
    if (q.sort === 'relevance' && !q.q?.trim()) errors.push({ field: 'sort', reason: 'relevance-needs-words' });
    if (errors.length) throw new Problem('validation-failed', { errors });

    const text = q.q?.trim() || undefined;
    const sort: Sort = q.sort ?? (text ? 'relevance' : 'newest');
    // the search point: as sent, else the signed-in user's saved area; rounded like the listings' own (FR-LST-06)
    const given = q.lat !== undefined && q.lng !== undefined ? { lat: q.lat, lng: q.lng } : null;
    const saved = !given && viewerId ? await this.identity.getApproxArea(viewerId) : null;
    const point = given ?? saved;
    const origin = point && { lat: Math.round(point.lat * 1000) / 1000, lng: Math.round(point.lng * 1000) / 1000 };
    if (!origin && (sort === 'distance' || q.maxKm !== undefined)) {
      throw new Problem('validation-failed', { errors: [{ field: sort === 'distance' ? 'sort' : 'maxKm', reason: 'needs-a-search-point' }] });
    }

    const values: unknown[] = [];
    const p = (v: unknown, cast?: string) => {
      values.push(v);
      return cast ? `$${values.length}::${cast}` : `$${values.length}`;
    };
    const where: string[] = [];
    let rank = '0::float8';
    if (text) {
      const words = p(text);
      const tsq = `plainto_tsquery('simple', ${words})`;
      where.push(`(s.search_tsv @@ ${tsq} OR ${words} <% s.title)`);
      rank = `(ts_rank(s.search_tsv, ${tsq}) + word_similarity(${words}, s.title))::float8`;
    }
    if (q.category !== undefined) {
      where.push(`s.category_id IN (WITH RECURSIVE c(id) AS (SELECT ${p(q.category, 'smallint')}
                   UNION ALL SELECT k.id FROM listings.categories k JOIN c ON k.parent_id = c.id) SELECT id FROM c)`);
    }
    if (q.itemKind) where.push(`s.item_kind::text = ${p(q.itemKind)}`);
    if (q.saleFormat) where.push(`s.sale_format::text = ${p(q.saleFormat)}`);
    if (q.condition) where.push(`s.condition::text = ${p(q.condition)}`);
    if (q.minPrice) where.push(`s.display_price >= ${p(q.minPrice, 'bigint')}`);
    if (q.maxPrice) where.push(`s.display_price <= ${p(q.maxPrice, 'bigint')}`);
    if ((await this.params.current()).get<boolean>('CP-36') !== true) where.push(`s.item_kind <> 'game_account'`);
    if (sort === 'ending_soon') where.push(`s.sale_format = 'auction'`);

    let distance: string | null = null;
    if (origin) {
      distance = `listings.distance_km(s.approx_lat, s.approx_lng, ${p(origin.lat, 'numeric')}, ${p(origin.lng, 'numeric')})`;
      if (q.maxKm !== undefined) {
        const dLat = q.maxKm / KM_PER_DEG_LAT;
        const dLng = q.maxKm / (KM_PER_DEG_LAT * Math.cos((origin.lat * Math.PI) / 180));
        where.push(`s.approx_lat BETWEEN ${p(origin.lat - dLat, 'numeric')} AND ${p(origin.lat + dLat, 'numeric')}`);
        where.push(`s.approx_lng BETWEEN ${p(origin.lng - dLng, 'numeric')} AND ${p(origin.lng + dLng, 'numeric')}`);
        where.push(`${distance} <= ${p(q.maxKm, 'float8')}`);
      }
    }
    const km = distance ? `round(${distance})::int` : 'NULL::int';

    const specs: Record<Sort, SortSpec> = {
      relevance: { keys: [{ expr: rank, type: 'float8' }, { expr: 's.published_at', type: 'timestamptz' }], dir: 'DESC' },
      newest: { keys: [{ expr: 's.published_at', type: 'timestamptz' }], dir: 'DESC' },
      price_asc: { keys: [{ expr: 's.display_price', type: 'bigint' }], dir: 'ASC' },
      price_desc: { keys: [{ expr: 's.display_price', type: 'bigint' }], dir: 'DESC' },
      distance: { keys: [{ expr: `coalesce(${km}, ${NO_DISTANCE})`, type: 'int' }], dir: 'ASC' },
      ending_soon: { keys: [{ expr: 's.auction_end_at', type: 'timestamptz' }], dir: 'ASC' },
    };
    const spec = specs[sort];
    const after = decodeSearchCursor(q.cursor, sort, spec.keys.map((k) => k.type));

    const select = (extraWhere: string[], order: string, limit: number) => `
      SELECT s.id, s.title, s.item_kind, s.sale_format, s.condition, s.area_district, s.display_price::text AS price,
             s.auction_end_at, s.reserve_not_met, s.featured, s.currently_reserved, a.bid_count,
             (SELECT ph.storage_key FROM listings.listing_photos ph
               WHERE ph.listing_id = s.id AND ph.removed_at IS NULL ORDER BY ph.position LIMIT 1) AS photo_key,
             ${km} AS distance_km,
             ARRAY[${spec.keys.map((k) => (k.type === 'timestamptz' ? cursorAt(k.expr) : `(${k.expr})::text`)).join(', ')}] AS k
        FROM listings.searchable s LEFT JOIN auctions.auctions a ON a.listing_id = s.id
       ${[...where, ...extraWhere].length ? `WHERE ${[...where, ...extraWhere].join(' AND ')}` : ''}
       ORDER BY ${order}
       LIMIT ${limit}`;

    const keyset: string[] = [];
    if (after) {
      const left = [...spec.keys.map((k) => k.expr), 's.id'].join(', ');
      const right = [...after.k.map((v, i) => p(v, spec.keys[i].type)), p(after.id, 'uuid')].join(', ');
      keyset.push(`(${left}) ${spec.dir === 'DESC' ? '<' : '>'} (${right})`);
    }
    const order = [...spec.keys.map((k) => `${k.expr} ${spec.dir}`), `s.id ${spec.dir}`].join(', ');
    const rows = (await this.db.query(select(keyset, order, PAGE + 1), values)) as Row[];
    const page = rows.slice(0, PAGE);
    const last = page[page.length - 1];

    // FR-MON-05: on the first page only, up to DV-21 featured matches in their own labelled list; the organic
    // ranking above is not changed by featuring (Decisions log, U3-03)
    const featured = after
      ? []
      : ((await this.db.query(select(['s.featured'], `${rank} DESC, s.published_at DESC, s.id DESC`, FEATURED), values)) as Row[]);

    return {
      items: page.map(card),
      nextCursor: rows.length > PAGE && last ? encodeSearchCursor(sort, last.k, last.id) : null,
      featured: featured.map(card),
      sort,
    };
  }
}

/** A result card: what the list shows, never coordinates, the reserve amount or the seller (FR-SRC-05). */
function card(r: Row) {
  return {
    id: r.id,
    title: r.title,
    itemKind: r.item_kind,
    saleFormat: r.sale_format,
    condition: r.condition,
    district: r.area_district,
    price: r.price,
    thumbUrl: r.photo_key ? photoUrl(r.photo_key, 'thumb') : null,
    distanceKm: r.distance_km,
    featured: r.featured,
    currentlyReserved: r.currently_reserved,
    auction: r.sale_format === 'auction'
      ? { endAt: r.auction_end_at ? r.auction_end_at.toISOString() : null, bidCount: r.bid_count ?? 0, reserveMet: !r.reserve_not_met }
      : null,
  };
}
