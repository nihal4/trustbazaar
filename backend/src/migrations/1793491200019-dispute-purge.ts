import { MigrationInterface, QueryRunner } from 'typeorm';

// Unit 7, U7-07 (Decisions log, 2026-11-14; agreed with the user). Runs as tb_owner (SEC-INF-03).
//   I-63: dispute case files are kept 2 years after the decision. Statements and evidence were append-only without
//   exception; now their content (a statement's text, an evidence file's key) is emptied once, at the end of retention,
//   as chat purges its messages: disputes.purge_due empties them and returns the evidence keys to erase from Unit 1's
//   FileVault, and a closed dispute takes the purge stamp as its only change. The rows stay as the record.
//   docs/design/sql/07_disputes_trust_staff.sql holds the result; this migration brings a database migrated before it
//   to the same schema (the functions below are copied from it).
export class DisputePurge1793491200019 implements MigrationInterface {
  name = 'DisputePurge1793491200019';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(UP);
  }

  public async down(q: QueryRunner): Promise<void> {
    // a purged statement or file cannot come back; down only restores the rules for a database where nothing was purged
    await q.query(`
      DROP FUNCTION disputes.purge_due(interval);
      DROP TRIGGER statements_append_only ON disputes.statements;
      DROP TRIGGER evidence_append_only ON disputes.evidence;
      DROP FUNCTION disputes.content_purge_only();
      CREATE TRIGGER statements_append_only BEFORE UPDATE OR DELETE ON disputes.statements FOR EACH ROW EXECUTE FUNCTION identity.forbid_change();
      CREATE TRIGGER evidence_append_only BEFORE UPDATE OR DELETE ON disputes.evidence FOR EACH ROW EXECUTE FUNCTION identity.forbid_change();
      ALTER TABLE disputes.statements DROP CONSTRAINT statement_purged, DROP COLUMN purged_at, ALTER COLUMN text SET NOT NULL;
      ALTER TABLE disputes.evidence DROP CONSTRAINT evidence_purged, DROP COLUMN purged_at, ALTER COLUMN storage_key SET NOT NULL;
      ALTER TABLE disputes.disputes DROP COLUMN purged_at;`);
  }
}

