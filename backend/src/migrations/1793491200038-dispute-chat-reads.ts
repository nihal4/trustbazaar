import { MigrationInterface, QueryRunner } from 'typeorm';

// U10-23 (Decisions log, 2026-11-26): when each party last opened its dispute chat, so the order page can show how many of TrustBazaar's messages are
// unseen. One row per dispute and user, moved forward only. Runs as tb_owner (SEC-INF-03). docs/design/sql/07_disputes_trust_staff.sql holds the result.
export class DisputeChatReads1793491200038 implements MigrationInterface {
  name = 'DisputeChatReads1793491200038';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE disputes.chat_reads (
  dispute_id  uuid        NOT NULL REFERENCES disputes.disputes(id),
  user_id     uuid        NOT NULL REFERENCES identity.users(id),
  seen_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (dispute_id, user_id)
)`);
    await q.query(`GRANT SELECT, INSERT, UPDATE ON disputes.chat_reads TO tb_app`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE disputes.chat_reads`);
  }
}
