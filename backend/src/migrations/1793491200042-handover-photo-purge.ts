import { MigrationInterface, QueryRunner } from 'typeorm';

// U10-23 (Decisions log, 2026-11-26): the seller's handover photos are kept as long as the disputes of their order (I-63, 2 years after the decision).
//   delivery.handover_photos gets a purge stamp and may change only by it (the file key emptied once), as dispute evidence does, through Unit 4's own
//   functions (DC-1: no function touches another unit's tables). disputes.purge_due now also returns 'order:<id>' for an order whose disputes are all
//   purged; the retention job hands that order to delivery.purge_photos, which empties the keys and returns them to erase from the FileVault.
//   Runs as tb_owner (SEC-INF-03).
export class HandoverPhotoPurge1793491200042 implements MigrationInterface {
  name = 'HandoverPhotoPurge1793491200042';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE delivery.handover_photos ADD COLUMN purged_at timestamptz, ADD CONSTRAINT handover_photo_purged CHECK ((purged_at IS NULL) = (storage_key IS NOT NULL))`);
    await q.query(`CREATE FUNCTION delivery.purge_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.purged_at IS NULL AND NEW.purged_at IS NOT NULL AND NEW.storage_key IS NULL
     AND to_jsonb(NEW) - 'storage_key' - 'purged_at' = to_jsonb(OLD) - 'storage_key' - 'purged_at' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'table %.% is append-only', TG_TABLE_SCHEMA, TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END $$`);
    await q.query(`DROP TRIGGER handover_photos_append_only ON delivery.handover_photos`);
    await q.query(`CREATE TRIGGER handover_photos_append_only BEFORE UPDATE OR DELETE ON delivery.handover_photos FOR EACH ROW EXECUTE FUNCTION delivery.purge_guard()`);
    await q.query(`CREATE FUNCTION delivery.purge_photos(p_order uuid) RETURNS SETOF varchar LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RETURN QUERY SELECT h.storage_key FROM delivery.handover_photos h WHERE h.order_id = p_order AND h.storage_key IS NOT NULL;
  UPDATE delivery.handover_photos SET storage_key = NULL, purged_at = now() WHERE order_id = p_order AND purged_at IS NULL;
END $$`);
    await q.query(`REVOKE ALL ON FUNCTION delivery.purge_photos(uuid) FROM PUBLIC`);
    await q.query(`GRANT EXECUTE ON FUNCTION delivery.purge_photos(uuid) TO tb_app`);
    await q.query(`CREATE OR REPLACE FUNCTION disputes.purge_due(p_after interval) RETURNS SETOF varchar LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE d record;
BEGIN
  FOR d IN SELECT id, order_id FROM disputes.disputes
            WHERE purged_at IS NULL AND status IN ('decided', 'withdrawn') AND coalesce(decided_at, withdrawn_at) < now() - p_after
            ORDER BY coalesce(decided_at, withdrawn_at) LIMIT 200 FOR UPDATE SKIP LOCKED LOOP
    RETURN QUERY SELECT e.storage_key FROM disputes.evidence e WHERE e.dispute_id = d.id AND e.storage_key IS NOT NULL;
    UPDATE disputes.evidence SET storage_key = NULL, purged_at = now() WHERE dispute_id = d.id AND purged_at IS NULL;
    UPDATE disputes.statements SET text = NULL, purged_at = now() WHERE dispute_id = d.id AND purged_at IS NULL;
    UPDATE disputes.disputes SET purged_at = now() WHERE id = d.id;
    -- the order's handover photos (Unit 4's) go with the last of its disputes: the retention job hands the order to Unit 4
    IF NOT EXISTS (SELECT 1 FROM disputes.disputes x WHERE x.order_id = d.order_id AND x.purged_at IS NULL) THEN
      RETURN NEXT 'order:' || d.order_id::text;
    END IF;
  END LOOP;
END $$`);
  }

  public async down(q: QueryRunner): Promise<void> {
    // a purged photo cannot come back; down restores the append-only rule and the earlier function
    await q.query(`DROP TRIGGER handover_photos_append_only ON delivery.handover_photos`);
    await q.query(`CREATE TRIGGER handover_photos_append_only BEFORE UPDATE OR DELETE ON delivery.handover_photos FOR EACH ROW EXECUTE FUNCTION identity.forbid_change()`);
    await q.query(`DROP FUNCTION delivery.purge_photos(uuid)`);
    await q.query(`DROP FUNCTION delivery.purge_guard()`);
    await q.query(`ALTER TABLE delivery.handover_photos DROP CONSTRAINT handover_photo_purged, DROP COLUMN purged_at`);
  }
}
