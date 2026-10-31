import { DataSource, EntityMetadata } from 'typeorm';
import { ENTITIES, AuditEvent, User } from '../../src/modules/identity/db/entities';
import { requireEnv } from '../support/env';
import { inRolledBackTransaction } from '../support/db';

// U1-01: the identity and audit entities against the migrated database (the design SQL is the reference).
// A schema change that is not reflected in the entities fails here (regenerate with
// scripts/generate_entities.py). Reads pg_catalog as tb_app.
const SCHEMAS = ['identity', 'audit'];

// TypeORM column type -> PostgreSQL type name
const PG: Record<string, string> = {
  uuid: 'uuid', text: 'text', varchar: 'varchar', citext: 'citext', boolean: 'bool', smallint: 'int2',
  integer: 'int4', bigint: 'int8', numeric: 'numeric', timestamptz: 'timestamptz', date: 'date', bytea: 'bytea',
  inet: 'inet', jsonb: 'jsonb',
};

interface DbColumn {
  table: string;
  column: string;
  type: string;
  notNull: boolean;
  isArray: boolean;
}

describe('identity and audit entities', () => {
  let ds: DataSource;
  let db: DbColumn[];
  let enums: Map<string, string[]>;
  let metas: EntityMetadata[];

  beforeAll(async () => {
    ds = await new DataSource({ type: 'postgres', url: requireEnv('DATABASE_URL'), entities: ENTITIES }).initialize();
    db = await ds.query(
      `SELECT n.nspname || '.' || c.relname AS "table", a.attname AS "column",
              coalesce(et.typname, t.typname) AS "type", a.attnotnull AS "notNull", t.typelem <> 0 AND t.typname LIKE '\\_%' AS "isArray"
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_type t ON t.oid = a.atttypid LEFT JOIN pg_type et ON et.oid = t.typelem AND t.typname LIKE '\\_%'
       WHERE n.nspname = ANY($1) AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped`,
      [SCHEMAS],
    );
    const rows: { name: string; labels: string[] }[] = await ds.query(
      `SELECT t.typname AS name, array_agg(e.enumlabel ORDER BY e.enumsortorder)::text[] AS labels
       FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid JOIN pg_namespace n ON n.oid = t.typnamespace
       WHERE n.nspname = ANY($1) GROUP BY t.typname`,
      [SCHEMAS],
    );
    enums = new Map(rows.map((r) => [r.name, r.labels]));
    metas = ds.entityMetadatas;
  });
  afterAll(async () => ds?.destroy());

  const tableOf = (m: EntityMetadata) => `${m.schema}.${m.tableName}`;

  it('DC-4 every table of the identity and audit schemas has exactly one entity', () => {
    const tables = [...new Set(db.map((c) => c.table))].sort();
    expect(metas.map(tableOf).sort()).toEqual(tables);
    expect(tables).toHaveLength(21);
  });

  it('DC-4 every entity maps every column of its table, and no column that does not exist', () => {
    for (const m of metas) {
      const expected = db.filter((c) => c.table === tableOf(m)).map((c) => c.column).sort();
      expect({ table: tableOf(m), columns: m.columns.map((c) => c.databaseName).sort() }).toEqual({
        table: tableOf(m),
        columns: expected,
      });
    }
  });

  it('DC-4 every mapped column has the database type, array-ness and nullability', () => {
    const mismatches: string[] = [];
    for (const m of metas) {
      for (const col of m.columns) {
        const d = db.find((c) => c.table === tableOf(m) && c.column === col.databaseName)!;
        const type = col.type === 'enum' ? col.enumName : PG[String(col.type)];
        const where = `${tableOf(m)}.${col.databaseName}`;
        if (type !== d.type) mismatches.push(`${where}: entity ${type}, database ${d.type}`);
        if (col.isArray !== d.isArray) mismatches.push(`${where}: array ${col.isArray} vs ${d.isArray}`);
        if (col.isNullable === d.notNull) mismatches.push(`${where}: nullable ${col.isNullable}, database NOT NULL ${d.notNull}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('DC-4 every enum column lists the database labels, in order', () => {
    for (const m of metas) {
      for (const col of m.columns.filter((c) => c.type === 'enum')) {
        expect({ column: `${tableOf(m)}.${col.databaseName}`, labels: col.enum }).toEqual({
          column: `${tableOf(m)}.${col.databaseName}`,
          labels: enums.get(col.enumName!),
        });
      }
    }
  });

  it('SEC-INF-03 the application account writes and reads a user through the entity (citext, enums, defaults)', async () => {
    const found = await inRolledBackTransaction(async (q) => {
      const users = q.manager.getRepository(User);
      const saved = await users.save(
        users.create({
          displayName: 'Probe',
          phoneE164: '+8801711999996',
          phoneVerifiedAt: new Date(),
          email: 'probe.entity@tb.test',
          passwordHash: '$argon2id$v=19$x',
          passwordSingleFactorOk: true,
          adultConfirmedAt: new Date(),
        }),
      );
      const again = await users.findOneByOrFail({ email: 'PROBE.ENTITY@TB.TEST' });
      return { savedId: saved.id, again };
    }, ENTITIES);
    expect(found.again.id).toBe(found.savedId);
    expect(found.again.kycStatus).toBe('unsubmitted'); // the column default
    expect(found.again.accountStatus).toBe('active');
  });

  it('SEC-LOG-04 an audit event inserted through the entity gets its chain position and hash from the database', async () => {
    const event = await inRolledBackTransaction(async (q) => {
      const events = q.manager.getRepository(AuditEvent);
      const { identifiers } = await events.insert({ actorType: 'system', action: 'test.entity.insert' });
      return events.findOneByOrFail({ id: identifiers[0].id });
    }, ENTITIES);
    expect(typeof event.id).toBe('string');
    expect(Number(event.chainPos)).toBeGreaterThan(0);
    expect(Buffer.isBuffer(event.hash) && event.hash.length).toBe(32);
    expect(event.at).toBeInstanceOf(Date);
  });
});
