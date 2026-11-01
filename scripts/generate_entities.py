#!/usr/bin/env python3
"""Generate TypeORM entities for a unit's schemas from a migrated database (the U*-01 tasks).

The design SQL is the reference (BUILDING.md section 4), so the entities are derived from the
database the migrations built, not written by hand: every table, every column, its type, nullability,
key and enum. backend/test/db/<unit>-entities.spec.ts then checks the result against the live schema,
so a later schema change that is not reflected in the entities fails CI.

usage (PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE name a migrated database):
  python3 scripts/generate_entities.py --schemas identity,audit --out backend/src/modules/identity/db \\
      --name identity.nid_blacklist=NidBlacklistEntry ...

Writes <out>/enums.ts, <out>/entities/<table>.entity.ts and <out>/entities/index.ts (ENTITIES).
Relations are not generated: entities hold the referenced ids, and services join explicitly.
"""
import argparse
import csv
import io
import pathlib
import re
import subprocess

# PostgreSQL udt_name -> (TypeORM column type, TypeScript type)
TYPES = {
    'uuid': ('uuid', 'string'), 'text': ('text', 'string'), 'varchar': ('varchar', 'string'),
    'citext': ('citext', 'string'), 'bool': ('boolean', 'boolean'), 'int2': ('smallint', 'number'),
    'int4': ('integer', 'number'),
    'int8': ('bigint', 'string'),        # money and counters: bigint arrives as a string, never a float
    'numeric': ('numeric', 'string'),    # exact decimals stay strings
    'timestamptz': ('timestamptz', 'Date'), 'date': ('date', 'string'), 'bytea': ('bytea', 'Buffer'),
    'inet': ('inet', 'string'), 'jsonb': ('jsonb', 'unknown'), 'bpchar': ('char', 'string'),
}


def query(sql):
    out = subprocess.run(['psql', '-X', '-A', '-q', '-F', '\t', '-c', f'COPY ({sql}) TO STDOUT WITH CSV HEADER'],
                         capture_output=True, text=True, check=True).stdout
    return list(csv.DictReader(io.StringIO(out)))


def camel(name):
    head, *rest = name.split('_')
    return head + ''.join(p[:1].upper() + p[1:] for p in rest)


def pascal(name):
    return ''.join(p[:1].upper() + p[1:] for p in name.split('_'))


