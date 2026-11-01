import { DataSource, EntityMetadata } from 'typeorm';
import { requireEnv } from './env';

// The entity checks of the U*-01 tasks: a unit's TypeORM entities against its migrated schemas (the design
// SQL is the reference, DC-4). A schema change that is not reflected in the entities fails here; regenerate
// them with scripts/generate_entities.py. Reads pg_catalog as tb_app. Call it inside the unit's describe().

// TypeORM column type -> PostgreSQL type name
const PG: Record<string, string> = {
  uuid: 'uuid', text: 'text', varchar: 'varchar', citext: 'citext', boolean: 'bool', smallint: 'int2',
  integer: 'int4', bigint: 'int8', numeric: 'numeric', timestamptz: 'timestamptz', date: 'date', bytea: 'bytea',
  inet: 'inet', jsonb: 'jsonb', char: 'bpchar',
};

interface DbColumn {
  table: string;
  column: string;
  type: string;
  typeSchema: string;
  notNull: boolean;
  isArray: boolean;
}

// eslint-disable-next-line @typescript-eslint/ban-types
export function entityChecks(o: { label: string; schemas: string[]; entities: Function[]; tables: number }): { ds: () => DataSource } {
  let ds: DataSource;
  let db: DbColumn[];
  let enums: Map<string, string[]>;
  let metas: EntityMetadata[];

  beforeAll(async () => {
    ds = await new DataSource({ type: 'postgres', url: requireEnv('DATABASE_URL'), entities: o.entities }).initialize();
    db = await ds.query(
      `SELECT n.nspname || '.' || c.relname AS "table", a.attname AS "column",
              coalesce(et.typname, t.typname) AS "type", coalesce(et.typnamespace, t.typnamespace)::regnamespace::text AS "typeSchema",
              a.attnotnull AS "notNull", t.typelem <> 0 AND t.typname LIKE '\\_%' AS "isArray"
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_type t ON t.oid = a.atttypid LEFT JOIN pg_type et ON et.oid = t.typelem AND t.typname LIKE '\\_%'
       WHERE n.nspname = ANY($1) AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped`,
      [o.schemas],
    );
    // Every enum the database knows, by schema and name: a unit's columns may use an earlier unit's enum
    // (audit.actor_type), and two units may each have an enum of the same name (orders and listings item_kind).
    const rows: { name: string; labels: string[] }[] = await ds.query(
      `SELECT t.typnamespace::regnamespace::text || '.' || t.typname AS name, array_agg(e.enumlabel ORDER BY e.enumsortorder)::text[] AS labels
       FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid GROUP BY t.typnamespace, t.typname`,
    );
    enums = new Map(rows.map((r) => [r.name, r.labels]));
    metas = ds.entityMetadatas;
  });
  afterAll(async () => ds?.destroy());

  const tableOf = (m: EntityMetadata) => `${m.schema}.${m.tableName}`;

  it(`DC-4 every table of the ${o.label} schemas has exactly one entity`, () => {
    const tables = [...new Set(db.map((c) => c.table))].sort();
    expect(metas.map(tableOf).sort()).toEqual(tables);
    expect(tables).toHaveLength(o.tables);
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
        const d = db.find((c) => c.table === tableOf(m) && c.column === col.databaseName)!;
        expect({ column: `${tableOf(m)}.${col.databaseName}`, labels: col.enum }).toEqual({
          column: `${tableOf(m)}.${col.databaseName}`,
          labels: enums.get(`${d.typeSchema}.${col.enumName}`),
        });
      }
    }
  });

  return { ds: () => ds };
}
