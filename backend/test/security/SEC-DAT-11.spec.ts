import { randomUUID } from 'crypto';
import { draftListing, suite } from './setup';

// SEC-DAT-11: public identifiers of orders, listings, files and users are neither sequential nor predictable.
const s = suite();
const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('SEC-DAT-11 unpredictable identifiers', () => {
  it('SEC-DAT-11 listings made one after another get random (version 4) ids with nothing in common', async () => {
    const { b } = await s.signedIn({ kyc: 'verified' });
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push(await draftListing(s, b));
    for (const id of ids) expect(id).toMatch(V4);
    expect(new Set(ids.map((x) => x.slice(0, 8))).size).toBe(3);
  });

  it('SEC-DAT-11 users, orders and stored files get random identifiers from the database', async () => {
    const defaults = await s.fx.query<{ table_name: string; column_default: string | null }>(
      `SELECT table_schema || '.' || table_name AS table_name, column_default FROM information_schema.columns
        WHERE column_name = 'id' AND (table_schema, table_name) IN (('identity','users'), ('orders','orders'), ('listings','listings'), ('identity','kyc_files'), ('disputes','disputes'), ('chat','threads'))`);
    expect(defaults).toHaveLength(6);
    for (const d of defaults) expect(`${d.table_name} ${d.column_default}`).toMatch(/gen_random_uuid\(\)/);
  });

  it('SEC-DAT-11 the identifiers in a member\'s own view are not counters', async () => {
    const { a, b } = await s.signedIn();
    const me = (await (await b.get('/me')).json()) as { id: string };
    expect(me.id).toBe(a.userId);
    expect(me.id).toMatch(V4);
    expect(randomUUID()).toMatch(V4);
  });
});
