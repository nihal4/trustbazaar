import { MigrationInterface, QueryRunner } from 'typeorm';

// Unit 7, U7-03 (Decisions log, 2026-11-14; agreed with the user). Runs as tb_owner (SEC-INF-03).
//   disputes.evidence.storage_key holds Unit 1's FileVault key (`v1.<purpose>.<file id>.<name>.<wrapped data key>`,
//   about 165 characters), as chat.messages.image_key does (U6-02), so it is varchar(300), not 80.
//   docs/design/sql/07_disputes_trust_staff.sql holds the result; this migration brings a database migrated before it to
//   the same schema.
export class DisputeEvidenceKey1793491200016 implements MigrationInterface {
  name = 'DisputeEvidenceKey1793491200016';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE disputes.evidence ALTER COLUMN storage_key TYPE varchar(300)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE disputes.evidence ALTER COLUMN storage_key TYPE varchar(80)`);
  }
}
