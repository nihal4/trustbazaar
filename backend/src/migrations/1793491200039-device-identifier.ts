import { MigrationInterface, QueryRunner } from 'typeorm';

// U10-23 (Decisions log, 2026-11-26; agreed with the user): the identifier of a device (IMEI, serial number) at listing, and its check at the meetup.
// listings.listings keeps a keyed hash of it and its last four characters (the only part ever shown); delivery.device_checks keeps what the buyer typed at the
// meetup as a result (matched or not), never the number. Runs as tb_owner (SEC-INF-03). docs/design/sql/03_listings_auctions.sql and 04_delivery.sql hold the result.
export class DeviceIdentifier1793491200039 implements MigrationInterface {
  name = 'DeviceIdentifier1793491200039';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE listings.listings
  ADD COLUMN serial_hmac  bytea,
  ADD COLUMN serial_last4 varchar(4),
  ADD CONSTRAINT serial_last4_form CHECK (serial_last4 IS NULL OR serial_last4 ~ '^[A-Z0-9]{4}$'),
  ADD CONSTRAINT serial_both_or_none CHECK ((serial_hmac IS NULL) = (serial_last4 IS NULL))`);
    await q.query(`CREATE TABLE delivery.device_checks (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id   uuid        NOT NULL REFERENCES orders.orders(id),
  user_id    uuid        NOT NULL REFERENCES identity.users(id),
  matched    boolean     NOT NULL,
  at         timestamptz NOT NULL DEFAULT now()
)`);
    await q.query(`CREATE INDEX device_checks_order ON delivery.device_checks (order_id, at)`);
    await q.query(`CREATE TRIGGER device_checks_append_only BEFORE UPDATE OR DELETE ON delivery.device_checks FOR EACH ROW EXECUTE FUNCTION identity.forbid_change()`);
    await q.query(`GRANT SELECT, INSERT ON delivery.device_checks TO tb_app`);
    await q.query(`GRANT USAGE ON SEQUENCE delivery.device_checks_id_seq TO tb_app`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE delivery.device_checks`);
    await q.query(`ALTER TABLE listings.listings DROP CONSTRAINT serial_both_or_none, DROP CONSTRAINT serial_last4_form, DROP COLUMN serial_hmac, DROP COLUMN serial_last4`);
  }
}
