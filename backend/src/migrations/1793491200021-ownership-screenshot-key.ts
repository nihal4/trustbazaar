import { MigrationInterface, QueryRunner } from 'typeorm';

// Unit 5, U5-02 (Decisions log, 2026-11-14; agreed with the user). Runs as tb_owner (SEC-INF-03).
//   game_accounts.ownership_proofs.screenshot_key holds Unit 1's FileVault key (`v1.<purpose>.<file id>.<name>.<wrapped
//   data key>`, about 165 characters), as chat images (U6-02) and dispute evidence (U7-03) do, so it is varchar(300),
//   not 80; screenshot_dek stays NULL, since the key carries the wrapped data key.
//   docs/design/sql/05_game_accounts.sql holds the result; this migration brings a database migrated before it to the
//   same schema.
export class OwnershipScreenshotKey1793491200021 implements MigrationInterface {
  name = 'OwnershipScreenshotKey1793491200021';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE game_accounts.ownership_proofs ALTER COLUMN screenshot_key TYPE varchar(300)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE game_accounts.ownership_proofs ALTER COLUMN screenshot_key TYPE varchar(80)`);
  }
}
