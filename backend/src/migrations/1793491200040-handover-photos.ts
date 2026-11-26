import { MigrationInterface, QueryRunner } from 'typeorm';

// U10-23 (Decisions log, 2026-11-26): the seller's photos of the item at the handover, taken before the code is entered, kept encrypted with the time the
// server received them. They are evidence for a later dispute (the staff case file lists them). Append-only. Runs as tb_owner (SEC-INF-03).
export class HandoverPhotos1793491200040 implements MigrationInterface {
  name = 'HandoverPhotos1793491200040';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE delivery.handover_photos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     uuid         NOT NULL REFERENCES orders.orders(id),
  seller_id    uuid         NOT NULL REFERENCES identity.users(id),
  storage_key  varchar(300) UNIQUE,                     -- FileVault, encrypted; null once purged
  sha256       bytea        NOT NULL CHECK (octet_length(sha256) = 32),
  at           timestamptz  NOT NULL DEFAULT now()
)`);
    await q.query(`CREATE INDEX handover_photos_order ON delivery.handover_photos (order_id, at)`);
    await q.query(`CREATE TRIGGER handover_photos_append_only BEFORE UPDATE OR DELETE ON delivery.handover_photos FOR EACH ROW EXECUTE FUNCTION identity.forbid_change()`);
    await q.query(`GRANT SELECT, INSERT ON delivery.handover_photos TO tb_app`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE delivery.handover_photos`);
  }
}
