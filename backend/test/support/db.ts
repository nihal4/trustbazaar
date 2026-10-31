import { DataSource, DataSourceOptions, QueryRunner } from 'typeorm';
import { requireEnv } from './env';

// Runs fn as tb_app inside a transaction that is always rolled back, so database tests leave no rows.
// entities: the TypeORM entities to load, so q.manager.getRepository(Entity) works.
export async function inRolledBackTransaction<T>(
  fn: (q: QueryRunner) => Promise<T>,
  entities: DataSourceOptions['entities'] = [],
): Promise<T> {
  const ds = await new DataSource({ type: 'postgres', url: requireEnv('DATABASE_URL'), entities }).initialize();
  const q = ds.createQueryRunner();
  try {
    await q.startTransaction();
    return await fn(q);
  } finally {
    if (q.isTransactionActive) await q.rollbackTransaction();
    await q.release();
    await ds.destroy();
  }
}

// True if the statement is refused (it runs in a savepoint, so the surrounding transaction stays usable).
export async function isRefused(q: QueryRunner, sql: string): Promise<boolean> {
  await q.query('SAVEPOINT probe');
  try {
    await q.query(sql);
    await q.query('RELEASE SAVEPOINT probe');
    return false;
  } catch {
    await q.query('ROLLBACK TO SAVEPOINT probe');
    return true;
  }
}
