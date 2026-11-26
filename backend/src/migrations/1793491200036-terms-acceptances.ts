import { MigrationInterface, QueryRunner } from 'typeorm';

// U10-23 (Decisions log, 2026-11-26; agreed with the user): the buyer's acceptance of the terms shown before an irreversible step
// (the handover code, courier delivery, opening a dispute) is kept: who, which order, which terms and which version, when. It is
// the proof that the liability clauses were accepted. Append-only. Runs as tb_owner (SEC-INF-03).
// docs/design/sql/02_orders_payments.sql holds the result.
export class TermsAcceptances1793491200036 implements MigrationInterface {
  name = 'TermsAcceptances1793491200036';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE orders.terms_acceptances (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      uuid        NOT NULL REFERENCES orders.orders(id),
  user_id       uuid        NOT NULL REFERENCES identity.users(id),
  kind          varchar(16) NOT NULL CHECK (kind IN ('handover_code', 'courier', 'dispute')),
  terms_version smallint    NOT NULL CHECK (terms_version BETWEEN 1 AND 999),
  accepted_at   timestamptz NOT NULL DEFAULT now()
)`);
    await q.query(`CREATE INDEX terms_acceptances_order ON orders.terms_acceptances (order_id, kind)`);
    await q.query(`CREATE TRIGGER terms_acceptances_append_only BEFORE UPDATE OR DELETE ON orders.terms_acceptances FOR EACH ROW EXECUTE FUNCTION identity.forbid_change()`);
    await q.query(`GRANT SELECT, INSERT ON orders.terms_acceptances TO tb_app`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE orders.terms_acceptances`);
  }
}