const UP = String.raw`
ALTER TABLE disputes.disputes ADD COLUMN purged_at timestamptz;
ALTER TABLE disputes.statements ALTER COLUMN text DROP NOT NULL, ADD COLUMN purged_at timestamptz,
  ADD CONSTRAINT statement_purged CHECK ((purged_at IS NULL) = (text IS NOT NULL));
ALTER TABLE disputes.evidence ALTER COLUMN storage_key DROP NOT NULL, ADD COLUMN purged_at timestamptz,
  ADD CONSTRAINT evidence_purged CHECK ((purged_at IS NULL) = (storage_key IS NOT NULL));

CREATE OR REPLACE FUNCTION disputes.dispute_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'open' THEN RAISE EXCEPTION 'a dispute starts as open' USING ERRCODE = 'check_violation'; END IF;
    -- FR-DSP-10: a withdrawn dispute cannot be reopened with the same type
    IF EXISTS (SELECT 1 FROM disputes.disputes WHERE order_id = NEW.order_id AND type = NEW.type AND status = 'withdrawn') THEN
      RAISE EXCEPTION 'a dispute of this type was withdrawn and cannot be reopened' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.order_id, NEW.buyer_id, NEW.seller_id, NEW.item_kind, NEW.type, NEW.description, NEW.item_price, NEW.amount_collected, NEW.opened_at, NEW.opened_by)
     IS DISTINCT FROM (OLD.order_id, OLD.buyer_id, OLD.seller_id, OLD.item_kind, OLD.type, OLD.description, OLD.item_price, OLD.amount_collected, OLD.opened_at, OLD.opened_by) THEN
    RAISE EXCEPTION 'what a dispute is about is fixed' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('decided', 'withdrawn') THEN
    -- I-63 (U7-07): once, at the end of retention, the purge stamp is the only change a closed dispute takes
    IF OLD.purged_at IS NULL AND NEW.purged_at IS NOT NULL AND to_jsonb(NEW) - 'purged_at' = to_jsonb(OLD) - 'purged_at' THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'dispute is closed' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.outcome IS NOT NULL AND (NEW.outcome, NEW.item_refund, NEW.return_fare, NEW.return_fare_payer, NEW.decided_by, NEW.decided_at, NEW.decision_reason)
       IS DISTINCT FROM (OLD.outcome, OLD.item_refund, OLD.return_fare, OLD.return_fare_payer, OLD.decided_by, OLD.decided_at, OLD.decision_reason) THEN
    RAISE EXCEPTION 'a decision is final' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT ((OLD.status, NEW.status) IN (
       ('open'::disputes.status, 'under_review'::disputes.status), ('open', 'withdrawn'),
       ('under_review', 'awaiting_seller'), ('under_review', 'decided'), ('under_review', 'awaiting_return'), ('under_review', 'withdrawn'),
       ('awaiting_seller', 'under_review'), ('awaiting_seller', 'withdrawn'),
       ('awaiting_return', 'decided'))) THEN
    RAISE EXCEPTION 'dispute % -> % is not permitted', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  -- FR-DSP-06/CP-30: a decision on BDT 20,000 or more needs an executed four-eyes approval
  IF NEW.outcome IS NOT NULL AND OLD.outcome IS NULL AND NEW.amount_collected >= 2000000 AND NEW.approval_id IS NULL THEN
    RAISE EXCEPTION 'decisions on BDT 20,000 or more need four-eyes approval (CP-30)' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND (NEW.last_actor_id IS NOT DISTINCT FROM OLD.last_actor_id
       AND NEW.last_actor IS NOT DISTINCT FROM OLD.last_actor AND NEW.last_reason IS NOT DISTINCT FROM OLD.last_reason
       AND NEW.last_actor <> 'system') THEN
    RAISE EXCEPTION 'every status change names its actor and reason (FR-DSP-09)' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION disputes.content_purge_only() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE col text := TG_ARGV[0];
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.purged_at IS NULL AND NEW.purged_at IS NOT NULL AND (to_jsonb(NEW) ->> col) IS NULL
     AND to_jsonb(NEW) - col - 'purged_at' = to_jsonb(OLD) - col - 'purged_at' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'table %.% is append-only', TG_TABLE_SCHEMA, TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END $$;
DROP TRIGGER statements_append_only ON disputes.statements;
DROP TRIGGER evidence_append_only ON disputes.evidence;
CREATE TRIGGER statements_append_only BEFORE UPDATE OR DELETE ON disputes.statements FOR EACH ROW EXECUTE FUNCTION disputes.content_purge_only('text');
CREATE TRIGGER evidence_append_only BEFORE UPDATE OR DELETE ON disputes.evidence FOR EACH ROW EXECUTE FUNCTION disputes.content_purge_only('storage_key');

-- SECURITY DEFINER: the application role may not update statements or evidence (REVOKE below); it purges them only
-- through this function, which changes nothing but their content and only at the end of retention.
CREATE FUNCTION disputes.purge_due(p_after interval) RETURNS SETOF varchar LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE d record;
BEGIN
  FOR d IN SELECT id FROM disputes.disputes
            WHERE purged_at IS NULL AND status IN ('decided', 'withdrawn') AND coalesce(decided_at, withdrawn_at) < now() - p_after
            ORDER BY coalesce(decided_at, withdrawn_at) LIMIT 200 FOR UPDATE SKIP LOCKED LOOP
    RETURN QUERY SELECT e.storage_key FROM disputes.evidence e WHERE e.dispute_id = d.id AND e.storage_key IS NOT NULL;
    UPDATE disputes.evidence SET storage_key = NULL, purged_at = now() WHERE dispute_id = d.id AND purged_at IS NULL;
    UPDATE disputes.statements SET text = NULL, purged_at = now() WHERE dispute_id = d.id AND purged_at IS NULL;
    UPDATE disputes.disputes SET purged_at = now() WHERE id = d.id;
  END LOOP;
END $$;
`;
