import { MigrationInterface, QueryRunner } from 'typeorm';

// Unit 3, U3-08 (Decisions log, 2026-11-15; agreed with the user). Runs as tb_owner (SEC-INF-03).
//   The design's API lets operators delete screening terms (POST, DELETE /staff/screening-terms, FR-LST-11), but the
//   application role had no DELETE privilege on the table. docs/design/sql/03_listings_auctions.sql now grants it;
//   this migration does the same for a database migrated before. Each deletion is audited with the term.
export class ScreeningTermDelete1793491200027 implements MigrationInterface {
  name = 'ScreeningTermDelete1793491200027';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`GRANT DELETE ON listings.screening_terms TO tb_app`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`REVOKE DELETE ON listings.screening_terms FROM tb_app`);
  }
}
