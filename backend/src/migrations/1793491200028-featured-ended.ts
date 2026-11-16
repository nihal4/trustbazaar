import { MigrationInterface, QueryRunner } from 'typeorm';

// Unit 2, U2-06 (Decisions log, 2026-11-17; agreed with the user). Runs as tb_owner (SEC-INF-03).
//   FR-MON-05: the monetization job ends each featured period once, marking the purchase ended_at in the same
//   transaction as payments.featured.ended. docs/design/sql/02_orders_payments.sql holds the result; this migration
//   brings a database migrated before it to the same schema.
export class FeaturedEnded1793491200028 implements MigrationInterface {
  name = 'FeaturedEnded1793491200028';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE payments.featured_purchases ADD COLUMN ended_at timestamptz,
        ADD CONSTRAINT featured_ended_after_end CHECK (ended_at IS NULL OR ended_at >= ends_at);
      CREATE INDEX featured_to_end ON payments.featured_purchases (ends_at) WHERE ends_at IS NOT NULL AND ended_at IS NULL;
      CREATE INDEX featured_by_listing ON payments.featured_purchases (listing_id, ends_at);`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DROP INDEX payments.featured_by_listing;
      DROP INDEX payments.featured_to_end;
      ALTER TABLE payments.featured_purchases DROP CONSTRAINT featured_ended_after_end, DROP COLUMN ended_at;`);
  }
}
