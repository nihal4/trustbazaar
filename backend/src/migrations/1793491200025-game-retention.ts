import { MigrationInterface, QueryRunner } from 'typeorm';

// Unit 5, U5-05 (Decisions log, 2026-11-15; agreed with the user). Runs as tb_owner (SEC-INF-03).
//   I-63, DV-39: the credential-access log is kept 2 years after the order's handover ended, and an ownership
//   screenshot 2 years after the sale's escrow ended, or 30 days after a rejection or an unsold end. The log was
//   append-only without exception and a reviewed proof final; now game_accounts.purge_due (SECURITY DEFINER) deletes
//   the log rows and clears the screenshot keys at the end of retention, returning the keys for Unit 1's FileVault to
//   erase. The proof keeps its row, marked screenshot_purged_at. docs/design/sql/05_game_accounts.sql holds the result;
//   this migration brings a database migrated before it to the same schema (the functions are copied from it).
export class GameRetention1793491200025 implements MigrationInterface {
  name = 'GameRetention1793491200025';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(UP);
  }

  public async down(q: QueryRunner): Promise<void> {
    // a purged log row or screenshot cannot come back; down only restores the rules for a database where nothing was purged
    await q.query(`
      DROP FUNCTION game_accounts.purge_due(interval, interval, interval);
      DROP TRIGGER access_log_append_only ON game_accounts.access_log;
      DROP FUNCTION game_accounts.access_log_guard();
      CREATE TRIGGER access_log_append_only BEFORE UPDATE OR DELETE ON game_accounts.access_log FOR EACH ROW EXECUTE FUNCTION identity.forbid_change();
      ALTER TABLE game_accounts.ownership_proofs DROP CONSTRAINT proof_screenshot_purged, DROP CONSTRAINT proof_submitted_fields,
        ADD CONSTRAINT proof_submitted_fields CHECK ((status IN ('submitted', 'approved', 'rejected'))
          = (submitted_at IS NOT NULL AND screenshot_key IS NOT NULL AND screenshot_sha256 IS NOT NULL) OR status = 'expired'),
        DROP COLUMN screenshot_purged_at;`);
  }
}

const UP = String.raw`
ALTER TABLE game_accounts.ownership_proofs ADD COLUMN screenshot_purged_at timestamptz,
  DROP CONSTRAINT proof_submitted_fields,
  ADD CONSTRAINT proof_submitted_fields CHECK ((status IN ('submitted', 'approved', 'rejected'))
         = (submitted_at IS NOT NULL AND (screenshot_key IS NOT NULL OR screenshot_purged_at IS NOT NULL) AND screenshot_sha256 IS NOT NULL) OR status = 'expired'),
  ADD CONSTRAINT proof_screenshot_purged CHECK (screenshot_purged_at IS NULL OR screenshot_key IS NULL);

CREATE OR REPLACE FUNCTION game_accounts.proof_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'issued' THEN RAISE EXCEPTION 'a proof starts as issued' USING ERRCODE = 'check_violation'; END IF;
    RETURN NEW;
  END IF;
  IF (NEW.listing_id, NEW.code, NEW.issued_at, NEW.expires_at) IS DISTINCT FROM (OLD.listing_id, OLD.code, OLD.issued_at, OLD.expires_at) THEN
    RAISE EXCEPTION 'proof code and validity are fixed' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT ((OLD.status, NEW.status) IN (
       ('issued'::game_accounts.proof_status, 'submitted'::game_accounts.proof_status), ('issued', 'expired'),
       ('submitted', 'approved'), ('submitted', 'rejected'))) THEN
    RAISE EXCEPTION 'proof % -> % is not permitted', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  -- the end of the screenshot's retention (DV-39, I-63) is the one change after the review: only the table's owner
  -- clears the key, through game_accounts.purge_due, and only once
  IF NEW.screenshot_purged_at IS DISTINCT FROM OLD.screenshot_purged_at AND (OLD.screenshot_purged_at IS NOT NULL OR NEW.screenshot_key IS NOT NULL
       OR current_user <> (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = TG_RELID)) THEN
    RAISE EXCEPTION 'a screenshot is purged once, by game_accounts.purge_due' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status IN ('approved', 'rejected') AND (NEW.reviewed_by, NEW.reviewed_at, NEW.live_check, NEW.review_reason, NEW.screenshot_sha256)
       IS DISTINCT FROM (OLD.reviewed_by, OLD.reviewed_at, OLD.live_check, OLD.review_reason, OLD.screenshot_sha256)
     OR (OLD.status IN ('approved', 'rejected') AND NEW.screenshot_key IS DISTINCT FROM OLD.screenshot_key
         AND NOT (NEW.screenshot_key IS NULL AND OLD.screenshot_purged_at IS NULL AND NEW.screenshot_purged_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'a reviewed proof is final' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION game_accounts.access_log_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('game_accounts.purging', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'table %.% is append-only', TG_TABLE_SCHEMA, TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END $$;
DROP TRIGGER access_log_append_only ON game_accounts.access_log;
CREATE TRIGGER access_log_append_only BEFORE UPDATE OR DELETE ON game_accounts.access_log
  FOR EACH ROW EXECUTE FUNCTION game_accounts.access_log_guard();

CREATE FUNCTION game_accounts.purge_due(p_log interval, p_sold interval, p_unsold interval) RETURNS SETOF varchar LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE p record;
BEGIN
  PERFORM set_config('game_accounts.purging', 'on', true);
  DELETE FROM game_accounts.access_log WHERE id IN (
    SELECT a.id FROM game_accounts.access_log a JOIN game_accounts.handovers h ON h.order_id = a.order_id
     WHERE h.status IN ('closed', 'cancelled') AND coalesce(h.closed_at, h.cancelled_at) < now() - p_log
     LIMIT 5000 FOR UPDATE OF a SKIP LOCKED);
  PERFORM set_config('game_accounts.purging', 'off', true);
  FOR p IN SELECT o.id, o.screenshot_key FROM game_accounts.ownership_proofs o
            WHERE o.screenshot_key IS NOT NULL AND o.status IN ('approved', 'rejected')
              AND ((o.status = 'rejected' AND o.reviewed_at < now() - p_unsold)
                OR EXISTS (SELECT 1 FROM game_accounts.claims c WHERE c.listing_id = o.listing_id AND c.released_at IS NOT NULL
                             AND NOT EXISTS (SELECT 1 FROM game_accounts.claims l WHERE l.listing_id = o.listing_id AND l.released_at IS NULL)
                             AND c.released_at < now() - CASE WHEN c.release_reason = 'escrow_terminal' THEN p_sold ELSE p_unsold END))
            LIMIT 200 FOR UPDATE OF o SKIP LOCKED LOOP
    UPDATE game_accounts.ownership_proofs SET screenshot_key = NULL, screenshot_purged_at = now() WHERE id = p.id;
    RETURN NEXT p.screenshot_key;
  END LOOP;
END $$;
REVOKE EXECUTE ON FUNCTION game_accounts.purge_due(interval, interval, interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION game_accounts.purge_due(interval, interval, interval) TO tb_app;
`;