def singular(table):
    for suffix, repl in (('ies', 'y'), ('sses', 'ss'), ('ches', 'ch'), ('s', '')):
        if table.endswith(suffix) and not table.endswith('ss'):
            return table[: -len(suffix)] + repl
    return table


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--schemas', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--name', action='append', default=[], help='schema.table=ClassName')
    a = ap.parse_args()
    schemas = a.schemas.split(',')
    names = dict(n.split('=', 1) for n in a.name)
    in_list = ', '.join(f"'{s}'" for s in schemas)

    cols = query(f"""
      SELECT c.table_schema, c.table_name, c.ordinal_position::int AS pos, c.column_name, c.data_type,
             c.udt_schema, c.udt_name, c.is_nullable, c.column_default, c.is_identity,
             c.character_maximum_length AS len, pg_catalog.col_description(
               format('%I.%I', c.table_schema, c.table_name)::regclass::oid, c.ordinal_position) AS comment
      FROM information_schema.columns c
      JOIN information_schema.tables t USING (table_schema, table_name)
      WHERE c.table_schema IN ({in_list}) AND t.table_type = 'BASE TABLE'
      ORDER BY 1, 2, 3""")
    pks = query(f"""
      SELECT tc.table_schema, tc.table_name, kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu USING (constraint_schema, constraint_name)
      WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema IN ({in_list})""")
    enums = query(f"""
      SELECT n.nspname AS schema, t.typname AS name, string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) AS labels
      FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname IN ({in_list})
         -- also an enum of an earlier unit that these schemas' columns use (audit.actor_type in orders):
         -- the unit gets its own copy of the labels, and its entity check compares them with the database
         OR t.oid IN (SELECT a.atttypid FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
                      JOIN pg_namespace cn ON cn.oid = c.relnamespace WHERE cn.nspname IN ({in_list}) AND a.attnum > 0)
         OR t.typarray IN (SELECT a.atttypid FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
                           JOIN pg_namespace cn ON cn.oid = c.relnamespace WHERE cn.nspname IN ({in_list}) AND a.attnum > 0)
      GROUP BY 1, 2 ORDER BY 1, 2""")
    # Columns a trigger sets before the row is stored: the application must not write them.
    trigger_set = {('audit', 'events', c) for c in ('chain_pos', 'prev_hash', 'hash')}

    pk = {(r['table_schema'], r['table_name'], r['column_name']) for r in pks}
    enum_by = {(e['schema'], e['name']): e['labels'].split(',') for e in enums}
    out = pathlib.Path(a.out)
    (out / 'entities').mkdir(parents=True, exist_ok=True)

    # enums.ts
    lines = ['// Generated by scripts/generate_entities.py from the migrated database; the design SQL is the',
             f'// reference. Enum types of the schemas {", ".join(schemas)}, and of earlier units\' schemas their columns use.', '']
    for (schema, name), labels in sorted(enum_by.items()):
        const = name.upper()
        lines.append(f'export const {const} = [{", ".join(repr(l).replace(chr(39), chr(39)) for l in labels)}] as const;')
        lines.append(f'export type {pascal(name)} = (typeof {const})[number];')
        lines.append('')
    (out / 'enums.ts').write_text('\n'.join(lines).replace('"', "'"))

    tables = {}
    for c in cols:
        tables.setdefault((c['table_schema'], c['table_name']), []).append(c)

    index = []
    for (schema, table), columns in sorted(tables.items()):
        cls = names.get(f'{schema}.{table}') or pascal(singular(table))
        used_enums, typeorm_imports = set(), {'Entity'}
        body = []
        for c in columns:
            col, udt, nullable = c['column_name'], c['udt_name'], c['is_nullable'] == 'YES'
            prop = camel(col)
            is_array = udt.startswith('_')
            base = udt[1:] if is_array else udt
            opts = [f"name: '{col}'"] if prop != col else []
            if (schema, base) in enum_by or (c['udt_schema'], base) in enum_by:
                key = (c['udt_schema'], base)
                const = base.upper()
                used_enums.update({const, pascal(base)})
                orm, ts = 'enum', pascal(base)
                opts += [f'enum: {const}', f"enumName: '{base}'"]
            elif base in TYPES:
                orm, ts = TYPES[base]
            else:
                raise SystemExit(f'unmapped type {udt} in {schema}.{table}.{col}')
            if orm != 'enum':
                opts.insert(0, f"type: '{orm}'")
            else:
                opts.insert(0, "type: 'enum'")
            if c['len']:
                opts.append(f"length: {c['len']}")
            if is_array:
                opts.append('array: true')
                ts = f'{ts}[]'
            if nullable:
                opts.append('nullable: true')
            if (schema, table, col) in trigger_set:
                opts += ['insert: false', 'update: false']
            ts_type = f'{ts} | null' if nullable and ts != 'unknown' else ts
            is_pk = (schema, table, col) in pk
            if is_pk and c['is_identity'] == 'YES':
                typeorm_imports.add('PrimaryGeneratedColumn')
                deco = f"@PrimaryGeneratedColumn('increment', {{ {', '.join(o for o in opts if not o.startswith('type'))}{', ' if prop != col else ''}type: '{orm}' }})"
                deco = deco.replace('{ , ', '{ ')
            elif is_pk and udt == 'uuid' and (c['column_default'] or '').startswith('gen_random_uuid'):
                typeorm_imports.add('PrimaryGeneratedColumn')
                deco = f"@PrimaryGeneratedColumn('uuid'{', { ' + opts[1] + ' }' if prop != col else ''})"
            elif is_pk:
                typeorm_imports.add('PrimaryColumn')
                deco = f"@PrimaryColumn({{ {', '.join(opts)} }})"
            else:
                typeorm_imports.add('Column')
                deco = f"@Column({{ {', '.join(opts)} }})"
            body.append(f'  {deco}\n  {prop}!: {ts_type};\n')
        imports = [f"import {{ {', '.join(sorted(typeorm_imports))} }} from 'typeorm';"]
        if used_enums:
            imports.append(f"import {{ {', '.join(sorted(used_enums))} }} from '../enums';")
        fname = re.sub(r'(?<!^)(?=[A-Z])', '-', cls).lower()
        text = '\n'.join(imports) + f"""

// {schema}.{table}. Generated by scripts/generate_entities.py from the migrated database.
@Entity({{ schema: '{schema}', name: '{table}' }})
export class {cls} {{
""" + '\n'.join(body) + '}\n'
        (out / 'entities' / f'{fname}.entity.ts').write_text(text)
        index.append((cls, fname))

    idx = '\n'.join(f"import {{ {cls} }} from './{fname}.entity';" for cls, fname in index)
    idx += '\n\n' + '\n'.join(f"export {{ {cls} }} from './{fname}.entity';" for cls, fname in index)
    idx += '\n\n// Every table of the schemas ' + ', '.join(schemas) + ', for TypeOrmModule.forFeature.\n'
    idx += 'export const ENTITIES = [\n' + ''.join(f'  {cls},\n' for cls, _ in index) + '];\n'
    (out / 'entities' / 'index.ts').write_text(idx)
    print(f'{len(index)} entities, {len(cols)} columns, {len(enum_by)} enums -> {out}')


if __name__ == '__main__':
    main()
