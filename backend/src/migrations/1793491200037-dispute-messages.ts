import { MigrationInterface, QueryRunner } from 'typeorm';

// U10-23 (Decisions log, 2026-11-26; agreed with the user): the buyer and the seller never write to each other about a dispute; TrustBazaar stands between
// them. Each party has a dispute chat with TrustBazaar: its own statements, and the messages TrustBazaar sends it (a complaint was filed, an information
// request, the decision), kept here as the notice template and its parameters so both languages can show them. Append-only. Runs as tb_owner (SEC-INF-03).
// docs/design/sql/07_disputes_trust_staff.sql holds the result.
export class DisputeMessages1793491200037 implements MigrationInterface {
  name = 'DisputeMessages1793491200037';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE disputes.messages (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dispute_id  uuid         NOT NULL REFERENCES disputes.disputes(id),
  user_id     uuid         NOT NULL REFERENCES identity.users(id),   -- who the message is for (the chat of one party)
  template    varchar(60)  NOT NULL,
  params      jsonb        NOT NULL DEFAULT '{}',
  key         varchar(160) NOT NULL,
  at          timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (user_id, key)
)`);
    await q.query(`CREATE INDEX messages_dispute_user ON disputes.messages (dispute_id, user_id, at)`);
    await q.query(`CREATE TRIGGER messages_append_only BEFORE UPDATE OR DELETE ON disputes.messages FOR EACH ROW EXECUTE FUNCTION identity.forbid_change()`);
    await q.query(`GRANT SELECT, INSERT ON disputes.messages TO tb_app`);
    await q.query(`GRANT USAGE ON SEQUENCE disputes.messages_id_seq TO tb_app`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE disputes.messages`);
  }
}
