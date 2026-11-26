import { MigrationInterface, QueryRunner } from 'typeorm';

// U10-23 (Decisions log, 2026-11-26; agreed with the user): FR-TNS-10, the buyer's bad faith in a dispute, and the return check.
//   disputes.return_checks: the seller's check of the identifier of the item taken back (a result only, never the number).
//   disputes.buyer_findings: an operator's finding of bad faith on a decided dispute (one a dispute); a finding gives a buyer strike.
//   trust.strike_reason gains two buyer reasons; trust.record_strike now counts only SELLER reasons (a buyer strike must not suspend selling) and
//   trust.record_buyer_strike counts only buyer reasons and suspends buying and bidding (once). disputes.return_rejected closes a dispute that awaits a
//   return when the returned item is not the one sold (the escrow is then released by the service). Runs as tb_owner (SEC-INF-03).
export class BuyerFindings1793491200041 implements MigrationInterface {
  name = 'BuyerFindings1793491200041';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TYPE trust.strike_reason ADD VALUE IF NOT EXISTS 'buyer_false_claim'`);
    await q.query(`ALTER TYPE trust.strike_reason ADD VALUE IF NOT EXISTS 'buyer_swap'`);
    await q.query(`CREATE TABLE disputes.return_checks (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dispute_id  uuid        NOT NULL REFERENCES disputes.disputes(id),
  user_id     uuid        NOT NULL REFERENCES identity.users(id),
  matched     boolean     NOT NULL,
  at          timestamptz NOT NULL DEFAULT now()
)`);
    await q.query(`CREATE INDEX return_checks_dispute ON disputes.return_checks (dispute_id, at)`);
    await q.query(`CREATE TABLE disputes.buyer_findings (
  dispute_id  uuid PRIMARY KEY REFERENCES disputes.disputes(id),
  finding     varchar(16) NOT NULL CHECK (finding IN ('false_claim', 'swap')),
  staff_id    uuid        NOT NULL REFERENCES identity.staff_accounts(id),
  reason      text        NOT NULL CHECK (length(btrim(reason)) >= 20),
  at          timestamptz NOT NULL DEFAULT now()
)`);
    await q.query(`CREATE TRIGGER return_checks_append_only BEFORE UPDATE OR DELETE ON disputes.return_checks FOR EACH ROW EXECUTE FUNCTION identity.forbid_change()`);
    await q.query(`CREATE TRIGGER buyer_findings_append_only BEFORE UPDATE OR DELETE ON disputes.buyer_findings FOR EACH ROW EXECUTE FUNCTION identity.forbid_change()`);
    await q.query(`GRANT SELECT, INSERT ON disputes.return_checks, disputes.buyer_findings TO tb_app`);
    await q.query(`GRANT USAGE ON SEQUENCE disputes.return_checks_id_seq TO tb_app`);
    await q.query(`CREATE OR REPLACE FUNCTION trust.record_strike(p_user uuid, p_reason trust.strike_reason, p_order uuid, p_window interval, p_limit integer) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE n integer; inserted integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('trust.strikes:' || p_user::text, 0));
  INSERT INTO trust.strikes (user_id, reason, order_id) VALUES (p_user, p_reason, p_order) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  IF inserted = 0 THEN RETURN false; END IF;
  SELECT count(*) INTO n FROM trust.strikes WHERE user_id = p_user AND at > now() - p_window AND reason::text IN ('unilateral_cancel', 'missed_deadline', 'dispute_lost');
  IF n >= p_limit AND NOT EXISTS (SELECT 1 FROM trust.sanctions WHERE user_id = p_user AND lifted_at IS NULL AND kind IN ('selling_suspended', 'account_suspended')) THEN
    INSERT INTO trust.sanctions (user_id, kind, reason, automatic, related_type)
    VALUES (p_user, 'selling_suspended', format('%s seller strikes within %s; pending review', n, p_window), true, 'strikes');
    INSERT INTO disputes.outbox (event_type, aggregate_id, payload) VALUES ('trust.sanction.applied', p_user, jsonb_build_object('kind', 'selling_suspended', 'automatic', true));
    RETURN true;
  END IF;
  RETURN false;
END $$`);
    await q.query(`CREATE FUNCTION trust.record_buyer_strike(p_user uuid, p_reason trust.strike_reason, p_order uuid, p_window interval, p_limit integer) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE n integer; inserted integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('trust.strikes:' || p_user::text, 0));
  INSERT INTO trust.strikes (user_id, reason, order_id) VALUES (p_user, p_reason, p_order) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  IF inserted = 0 THEN RETURN false; END IF;
  SELECT count(*) INTO n FROM trust.strikes WHERE user_id = p_user AND at > now() - p_window AND reason::text IN ('buyer_false_claim', 'buyer_swap');
  IF n >= p_limit AND NOT EXISTS (SELECT 1 FROM trust.sanctions WHERE user_id = p_user AND lifted_at IS NULL AND kind IN ('buying_suspended', 'account_suspended')) THEN
    INSERT INTO trust.sanctions (user_id, kind, reason, automatic, related_type)
    VALUES (p_user, 'buying_suspended', format('%s buyer strikes within %s; pending review', n, p_window), true, 'strikes');
    INSERT INTO disputes.outbox (event_type, aggregate_id, payload) VALUES ('trust.sanction.applied', p_user, jsonb_build_object('kind', 'buying_suspended', 'automatic', true));
    RETURN true;
  END IF;
  RETURN false;
END $$`);
    await q.query(`CREATE FUNCTION disputes.return_rejected(p_dispute uuid, p_staff uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE disputes.disputes SET status = 'decided', closed_at = now(), last_actor = 'operator', last_actor_id = p_staff, last_reason = 'the returned item was not the item sold'
   WHERE id = p_dispute AND status = 'awaiting_return';
  IF NOT FOUND THEN RAISE EXCEPTION 'dispute is not awaiting a return' USING ERRCODE = 'check_violation'; END IF;
END $$`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP FUNCTION disputes.return_rejected(uuid, uuid)`);
    await q.query(`DROP FUNCTION trust.record_buyer_strike(uuid, trust.strike_reason, uuid, interval, integer)`);
    await q.query(`DROP TABLE disputes.buyer_findings`);
    await q.query(`DROP TABLE disputes.return_checks`);
  }
}
