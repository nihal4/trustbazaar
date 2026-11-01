import { MigrationInterface, QueryRunner } from 'typeorm';

// Unit 3, U3-02: the changes to docs/design/sql/03_listings_auctions.sql made after its first migration
// (Decisions log, 2026-11-01). The design file holds the result; this migration brings a database migrated
// before them to the same schema. Runs as tb_owner (SEC-INF-03).
//   I-23: no courier option for an item over 10 kg or an oversize item (Unit 4 DV-24, DV-25).
//   Photo positions are unique among the photos shown, so a removed photo's position can be used again.
//   listings.stock_moves: one stock outcome per order, so redelivered order events never move stock twice.
export class ListingsCourierPhotosStock1793491200009 implements MigrationInterface {
  name = 'ListingsCourierPhotosStock1793491200009';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(SQL);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DROP TABLE listings.stock_moves;
      DROP INDEX listings.listing_photos_live_position;
      ALTER TABLE listings.listing_photos ADD CONSTRAINT listing_photos_listing_id_position_key UNIQUE (listing_id, position);
      ALTER TABLE listings.listings DROP CONSTRAINT courier_parcel_fits;`);
  }
}

const SQL = String.raw`
ALTER TABLE listings.listings ADD CONSTRAINT courier_parcel_fits CHECK (fulfilment_options IS NULL OR fulfilment_options = 'pickup_only'
                                        OR (weight_class <> 'over_10kg' AND size_class <> 'oversize'));

ALTER TABLE listings.listing_photos DROP CONSTRAINT listing_photos_listing_id_position_key;
CREATE UNIQUE INDEX listing_photos_live_position ON listings.listing_photos (listing_id, position) WHERE removed_at IS NULL;

CREATE TABLE listings.stock_moves (
  order_id    uuid PRIMARY KEY,
  kind        varchar(10) NOT NULL CHECK (kind IN ('sold', 'released')),
  listing_id  uuid NOT NULL REFERENCES listings.listings(id),
  quantity    integer NOT NULL CHECK (quantity >= 1),
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stock_moves_listing ON listings.stock_moves (listing_id);
CREATE TRIGGER stock_moves_append_only BEFORE UPDATE OR DELETE ON listings.stock_moves
  FOR EACH ROW EXECUTE FUNCTION identity.forbid_change();
GRANT SELECT, INSERT ON listings.stock_moves TO tb_app;
`;
