import { MigrationInterface } from 'typeorm';
import { MIGRATIONS } from './index';
import { migrationDataSource } from '../migrate';

// I-60: one migration per design SQL file, the seven units in unit order, then 09_integration.
// The end-to-end check (all migrations as tb_owner give exactly the schema of the design files, and
// the design's SQL tests pass on it) needs PostgreSQL; see the P0-05 pull request and P0-06.
const DESIGN_ORDER = [
  'IdentityAccess', // 01_identity_access.sql
  'OrdersPayments', // 02_orders_payments.sql
  'ListingsAuctions', // 03_listings_auctions.sql
  'Delivery', // 04_delivery.sql
  'GameAccounts', // 05_game_accounts.sql
  'ChatNotifications', // 06_chat_notifications.sql
  'DisputesTrustStaff', // 07_disputes_trust_staff.sql
  'Integration', // 09_integration.sql
];

const instances = MIGRATIONS.map((M) => new M() as MigrationInterface & { name: string });

describe('migrations', () => {
  it('I-60 the first eight migrations follow the design files in unit order, then 09_integration', () => {
    expect(instances.slice(0, 8).map((m) => m.name.replace(/\d+$/, ''))).toEqual(DESIGN_ORDER);
  });

  it('I-60 timestamps strictly increase, so TypeORM runs them in this order', () => {
    const stamps = instances.map((m) => Number(m.name.match(/(\d{13})$/)?.[1]));
    expect(stamps.every((s, i) => Number.isFinite(s) && (i === 0 || s > stamps[i - 1]))).toBe(true);
  });

  it('SEC-INF-05 the migration data source never synchronises the schema', () => {
    const ds = migrationDataSource('postgres://u:p@localhost/db');
    expect(ds.options.synchronize).toBe(false);
    expect(ds.options.migrationsTransactionMode).toBe('each');
  });
});
