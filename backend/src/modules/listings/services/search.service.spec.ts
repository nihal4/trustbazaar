import type { ConfigPort } from '../../../kernel/config-port';
import { Problem } from '../../../kernel/http/problems';
import type { IdentityQuery } from '../../identity/ports';
import type { SearchQuery } from '../http/search.dto';
import { decodeSearchCursor, encodeSearchCursor, FEATURED, PAGE, SearchService } from './search.service';

// Unit tests of SearchService over a stand-in that records the SQL and its values: the rules that decide the query.
// test/api/search.spec.ts runs the searches themselves on PostgreSQL.

const ID = '7c1c2a3e-1111-4a5b-8c9d-000000000001';
const row = (i: number) => ({
  id: `7c1c2a3e-1111-4a5b-8c9d-${String(i).padStart(12, '0')}`, title: 'Phone', item_kind: 'physical', sale_format: 'fixed_price', condition: 'used',
  area_district: 'Dhaka', price: '100000', auction_end_at: null, reserve_not_met: false, featured: false, currently_reserved: false,
  bid_count: null, photo_key: 'a'.repeat(32), distance_km: null, k: ['2026-11-01T10:00:00.000000Z'],
});

function setup(o: { rows?: number; cp36?: boolean; area?: { district: string; lat: number; lng: number } | null } = {}) {
  const calls: { sql: string; values: unknown[] }[] = [];
  const db = {
    query: jest.fn(async (sql: string, values: unknown[]) => {
      calls.push({ sql, values });
      return sql.includes('LIMIT 3') ? [] : Array.from({ length: o.rows ?? 1 }, (_, i) => row(i + 1));
    }),
  };
  const identity = { getApproxArea: jest.fn(async () => o.area ?? null) };
  const params = { current: async () => ({ get: (code: string) => (code === 'CP-36' ? (o.cp36 ?? true) : undefined) }) } as unknown as ConfigPort;
  const svc = new SearchService(db as never, identity as unknown as IdentityQuery, params);
  return { svc, calls, identity };
}
const problem = (p: Promise<unknown>) => p.then(() => null, (e: Problem) => ({ problem: e.problem, errors: e.extra.errors }));

