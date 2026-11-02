import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { STARTER_AREAS } from './modules/delivery/db/starter-areas';

// The starter drop-off areas (Unit 4 section 5.2; Decisions log, U4-02), loaded once after the migrations, in the
// backend container:
//   docker compose exec backend node dist/areas-seed.js
// (npm run areas:seed does the same outside the container.) An area that already exists (same district and English
// name) is left as it is, so the command can be run again and never undoes an administrator's correction. Audited.
export async function seedAreas(ds: DataSource): Promise<number> {
  return ds.transaction(async (m) => {
    let added = 0;
    for (const a of STARTER_AREAS) {
      const rows = (await m.query(
        `INSERT INTO delivery.areas (district, name_en, name_bn, zone, lat, lng) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (district, name_en) DO NOTHING RETURNING id`,
        [a.district, a.nameEn, a.nameBn, a.zone, a.lat, a.lng],
      )) as unknown[];
      added += rows.length;
    }
    await m.query(
      `INSERT INTO audit.events (actor_type, action, object_type, after_state, reason) VALUES ('system', 'delivery.areas.seeded', 'area', $1, 'deployment command')`,
      [JSON.stringify({ added, listed: STARTER_AREAS.length })],
    );
    return added;
  });
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const ds = await new DataSource({ type: 'postgres', url, synchronize: false }).initialize();
  try {
    const added = await seedAreas(ds);
    console.log(JSON.stringify({ msg: 'starter areas loaded', added, listed: STARTER_AREAS.length }));
  } finally {
    await ds.destroy();
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(JSON.stringify({ msg: 'area seed failed', error: err instanceof Error ? err.message : String(err) }));
    process.exit(1);
  });
}
