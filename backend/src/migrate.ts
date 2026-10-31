import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { MIGRATIONS } from './migrations';

// The "migrate" container's entry (docs/design/09_integration.pdf, sections 3.3 and 5.1): applies the
// pending migrations and exits, before the backend starts. DATABASE_URL names tb_owner, which owns the
// schemas but has no superuser, role- or database-creation rights (SEC-INF-03, I-60).
// Each migration runs in its own transaction, so a failure leaves the earlier ones applied and none half-done.
// Exit code 0 when the database is current, 1 on any error. Schema synchronisation is never used (SEC-INF-05).
export function migrationDataSource(url: string): DataSource {
  return new DataSource({
    type: 'postgres',
    url,
    migrations: MIGRATIONS,
    migrationsTransactionMode: 'each',
    synchronize: false,
    logging: ['error', 'migration'],
  });
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const ds = await migrationDataSource(url).initialize();
  try {
    const [{ current_user: role }] = await ds.query('SELECT current_user');
    const applied = await ds.runMigrations();
    console.log(
      JSON.stringify({ msg: 'migrations applied', role, applied: applied.map((m) => m.name), total: MIGRATIONS.length }),
    );
  } finally {
    await ds.destroy();
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(JSON.stringify({ msg: 'migration failed', error: err instanceof Error ? err.message : String(err) }));
    process.exit(1);
  });
}