describe('SearchService', () => {
  it('FR-SRC-01 words search the vector and the title, and order by best match first', async () => {
    const t = setup();
    const r = await t.svc.search(undefined, { q: ' মোবাইল ' } as SearchQuery);
    expect(r.sort).toBe('relevance');
    const [main] = t.calls;
    expect(main.sql).toContain(`s.search_tsv @@ plainto_tsquery('simple', $1) OR $1 <% s.title`);
    expect(main.sql).toMatch(/ORDER BY \(ts_rank.*DESC, s\.published_at DESC, s\.id DESC/s);
    expect(main.values[0]).toBe('মোবাইল');
  });

  it('FR-SRC-04 and I-30 while CP-36 is off, game-account listings are left out', async () => {
    const off = setup({ cp36: false });
    await off.svc.search(undefined, {} as SearchQuery);
    expect(off.calls[0].sql).toContain(`s.item_kind <> 'game_account'`);
    const on = setup();
    await on.svc.search(undefined, {} as SearchQuery);
    expect(on.calls[0].sql).not.toContain('game_account');
  });

  it('FR-SRC-02 filters become parameters, never part of the SQL text', async () => {
    const t = setup();
    await t.svc.search(undefined, { category: 4, itemKind: 'physical', saleFormat: 'auction', condition: 'new', minPrice: '100', maxPrice: '900' } as SearchQuery);
    const [main] = t.calls;
    expect(main.values).toEqual([4, 'physical', 'auction', 'new', '100', '900']);
    expect(main.sql).toContain('WITH RECURSIVE');
    expect(main.sql).not.toMatch(/'physical'|'auction'|'new'/);
  });

  it('FR-SRC-05 the search point is rounded to 3 decimals; a signed-in user falls back to their saved area', async () => {
    const t = setup();
    await t.svc.search(undefined, { lat: 23.81049, lng: 90.41234, maxKm: 10, sort: 'distance' } as SearchQuery);
    expect(t.calls[0].values.slice(0, 2)).toEqual([23.81, 90.412]);
    expect(t.calls[0].sql).toMatch(/ORDER BY coalesce\(round\(listings\.distance_km/);
    const saved = setup({ area: { district: 'Khulna', lat: 22.84567, lng: 89.54012 } });
    await saved.svc.search('user-1', { sort: 'distance' } as SearchQuery);
    expect(saved.identity.getApproxArea).toHaveBeenCalledWith('user-1');
    expect(saved.calls[0].values.slice(0, 2)).toEqual([22.846, 89.54]);
  });

  it('FR-SRC-02 parameters that cannot work together are refused', async () => {
    const t = setup();
    expect(await problem(t.svc.search(undefined, { lat: 23.8 } as SearchQuery))).toMatchObject({ errors: [{ field: 'lng', reason: 'lat-and-lng-together' }] });
    expect(await problem(t.svc.search(undefined, { minPrice: '500', maxPrice: '100' } as SearchQuery))).toMatchObject({ errors: [{ field: 'maxPrice' }] });
    expect(await problem(t.svc.search(undefined, { sort: 'relevance', q: '  ' } as SearchQuery))).toMatchObject({ errors: [{ reason: 'relevance-needs-words' }] });
    expect(await problem(t.svc.search(undefined, { maxKm: 5 } as SearchQuery))).toMatchObject({ errors: [{ field: 'maxKm', reason: 'needs-a-search-point' }] });
    expect(await problem(t.svc.search('user-1', { sort: 'distance' } as SearchQuery))).toMatchObject({ errors: [{ field: 'sort' }] });
  });

  it('FR-SRC-03 a full page has a next cursor; the next page continues after it and has no featured list', async () => {
    const t = setup({ rows: PAGE + 1 });
    const first = await t.svc.search(undefined, {} as SearchQuery);
    expect(first.items).toHaveLength(PAGE);
    expect(t.calls).toHaveLength(2); // the page and the featured strip
    expect(t.calls[1].sql).toContain(`LIMIT ${FEATURED}`);
    const next = await t.svc.search(undefined, { cursor: first.nextCursor! } as SearchQuery);
    expect(next.featured).toEqual([]);
    expect(t.calls[2].sql).toContain('(s.published_at, s.id) < ($1::timestamptz, $2::uuid)');
    expect(t.calls[2].values).toEqual(['2026-11-01T10:00:00.000000Z', row(PAGE).id]);
    expect(first.items[0]).toEqual(expect.objectContaining({ thumbUrl: `/api/v1/listing-photos/${'a'.repeat(32)}?size=thumb`, auction: null, distanceKm: null }));
  });

  it('FR-SRC-03 cursors are checked: their sort, their id and each value\'s form', () => {
    const c = encodeSearchCursor('price_asc', ['100000'], ID);
    expect(decodeSearchCursor(c, 'price_asc', ['bigint'])).toEqual({ k: ['100000'], id: ID });
    expect(decodeSearchCursor(undefined, 'newest', ['timestamptz'])).toBeNull();
    const bad = (cursor: string, sort: 'newest' | 'price_asc' = 'price_asc') => {
      expect(() => decodeSearchCursor(cursor, sort, ['bigint'])).toThrow(Problem);
    };
    bad(c, 'newest');
    bad('%%%');
    bad(Buffer.from('not json').toString('base64url'));
    bad(encodeSearchCursor('price_asc', ['1; DROP TABLE x'], ID));
    bad(encodeSearchCursor('price_asc', ['1', '2'], ID));
    bad(encodeSearchCursor('price_asc', ['1'], 'not-an-id'));
  });
});
