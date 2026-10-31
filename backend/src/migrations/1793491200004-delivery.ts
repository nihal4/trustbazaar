import { MigrationInterface, QueryRunner } from 'typeorm';

// Unit 4: a frozen copy of docs/design/sql/04_delivery.sql as of this migration (I-60, NFR-MNT-04).
// Never edit an applied migration: a later change to the design file comes as a new migration.
// Runs as tb_owner (SEC-INF-03). down() drops the schemas delivery; extensions and roles stay.
export class Delivery1793491200004 implements MigrationInterface {
  name = 'Delivery1793491200004';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(SQL);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query('DROP SCHEMA IF EXISTS delivery CASCADE');
  }
}

const SQL = String.raw`-- =====================================================================
-- TrustBazaar - Unit 4: Delivery & Handover - PostgreSQL 15 schema
-- Design document: docs/design/04_delivery.pdf
-- Requirements: SRS v2.0 FR-DLV-01..14; FR-PAY-08 (fulfilment side); FR-DSP-05 and
--   FR-DSP-06(d) (delivery records, return shipments); SEC-PAY-03/04/07 (courier
--   webhooks); FR-PRV-01, NFR-CMP-05, DR-06.
-- Depends on: 01_identity_access.sql (identity.users, identity.staff_accounts,
--   identity.forbid_change), 02_orders_payments.sql (orders.orders),
--   03_listings_auctions.sql (listings.listings, listing enums, listings.distance_km).
-- Conventions DC-1..DC-14. Foreign keys only to earlier units (DC-5). No function here
-- reads another unit's tables (DC-1): order and listing facts arrive as arguments,
-- obtained through Unit 2 and Unit 3 ports.
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS delivery;

-- ---------------------------------------------------------------- types
CREATE TYPE delivery.zone            AS ENUM ('inside_dhaka', 'dhaka_suburbs', 'outside_dhaka');   -- CP-43
CREATE TYPE delivery.point_kind      AS ENUM ('police_station', 'shopping_mall', 'bank_branch', 'other_public');
CREATE TYPE delivery.handover_status AS ENUM ('arranging', 'agreed', 'completed', 'locked', 'cancelled');
CREATE TYPE delivery.proposal_status AS ENUM ('proposed', 'accepted', 'declined', 'withdrawn', 'superseded', 'lapsed');
CREATE TYPE delivery.quote_purpose   AS ENUM ('checkout', 'return');
CREATE TYPE delivery.provider        AS ENUM ('mock', 'pathao', 'steadfast');                       -- IF-SW-04
CREATE TYPE delivery.direction       AS ENUM ('forward', 'return');                                 -- return: FR-DSP-06(d)
CREATE TYPE delivery.shipment_status AS ENUM
  ('preparing',                                   -- waiting for the seller's pickup address or the booking call
   'booked', 'picked_up', 'in_transit', 'delivered', 'delivery_failed', 'returned_to_seller',  -- FR-DLV-10
   'cancelled');                                  -- booking withdrawn before pickup
CREATE TYPE delivery.status_source   AS ENUM ('provider_webhook', 'provider_query', 'system', 'operator');
CREATE TYPE delivery.address_kind    AS ENUM ('pickup', 'dropoff');
CREATE TYPE delivery.issue_kind      AS ENUM
  ('booking_failed', 'pickup_after_cancel', 'status_refused', 'code_locked', 'return_failed');
CREATE TYPE delivery.issue_status    AS ENUM ('open', 'resolved');

-- =====================================================================
-- Areas and zones (FR-DLV-08, CP-43). Curated reference data maintained by an
-- administrator. Buyers choose a drop-off area from this list; the zone of a
-- seller's listing location is that of the nearest area in the same district.
-- =====================================================================
CREATE TABLE delivery.areas (
  id        integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  district  varchar(40) NOT NULL,
  name_en   varchar(80) NOT NULL,
  name_bn   varchar(80) NOT NULL,
  zone      delivery.zone NOT NULL,
  lat       numeric(6,3) NOT NULL CHECK (lat BETWEEN 20.0 AND 27.0),     -- centroid, rounded (~110 m)
  lng       numeric(6,3) NOT NULL CHECK (lng BETWEEN 88.0 AND 93.0),
  active    boolean NOT NULL DEFAULT true,
  UNIQUE (district, name_en)
);
CREATE INDEX areas_district ON delivery.areas (lower(district)) WHERE active;

-- zone of the route: both ends inside Dhaka -> inside; both within Dhaka or its suburbs -> suburbs; else outside
CREATE FUNCTION delivery.route_zone(a delivery.zone, b delivery.zone) RETURNS delivery.zone
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN a = 'inside_dhaka' AND b = 'inside_dhaka' THEN 'inside_dhaka'::delivery.zone
    WHEN a <> 'outside_dhaka' AND b <> 'outside_dhaka' THEN 'dhaka_suburbs'::delivery.zone
    ELSE 'outside_dhaka'::delivery.zone END
$$;

-- zone of a point given only its district and rounded coordinates (a listing location)
CREATE FUNCTION delivery.zone_at(p_district varchar, p_lat numeric, p_lng numeric) RETURNS delivery.zone
LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    (SELECT a.zone FROM delivery.areas a
      WHERE a.active AND lower(a.district) = lower(p_district)
      ORDER BY listings.distance_km(a.lat, a.lng, p_lat, p_lng), a.id LIMIT 1),
    'outside_dhaka'::delivery.zone)
$$;

-- =====================================================================
-- Fare table (FR-DLV-08, CP-43). Versioned and append-only; a quote records the version.
-- Fare for billed weight w kg: w <= 1 -> up_to_1kg; w <= 2 -> up_to_2kg;
-- else up_to_2kg + (w - 2) * per_extra_kg. Amounts in poisha.
-- =====================================================================
CREATE TABLE delivery.fare_tables (
  version         integer PRIMARY KEY CHECK (version >= 1),
  effective_from  timestamptz NOT NULL,
  source          text NOT NULL CHECK (length(btrim(source)) >= 10),   -- which published rate cards (R14)
  created_by      uuid REFERENCES identity.staff_accounts(id),         -- NULL only for the seeded version 1
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fare_version_has_creator CHECK (version = 1 OR created_by IS NOT NULL)
);
CREATE TABLE delivery.fare_rows (
  version       integer NOT NULL REFERENCES delivery.fare_tables(version),
  zone          delivery.zone NOT NULL,
  up_to_1kg     bigint NOT NULL CHECK (up_to_1kg > 0),
  up_to_2kg     bigint NOT NULL,
  per_extra_kg  bigint NOT NULL CHECK (per_extra_kg >= 0),
  PRIMARY KEY (version, zone),
  CONSTRAINT fare_rises_with_weight CHECK (up_to_2kg >= up_to_1kg)
);
CREATE TRIGGER fare_tables_append_only BEFORE UPDATE OR DELETE ON delivery.fare_tables
  FOR EACH ROW EXECUTE FUNCTION identity.forbid_change();
CREATE TRIGGER fare_rows_append_only BEFORE UPDATE OR DELETE ON delivery.fare_rows
  FOR EACH ROW EXECUTE FUNCTION identity.forbid_change();

-- the version in force at a time; a version is usable only once it has all three zones
CREATE FUNCTION delivery.fare_version_at(p_at timestamptz) RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT max(t.version) FROM delivery.fare_tables t
   WHERE t.effective_from <= p_at
     AND (SELECT count(*) FROM delivery.fare_rows r WHERE r.version = t.version) = 3
$$;

CREATE FUNCTION delivery.fare(p_version integer, p_zone delivery.zone, p_kg integer) RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN p_kg <= 1 THEN r.up_to_1kg
              WHEN p_kg <= 2 THEN r.up_to_2kg
              ELSE r.up_to_2kg + (p_kg - 2) * r.per_extra_kg END
    FROM delivery.fare_rows r WHERE r.version = p_version AND r.zone = p_zone
$$;

-- billed weight in whole kg: each unit counts as the larger of its weight-class bound
-- and the volumetric minimum of its size class (DV-25); NULL means "not by courier" (DV-24)
CREATE FUNCTION delivery.billed_kg(p_weight listings.weight_class, p_size listings.size_class,
                                   p_quantity integer, p_max_kg integer) RETURNS integer
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN w IS NULL OR s IS NULL OR greatest(w, s) * p_quantity > p_max_kg THEN NULL
              ELSE greatest(w, s) * p_quantity END
  FROM (SELECT CASE p_weight WHEN 'up_to_1kg' THEN 1 WHEN 'up_to_2kg' THEN 2 WHEN 'up_to_5kg' THEN 5
                             WHEN 'up_to_10kg' THEN 10 ELSE NULL END AS w,
               CASE p_size   WHEN 'small' THEN 0 WHEN 'medium' THEN 2 WHEN 'large' THEN 5
                             ELSE NULL END AS s) k
$$;

-- recommendation of FR-DLV-02: self-pickup at or below CP-14 if allowed, otherwise courier if allowed
CREATE FUNCTION delivery.recommended_method(p_options listings.fulfilment_options, p_distance_km numeric,
                                            p_threshold_km numeric) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_options
    WHEN 'pickup_only'  THEN 'self_pickup'
    WHEN 'courier_only' THEN 'courier'
    ELSE CASE WHEN p_distance_km <= p_threshold_km THEN 'self_pickup' ELSE 'courier' END END
$$;

-- =====================================================================
-- Saved addresses (FR-DLV-07). Exact addresses are Confidential: the street lines and the
-- contact name are encrypted by the application with FIELD_KEY (AES-256-GCM, associated
-- data = table, column and row id, Unit 1 Section 3). Only the area is in clear.
-- =====================================================================
CREATE TABLE delivery.saved_addresses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES identity.users(id),
  kind          delivery.address_kind NOT NULL,
  label         varchar(40) NOT NULL,
  area_id       integer NOT NULL REFERENCES delivery.areas(id),
  address_enc   bytea CHECK (octet_length(address_enc) >= 30),     -- version byte, IV, ciphertext, tag
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  CONSTRAINT saved_address_erased CHECK ((deleted_at IS NULL) = (address_enc IS NOT NULL))
);
CREATE INDEX saved_addresses_user ON delivery.saved_addresses (user_id, kind) WHERE deleted_at IS NULL;

-- =====================================================================
-- Quotes (FR-DLV-08, FR-DLV-09). Bound to buyer, listing and quantity; valid for DV-23;
-- claimed once, by one order (Unit 2 calls DeliveryPort.claimQuote at order creation).
-- =====================================================================
CREATE TABLE delivery.quotes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose         delivery.quote_purpose NOT NULL,
  buyer_id        uuid NOT NULL REFERENCES identity.users(id),
  listing_id      uuid NOT NULL REFERENCES listings.listings(id),
  quantity        integer NOT NULL CHECK (quantity >= 1),
  fare_version    integer NOT NULL REFERENCES delivery.fare_tables(version),
  from_zone       delivery.zone NOT NULL,
  to_area_id      integer NOT NULL REFERENCES delivery.areas(id),
  dropoff_address_id uuid REFERENCES delivery.saved_addresses(id),  -- the buyer's address (checkout quotes)
  zone            delivery.zone NOT NULL,
  billed_kg       integer NOT NULL CHECK (billed_kg BETWEEN 1 AND 100),
  distance_km     numeric(6,1) NOT NULL CHECK (distance_km >= 0),
  fee             bigint NOT NULL CHECK (fee > 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  order_id        uuid REFERENCES orders.orders(id),                 -- set once, when claimed
  claimed_at      timestamptz,
  CONSTRAINT quote_one_per_order UNIQUE (order_id, purpose),
  CONSTRAINT quote_expiry_after_creation CHECK (expires_at > created_at),
  CONSTRAINT checkout_quote_has_address CHECK (purpose <> 'checkout' OR dropoff_address_id IS NOT NULL),
  CONSTRAINT quote_claim_fields CHECK ((order_id IS NULL) = (claimed_at IS NULL))
);
CREATE INDEX quotes_buyer ON delivery.quotes (buyer_id, created_at DESC);

CREATE FUNCTION delivery.quote_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW.purpose, NEW.buyer_id, NEW.listing_id, NEW.quantity, NEW.fare_version, NEW.zone,
      NEW.to_area_id, NEW.dropoff_address_id, NEW.billed_kg, NEW.fee, NEW.created_at, NEW.expires_at)
     IS DISTINCT FROM
     (OLD.id, OLD.purpose, OLD.buyer_id, OLD.listing_id, OLD.quantity, OLD.fare_version, OLD.zone,
      OLD.to_area_id, OLD.dropoff_address_id, OLD.billed_kg, OLD.fee, OLD.created_at, OLD.expires_at) THEN
    RAISE EXCEPTION 'a quote is fixed once issued' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.order_id IS NOT NULL AND NEW.order_id IS DISTINCT FROM OLD.order_id THEN
    RAISE EXCEPTION 'a quote is claimed only once' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER quote_guard BEFORE UPDATE ON delivery.quotes FOR EACH ROW EXECUTE FUNCTION delivery.quote_guard();

-- issue a quote. Listing facts (classes, district, rounded coordinates, fulfilment options)
-- come from Unit 3's ListingsQueries port; parameters from ConfigPort.
CREATE FUNCTION delivery.make_quote(
    p_purpose delivery.quote_purpose, p_buyer uuid, p_listing uuid, p_quantity integer,
    p_options listings.fulfilment_options, p_weight listings.weight_class, p_size listings.size_class,
    p_from_district varchar, p_from_lat numeric, p_from_lng numeric,
    p_to_area integer, p_validity interval, p_max_kg integer, p_address uuid DEFAULT NULL)
RETURNS delivery.quotes LANGUAGE plpgsql AS $$
DECLARE
  a delivery.areas; v integer; kg integer; z delivery.zone; fz delivery.zone; q delivery.quotes;
BEGIN
  IF p_purpose = 'checkout' AND p_options IS DISTINCT FROM 'courier_only' AND p_options IS DISTINCT FROM 'pickup_or_courier' THEN
    RAISE EXCEPTION 'the seller does not offer courier for this listing' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO a FROM delivery.areas WHERE id = p_to_area AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown drop-off area' USING ERRCODE = 'check_violation'; END IF;
  IF p_address IS NOT NULL AND NOT EXISTS (SELECT 1 FROM delivery.saved_addresses
       WHERE id = p_address AND user_id = p_buyer AND kind = 'dropoff' AND deleted_at IS NULL AND area_id = p_to_area) THEN
    RAISE EXCEPTION 'drop-off address must be the buyer''s own, in the quoted area' USING ERRCODE = 'check_violation';
  END IF;
  kg := delivery.billed_kg(p_weight, p_size, p_quantity, p_max_kg);
  IF kg IS NULL THEN
    RAISE EXCEPTION 'parcel too heavy or too large for courier' USING ERRCODE = 'check_violation';
  END IF;
  v := delivery.fare_version_at(now());
  IF v IS NULL THEN RAISE EXCEPTION 'no fare table in force' USING ERRCODE = 'check_violation'; END IF;
  fz := delivery.zone_at(p_from_district, p_from_lat, p_from_lng);
  z  := delivery.route_zone(fz, a.zone);
  INSERT INTO delivery.quotes (purpose, buyer_id, listing_id, quantity, fare_version, from_zone, to_area_id,
                               dropoff_address_id, zone, billed_kg, distance_km, fee, expires_at)
  VALUES (p_purpose, p_buyer, p_listing, p_quantity, v, fz, a.id, p_address, z, kg,
          round(listings.distance_km(p_from_lat, p_from_lng, a.lat, a.lng)::numeric, 1),
          delivery.fare(v, z, kg), now() + p_validity)
  RETURNING * INTO q;
  RETURN q;
END $$;

-- claim at order creation, inside Unit 2's transaction (DC-13); returns the fee to store on the order
-- (a return quote is claimed the same way when Disputes books the return, with purpose 'return')
CREATE FUNCTION delivery.claim_quote(p_quote uuid, p_order uuid, p_buyer uuid, p_listing uuid, p_quantity integer,
                                     p_purpose delivery.quote_purpose DEFAULT 'checkout')
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE q delivery.quotes;
BEGIN
  SELECT * INTO q FROM delivery.quotes WHERE id = p_quote FOR UPDATE;
  IF NOT FOUND OR q.purpose <> p_purpose OR q.buyer_id <> p_buyer OR q.listing_id <> p_listing OR q.quantity <> p_quantity THEN
    RAISE EXCEPTION 'quote does not match this order' USING ERRCODE = 'check_violation';
  END IF;
  IF q.order_id IS NOT NULL THEN RAISE EXCEPTION 'quote already used' USING ERRCODE = 'check_violation'; END IF;
  IF now() >= q.expires_at THEN RAISE EXCEPTION 'quote expired' USING ERRCODE = 'check_violation'; END IF;
  UPDATE delivery.quotes SET order_id = p_order, claimed_at = now() WHERE id = p_quote;
  RETURN q.fee;
END $$;

-- =====================================================================
-- Safe meetup points (FR-DLV-03). Public places, so their exact location is shown.
-- =====================================================================
CREATE TABLE delivery.meetup_points (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        delivery.point_kind NOT NULL,
  name_en     varchar(120) NOT NULL,
  name_bn     varchar(120) NOT NULL,
  district    varchar(40)  NOT NULL,
  lat         numeric(8,5) NOT NULL CHECK (lat BETWEEN 20.0 AND 27.0),
  lng         numeric(8,5) NOT NULL CHECK (lng BETWEEN 88.0 AND 93.0),
  guidance    varchar(300),                          -- e.g. "main gate, inside the guarded forecourt"
  active      boolean NOT NULL DEFAULT true,
  added_by    uuid NOT NULL REFERENCES identity.staff_accounts(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX meetup_points_geo ON delivery.meetup_points (lat, lng) WHERE active;

-- nearest active points to the midpoint of the two parties' locations (DV-27). Each location is
-- first snapped to a coarse grid (p_grid degrees), because a party who knows their own location
-- and the midpoint could otherwise work out the other's (other = 2 x midpoint - own). The
-- arithmetic mean of coordinates is accurate to well under 1 km at meetup distances. The
-- distance column is for ordering only and is not returned by the API.
CREATE FUNCTION delivery.suggest_points(lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric, n integer, p_grid numeric)
RETURNS TABLE (point_id uuid, name_en varchar, kind delivery.point_kind, km_from_midpoint numeric)
LANGUAGE sql STABLE AS $$
  WITH m AS (SELECT (round(lat1 / p_grid) + round(lat2 / p_grid)) * p_grid / 2 AS lat,
                    (round(lng1 / p_grid) + round(lng2 / p_grid)) * p_grid / 2 AS lng)
  SELECT p.id, p.name_en, p.kind, round(listings.distance_km(p.lat, p.lng, m.lat, m.lng)::numeric, 1)
    FROM delivery.meetup_points p, m
   WHERE p.active
   ORDER BY listings.distance_km(p.lat, p.lng, m.lat, m.lng), p.id
   LIMIT n
$$;

-- =====================================================================
-- Meetup handover (FR-DLV-04 to FR-DLV-06). One row per self-pickup order, created when
-- Unit 2 reports the order paid. The handover code is never stored: it is derived as
-- HMAC-SHA-256(HANDOVER_KEY, order_id || ':' || code_version), reduced to 6 digits (DV-28).
-- =====================================================================
CREATE TABLE delivery.handovers (
  order_id            uuid PRIMARY KEY REFERENCES orders.orders(id),
  buyer_id            uuid NOT NULL REFERENCES identity.users(id),
  seller_id           uuid NOT NULL REFERENCES identity.users(id),
  status              delivery.handover_status NOT NULL DEFAULT 'arranging',
  due_at              timestamptz NOT NULL,                  -- the order's fulfilment deadline (CP-15)
  code_version        smallint NOT NULL DEFAULT 1 CHECK (code_version >= 1),
  wrong_entries       smallint NOT NULL DEFAULT 0 CHECK (wrong_entries BETWEEN 0 AND 10),
  agreed_proposal_id  uuid,                                  -- FK added below
  locked_at           timestamptz,
  completed_at        timestamptz,
  cancelled_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT handover_parties CHECK (buyer_id <> seller_id),
  CONSTRAINT handover_completed_fields CHECK ((status = 'completed') = (completed_at IS NOT NULL)),
  CONSTRAINT handover_locked_fields    CHECK ((status = 'locked')    = (locked_at IS NOT NULL)),
  CONSTRAINT handover_cancelled_fields CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
  CONSTRAINT handover_agreed_has_proposal CHECK (status <> 'agreed' OR agreed_proposal_id IS NOT NULL)
);

CREATE FUNCTION delivery.handover_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'arranging' OR NEW.wrong_entries <> 0 OR NEW.code_version <> 1 THEN
      RAISE EXCEPTION 'a handover starts as arranging' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.order_id, NEW.buyer_id, NEW.seller_id, NEW.due_at) IS DISTINCT FROM (OLD.order_id, OLD.buyer_id, OLD.seller_id, OLD.due_at) THEN
    RAISE EXCEPTION 'handover parties and deadline are fixed' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'handover is closed' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT ((OLD.status, NEW.status) IN (
       ('arranging'::delivery.handover_status, 'agreed'::delivery.handover_status),
       ('arranging', 'completed'), ('arranging', 'locked'), ('arranging', 'cancelled'),
       ('agreed', 'completed'), ('agreed', 'locked'), ('agreed', 'cancelled'),
       ('locked', 'arranging'), ('locked', 'agreed'), ('locked', 'cancelled'))) THEN
    RAISE EXCEPTION 'handover % -> % is not permitted', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  -- the counter only rises, except when an operator resets a locked code, which issues a new code
  IF OLD.status = 'locked' AND NEW.status IN ('arranging', 'agreed') THEN
    IF NEW.code_version <> OLD.code_version + 1 OR NEW.wrong_entries <> 0 THEN
      RAISE EXCEPTION 'unlocking issues a new code and resets the counter' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.code_version <> OLD.code_version OR NEW.wrong_entries < OLD.wrong_entries THEN
    RAISE EXCEPTION 'the code and its wrong-entry count change only by an unlock' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER handover_guard BEFORE INSERT OR UPDATE ON delivery.handovers
  FOR EACH ROW EXECUTE FUNCTION delivery.handover_guard();

CREATE TABLE delivery.meetup_proposals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      uuid NOT NULL REFERENCES delivery.handovers(order_id),
  proposed_by   uuid NOT NULL REFERENCES identity.users(id),
  point_id      uuid NOT NULL REFERENCES delivery.meetup_points(id),
  meet_at       timestamptz NOT NULL,
  note          varchar(200),
  status        delivery.proposal_status NOT NULL DEFAULT 'proposed',
  created_at    timestamptz NOT NULL DEFAULT now(),
  responded_at  timestamptz,
  CONSTRAINT proposal_response_time CHECK ((status = 'proposed') = (responded_at IS NULL))
);
CREATE UNIQUE INDEX proposal_one_open ON delivery.meetup_proposals (order_id) WHERE status = 'proposed';
CREATE INDEX proposal_order ON delivery.meetup_proposals (order_id, created_at);
ALTER TABLE delivery.handovers ADD CONSTRAINT handover_agreed_fk
  FOREIGN KEY (agreed_proposal_id) REFERENCES delivery.meetup_proposals(id);

CREATE FUNCTION delivery.proposal_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'proposed' THEN RAISE EXCEPTION 'a proposal starts as proposed' USING ERRCODE = 'check_violation'; END IF;
    RETURN NEW;
  END IF;
  IF (NEW.order_id, NEW.proposed_by, NEW.point_id, NEW.meet_at, NEW.note, NEW.created_at)
     IS DISTINCT FROM (OLD.order_id, OLD.proposed_by, OLD.point_id, OLD.meet_at, OLD.note, OLD.created_at) THEN
    RAISE EXCEPTION 'a proposal cannot be edited; make a new one' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT ((OLD.status, NEW.status) IN (
       ('proposed'::delivery.proposal_status, 'accepted'::delivery.proposal_status),
       ('proposed', 'declined'), ('proposed', 'withdrawn'), ('proposed', 'superseded'), ('proposed', 'lapsed'),
       ('accepted', 'superseded'))) THEN
    RAISE EXCEPTION 'proposal % -> % is not permitted', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER proposal_guard BEFORE INSERT OR UPDATE ON delivery.meetup_proposals
  FOR EACH ROW EXECUTE FUNCTION delivery.proposal_guard();

-- every code entry, right or wrong (DR-06); append-only
CREATE TABLE delivery.code_entries (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id      uuid NOT NULL REFERENCES delivery.handovers(order_id),
  seller_id     uuid NOT NULL REFERENCES identity.users(id),
  code_version  smallint NOT NULL,
  correct       boolean NOT NULL,
  at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX code_entries_order ON delivery.code_entries (order_id, id);
CREATE TRIGGER code_entries_append_only BEFORE UPDATE OR DELETE ON delivery.code_entries
  FOR EACH ROW EXECUTE FUNCTION identity.forbid_change();

-- =====================================================================
-- Courier shipments (FR-DLV-10 to FR-DLV-14). One forward shipment per courier order and
-- at most one return shipment (dispute outcome (d), FR-DSP-06).
-- =====================================================================
CREATE TABLE delivery.shipments (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id             uuid NOT NULL REFERENCES orders.orders(id),
  direction            delivery.direction NOT NULL,
  provider             delivery.provider NOT NULL,
  simulated            boolean NOT NULL,                                -- FR-DLV-14, NFR-CMP-05
  quote_id             uuid NOT NULL REFERENCES delivery.quotes(id),
  fee                  bigint NOT NULL CHECK (fee > 0),
  status               delivery.shipment_status NOT NULL DEFAULT 'preparing',
  pickup_due_at        timestamptz,                                     -- forward: the order's CP-16 deadline
  consignment_id       varchar(64),
  pickup_area_id       integer REFERENCES delivery.areas(id),
  dropoff_area_id      integer NOT NULL REFERENCES delivery.areas(id),
  pickup_address_enc   bytea CHECK (octet_length(pickup_address_enc) >= 30),
  dropoff_address_enc  bytea CHECK (octet_length(dropoff_address_enc) >= 30),
  addresses_erased_at  timestamptz,                                     -- DV-30
  booking_attempts     smallint NOT NULL DEFAULT 0 CHECK (booking_attempts >= 0),
  next_booking_at      timestamptz,
  booked_at            timestamptz,
  picked_up_at         timestamptz,
  delivered_at         timestamptz,
  failed_attempts      smallint NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  returned_at          timestamptz,
  return_charge        bigint CHECK (return_charge >= 0),
  cancelled_at         timestamptz,
  order_cancelled_at   timestamptz,                                     -- set from Unit 2's cancellation event
  last_source          delivery.status_source NOT NULL DEFAULT 'system',
  last_event_id        varchar(100),
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shipment_one_per_direction UNIQUE (order_id, direction),
  CONSTRAINT shipment_simulated_iff_mock CHECK (simulated = (provider = 'mock')),
  CONSTRAINT shipment_forward_has_deadline CHECK ((direction = 'forward') = (pickup_due_at IS NOT NULL)),
  CONSTRAINT shipment_booked_fields CHECK (status IN ('preparing', 'cancelled')
         OR (consignment_id IS NOT NULL AND booked_at IS NOT NULL)),
  CONSTRAINT shipment_pickup_fields CHECK ((status IN ('picked_up', 'in_transit', 'delivered', 'delivery_failed', 'returned_to_seller'))
         = (picked_up_at IS NOT NULL)),
  CONSTRAINT shipment_delivered_fields CHECK ((status = 'delivered') = (delivered_at IS NOT NULL)),
  CONSTRAINT shipment_returned_fields CHECK ((status = 'returned_to_seller') = (returned_at IS NOT NULL)),
  CONSTRAINT shipment_charge_only_on_return CHECK (return_charge IS NULL OR status = 'returned_to_seller'),
  CONSTRAINT shipment_cancelled_fields CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
  CONSTRAINT shipment_time_order CHECK (picked_up_at IS NULL OR picked_up_at >= booked_at),
  -- once booked, the provider has both addresses; afterwards they are kept only until DV-30
  CONSTRAINT shipment_addresses CHECK (
         CASE WHEN addresses_erased_at IS NOT NULL THEN pickup_address_enc IS NULL AND dropoff_address_enc IS NULL
              WHEN status = 'preparing' THEN dropoff_address_enc IS NOT NULL
              ELSE pickup_address_enc IS NOT NULL AND dropoff_address_enc IS NOT NULL AND pickup_area_id IS NOT NULL END),
  CONSTRAINT shipment_erase_only_when_final CHECK (addresses_erased_at IS NULL
         OR status IN ('delivered', 'returned_to_seller', 'cancelled'))
);
CREATE UNIQUE INDEX shipments_consignment ON delivery.shipments (provider, consignment_id) WHERE consignment_id IS NOT NULL;
CREATE INDEX shipments_booking_due ON delivery.shipments (next_booking_at) WHERE status = 'preparing';
CREATE INDEX shipments_in_flight ON delivery.shipments (picked_up_at) WHERE status IN ('picked_up', 'in_transit', 'delivery_failed');

CREATE FUNCTION delivery.shipment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE q delivery.quotes;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'preparing' THEN RAISE EXCEPTION 'a shipment starts as preparing' USING ERRCODE = 'check_violation'; END IF;
    SELECT * INTO q FROM delivery.quotes WHERE id = NEW.quote_id;
    IF q.fee <> NEW.fee OR q.order_id IS DISTINCT FROM NEW.order_id
       OR (q.purpose = 'checkout') <> (NEW.direction = 'forward') THEN
      RAISE EXCEPTION 'shipment must use its own claimed quote and fee' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.dropoff_area_id <> q.to_area_id THEN
      RAISE EXCEPTION 'drop-off area differs from the quoted area' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.order_id, NEW.direction, NEW.provider, NEW.simulated, NEW.quote_id, NEW.fee, NEW.pickup_due_at, NEW.dropoff_area_id)
     IS DISTINCT FROM (OLD.order_id, OLD.direction, OLD.provider, OLD.simulated, OLD.quote_id, OLD.fee, OLD.pickup_due_at, OLD.dropoff_area_id) THEN
    RAISE EXCEPTION 'shipment identity, quote and fee are fixed' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.consignment_id IS NOT NULL AND NEW.consignment_id IS DISTINCT FROM OLD.consignment_id THEN
    RAISE EXCEPTION 'consignment id is fixed once booked' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'preparing' AND (NEW.pickup_area_id IS DISTINCT FROM OLD.pickup_area_id
       OR (NEW.addresses_erased_at IS NULL AND (NEW.pickup_address_enc IS DISTINCT FROM OLD.pickup_address_enc
                                                OR NEW.dropoff_address_enc IS DISTINCT FROM OLD.dropoff_address_enc))) THEN
    RAISE EXCEPTION 'addresses are fixed once booked' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('delivered', 'returned_to_seller', 'cancelled') AND NEW.status = OLD.status THEN
    -- a final shipment may only have its addresses erased
    IF (NEW.delivered_at, NEW.returned_at, NEW.return_charge, NEW.cancelled_at, NEW.picked_up_at, NEW.failed_attempts)
       IS DISTINCT FROM (OLD.delivered_at, OLD.returned_at, OLD.return_charge, OLD.cancelled_at, OLD.picked_up_at, OLD.failed_attempts) THEN
      RAISE EXCEPTION 'shipment is final' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT ((OLD.status, NEW.status) IN (
       ('preparing'::delivery.shipment_status, 'booked'::delivery.shipment_status), ('preparing', 'cancelled'),
       ('booked', 'picked_up'), ('booked', 'cancelled'),
       ('picked_up', 'in_transit'), ('picked_up', 'delivered'), ('picked_up', 'delivery_failed'), ('picked_up', 'returned_to_seller'),
       ('in_transit', 'delivered'), ('in_transit', 'delivery_failed'), ('in_transit', 'returned_to_seller'),
       ('delivery_failed', 'in_transit'), ('delivery_failed', 'delivered'), ('delivery_failed', 'returned_to_seller'))) THEN
    RAISE EXCEPTION 'shipment % -> % is not permitted', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  -- delivery and return move money: they are accepted only after a status query to the provider
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('delivered', 'returned_to_seller')
     AND NEW.last_source NOT IN ('provider_query') THEN
    RAISE EXCEPTION 'delivered and returned need confirmation by a provider status query' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER shipment_guard BEFORE INSERT OR UPDATE ON delivery.shipments
  FOR EACH ROW EXECUTE FUNCTION delivery.shipment_guard();

CREATE TABLE delivery.shipment_history (                                       -- DR-06, append-only
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shipment_id   uuid NOT NULL REFERENCES delivery.shipments(id),
  from_status   delivery.shipment_status,
  to_status     delivery.shipment_status NOT NULL,
  source        delivery.status_source NOT NULL,
  event_id      varchar(100),
  at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX shipment_history_shipment ON delivery.shipment_history (shipment_id, id);
CREATE TRIGGER shipment_history_append_only BEFORE UPDATE OR DELETE ON delivery.shipment_history
  FOR EACH ROW EXECUTE FUNCTION identity.forbid_change();

CREATE FUNCTION delivery.shipment_log() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO delivery.shipment_history (shipment_id, from_status, to_status, source, event_id)
    VALUES (NEW.id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END, NEW.status, NEW.last_source, NEW.last_event_id);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER shipment_log AFTER INSERT OR UPDATE ON delivery.shipments
  FOR EACH ROW EXECUTE FUNCTION delivery.shipment_log();

-- courier webhook and query events, for idempotency (SEC-PAY-04); kept for CP-32, then deleted
CREATE TABLE delivery.provider_events (
  provider        delivery.provider NOT NULL,
  event_id        varchar(100) NOT NULL,
  consignment_id  varchar(64),
  reported_status delivery.shipment_status,
  occurred_at     timestamptz,
  outcome         varchar(20),
  received_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, event_id)
);
CREATE INDEX provider_events_age ON delivery.provider_events (received_at);

CREATE TABLE delivery.issues (                                                 -- operator queue (Unit 7)
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      uuid NOT NULL REFERENCES orders.orders(id),
  kind          delivery.issue_kind NOT NULL,
  detail        jsonb NOT NULL DEFAULT '{}',
  status        delivery.issue_status NOT NULL DEFAULT 'open',
  created_at    timestamptz NOT NULL DEFAULT now(),
  resolved_by   uuid REFERENCES identity.staff_accounts(id),
  resolved_at   timestamptz,
  resolution    text,
  CONSTRAINT issue_resolution CHECK ((status = 'resolved') = (resolved_at IS NOT NULL AND resolved_by IS NOT NULL
                                     AND length(btrim(coalesce(resolution, ''))) >= 10))
);
CREATE INDEX issues_open ON delivery.issues (created_at) WHERE status = 'open';
CREATE UNIQUE INDEX issues_one_open_per_kind ON delivery.issues (order_id, kind) WHERE status = 'open';

CREATE TABLE delivery.outbox (                                                 -- DC-6
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_type      varchar(80) NOT NULL CHECK (event_type ~ '^delivery\.[a-z_]+\.[a-z_]+$'),
  aggregate_id    uuid NOT NULL,
  payload         jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  attempts        smallint NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  dispatched_at   timestamptz
);
CREATE INDEX delivery_outbox_pending ON delivery.outbox (next_attempt_at) WHERE dispatched_at IS NULL;

-- =====================================================================
-- Operations. Each locks the delivery row it changes; the caller has already locked the
-- order through OrdersPort.lockForFulfilment (lock order: listing, order, delivery row,
-- escrow, attempt - DC-14).
-- =====================================================================

-- FR-DLV-04: propose a meetup point and time. A new proposal replaces an open one.
CREATE FUNCTION delivery.propose_meetup(p_order uuid, p_user uuid, p_point uuid, p_meet_at timestamptz,
                                        p_note varchar, p_lead interval, p_buffer interval)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE h delivery.handovers; pid uuid;
BEGIN
  SELECT * INTO h FROM delivery.handovers WHERE order_id = p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no handover for this order' USING ERRCODE = 'check_violation'; END IF;
  IF p_user NOT IN (h.buyer_id, h.seller_id) THEN
    RAISE EXCEPTION 'only the buyer or the seller can propose' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF h.status NOT IN ('arranging', 'agreed') THEN
    RAISE EXCEPTION 'a meetup cannot be arranged now (%)', h.status USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM delivery.meetup_points WHERE id = p_point AND active) THEN
    RAISE EXCEPTION 'not an active meetup point' USING ERRCODE = 'check_violation';
  END IF;
  IF p_meet_at < now() + p_lead OR p_meet_at > h.due_at - p_buffer THEN
    RAISE EXCEPTION 'meetup time must be between % from now and % before the handover deadline', p_lead, p_buffer
      USING ERRCODE = 'check_violation';
  END IF;
  UPDATE delivery.meetup_proposals SET status = 'superseded', responded_at = now()
   WHERE order_id = p_order AND status = 'proposed';
  INSERT INTO delivery.meetup_proposals (order_id, proposed_by, point_id, meet_at, note)
  VALUES (p_order, p_user, p_point, p_meet_at, p_note) RETURNING id INTO pid;
  INSERT INTO delivery.outbox (event_type, aggregate_id, payload)
  VALUES ('delivery.meetup.proposed', p_order, jsonb_build_object('proposalId', pid, 'by', p_user, 'meetAt', p_meet_at));
  RETURN pid;
END $$;

-- FR-DLV-04: only the other party accepts or declines; returns the resulting status
CREATE FUNCTION delivery.respond_meetup(p_proposal uuid, p_user uuid, p_accept boolean)
RETURNS delivery.proposal_status LANGUAGE plpgsql AS $$
DECLARE h delivery.handovers; p delivery.meetup_proposals;
BEGIN
  SELECT h0.* INTO h FROM delivery.handovers h0
    JOIN delivery.meetup_proposals p0 ON p0.order_id = h0.order_id WHERE p0.id = p_proposal FOR UPDATE OF h0;
  IF NOT FOUND THEN RAISE EXCEPTION 'no such proposal' USING ERRCODE = 'check_violation'; END IF;
  SELECT * INTO p FROM delivery.meetup_proposals WHERE id = p_proposal FOR UPDATE;
  IF p_user NOT IN (h.buyer_id, h.seller_id) OR p_user = p.proposed_by THEN
    RAISE EXCEPTION 'only the other party can answer a proposal' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p.status <> 'proposed' THEN RAISE EXCEPTION 'proposal is no longer open' USING ERRCODE = 'check_violation'; END IF;
  IF h.status NOT IN ('arranging', 'agreed') THEN
    RAISE EXCEPTION 'a meetup cannot be arranged now (%)', h.status USING ERRCODE = 'check_violation';
  END IF;
  IF p.meet_at <= now() THEN
    UPDATE delivery.meetup_proposals SET status = 'lapsed', responded_at = now() WHERE id = p_proposal;
    RETURN 'lapsed';
  END IF;
  IF NOT p_accept THEN
    UPDATE delivery.meetup_proposals SET status = 'declined', responded_at = now() WHERE id = p_proposal;
    RETURN 'declined';
  END IF;
  UPDATE delivery.meetup_proposals SET status = 'superseded'
   WHERE order_id = p.order_id AND status = 'accepted';
  UPDATE delivery.meetup_proposals SET status = 'accepted', responded_at = now() WHERE id = p_proposal;
  UPDATE delivery.handovers SET status = 'agreed', agreed_proposal_id = p_proposal WHERE order_id = p.order_id;
  INSERT INTO delivery.outbox (event_type, aggregate_id, payload)
  VALUES ('delivery.meetup.agreed', p.order_id, jsonb_build_object('proposalId', p_proposal, 'pointId', p.point_id, 'meetAt', p.meet_at));
  RETURN 'accepted';
END $$;

-- FR-DLV-06: the seller enters the code; the service has compared it with the derived code in
-- constant time and passes the result. Returns 'accepted', 'wrong' or 'locked'.
CREATE FUNCTION delivery.record_code_entry(p_order uuid, p_seller uuid, p_correct boolean, p_max_wrong integer)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE h delivery.handovers;
BEGIN
  IF p_max_wrong NOT BETWEEN 3 AND 10 THEN
    RAISE EXCEPTION 'CP-45 must be between 3 and 10' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO h FROM delivery.handovers WHERE order_id = p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no handover for this order' USING ERRCODE = 'check_violation'; END IF;
  IF p_seller <> h.seller_id THEN
    RAISE EXCEPTION 'only the seller enters the handover code' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF h.status = 'locked' THEN RAISE EXCEPTION 'code entry is locked' USING ERRCODE = 'check_violation'; END IF;
  IF h.status NOT IN ('arranging', 'agreed') THEN
    RAISE EXCEPTION 'handover is closed' USING ERRCODE = 'check_violation';
  END IF;
  IF now() >= h.due_at THEN
    RAISE EXCEPTION 'the handover deadline has passed' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO delivery.code_entries (order_id, seller_id, code_version, correct)
  VALUES (p_order, p_seller, h.code_version, p_correct);
  IF p_correct THEN
    UPDATE delivery.handovers SET status = 'completed', completed_at = now() WHERE order_id = p_order;
    UPDATE delivery.meetup_proposals SET status = 'superseded', responded_at = now()
     WHERE order_id = p_order AND status = 'proposed';
    INSERT INTO delivery.outbox (event_type, aggregate_id, payload)
    VALUES ('delivery.handover.completed', p_order, jsonb_build_object('at', now()));
    RETURN 'accepted';
  END IF;
  IF h.wrong_entries + 1 >= p_max_wrong THEN
    UPDATE delivery.handovers SET wrong_entries = wrong_entries + 1, status = 'locked', locked_at = now()
     WHERE order_id = p_order;
    INSERT INTO delivery.issues (order_id, kind, detail)
    VALUES (p_order, 'code_locked', jsonb_build_object('wrongEntries', h.wrong_entries + 1))
    ON CONFLICT DO NOTHING;
    INSERT INTO delivery.outbox (event_type, aggregate_id, payload)
    VALUES ('delivery.handover.locked', p_order, jsonb_build_object('wrongEntries', h.wrong_entries + 1));
    RETURN 'locked';
  END IF;
  UPDATE delivery.handovers SET wrong_entries = wrong_entries + 1 WHERE order_id = p_order;
  RETURN 'wrong';
END $$;

-- operator unlock after speaking to both parties: a new code, counter reset (audited by the service)
CREATE FUNCTION delivery.unlock_code(p_order uuid) RETURNS smallint LANGUAGE plpgsql AS $$
DECLARE h delivery.handovers;
BEGIN
  SELECT * INTO h FROM delivery.handovers WHERE order_id = p_order FOR UPDATE;
  IF NOT FOUND OR h.status <> 'locked' THEN
    RAISE EXCEPTION 'handover is not locked' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE delivery.handovers
     SET status = CASE WHEN agreed_proposal_id IS NULL THEN 'arranging'::delivery.handover_status ELSE 'agreed' END,
         locked_at = NULL, wrong_entries = 0, code_version = code_version + 1
   WHERE order_id = p_order;
  RETURN h.code_version + 1;
END $$;

-- FR-DLV-10 to FR-DLV-12: apply a courier status. Duplicates and out-of-date reports have no
-- effect; a report that skips 'picked_up' implies it. The service acts on the flags returned
-- (EscrowCommands calls, return request after a cancelled order) in the same transaction.
CREATE FUNCTION delivery.apply_status(p_shipment uuid, p_status delivery.shipment_status, p_occurred timestamptz,
                                      p_source delivery.status_source, p_event_id varchar, p_return_charge bigint DEFAULT NULL)
RETURNS TABLE (outcome text, pickup_recorded boolean, pickup_on_time boolean, delivered boolean,
               returned boolean, after_cancel boolean)
LANGUAGE plpgsql AS $$
DECLARE
  s delivery.shipments; t timestamptz; n integer; cur delivery.shipment_status;
  implied boolean := false;
  rank_of CONSTANT jsonb := '{"preparing":0,"booked":1,"picked_up":2,"in_transit":3,"delivery_failed":3,
                              "delivered":4,"returned_to_seller":4,"cancelled":4}';
BEGIN
  SELECT * INTO s FROM delivery.shipments WHERE id = p_shipment FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no such shipment' USING ERRCODE = 'check_violation'; END IF;
  IF p_event_id IS NOT NULL THEN
    INSERT INTO delivery.provider_events (provider, event_id, consignment_id, reported_status, occurred_at)
    VALUES (s.provider, p_event_id, s.consignment_id, p_status, p_occurred) ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n = 0 THEN
      RETURN QUERY SELECT 'duplicate', false, false, false, false, false; RETURN;
    END IF;
  END IF;
  -- provider time, but never in the future and never before the booking
  t := greatest(least(p_occurred, now()), coalesce(s.booked_at, '-infinity'));
  cur := s.status;
  IF cur = 'booked' AND p_status IN ('in_transit', 'delivered', 'delivery_failed', 'returned_to_seller') THEN
    implied := true;  cur := 'picked_up';
  END IF;
  IF s.status = 'cancelled' AND p_status <> 'cancelled' THEN
    -- the courier reports progress on a booking it had confirmed as cancelled: a person must look
    INSERT INTO delivery.issues (order_id, kind, detail)
    VALUES (s.order_id, 'status_refused', jsonb_build_object('shipment', s.id, 'from', s.status, 'to', p_status))
    ON CONFLICT DO NOTHING;
    UPDATE delivery.provider_events SET outcome = 'refused' WHERE provider = s.provider AND event_id = p_event_id;
    RETURN QUERY SELECT 'refused', false, false, false, false, false; RETURN;
  END IF;
  IF NOT ((cur, p_status) IN (
       ('booked'::delivery.shipment_status, 'picked_up'::delivery.shipment_status), ('booked', 'cancelled'),
       ('picked_up', 'in_transit'), ('picked_up', 'delivered'), ('picked_up', 'delivery_failed'), ('picked_up', 'returned_to_seller'),
       ('in_transit', 'delivered'), ('in_transit', 'delivery_failed'), ('in_transit', 'returned_to_seller'),
       ('delivery_failed', 'in_transit'), ('delivery_failed', 'delivered'), ('delivery_failed', 'returned_to_seller'))) THEN
    IF (rank_of ->> p_status::text)::int <= (rank_of ->> s.status::text)::int THEN
      UPDATE delivery.provider_events SET outcome = 'stale' WHERE provider = s.provider AND event_id = p_event_id;
      RETURN QUERY SELECT 'stale', false, false, false, false, false; RETURN;
    END IF;
    UPDATE delivery.provider_events SET outcome = 'refused' WHERE provider = s.provider AND event_id = p_event_id;
    INSERT INTO delivery.issues (order_id, kind, detail)
    VALUES (s.order_id, 'status_refused', jsonb_build_object('shipment', s.id, 'from', s.status, 'to', p_status))
    ON CONFLICT DO NOTHING;
    RETURN QUERY SELECT 'refused', false, false, false, false, false; RETURN;
  END IF;
  IF implied THEN
    UPDATE delivery.shipments SET status = 'picked_up', picked_up_at = t, last_source = p_source, last_event_id = p_event_id
     WHERE id = p_shipment;
  END IF;
  UPDATE delivery.shipments
     SET status          = p_status,
         picked_up_at    = CASE WHEN p_status = 'picked_up' THEN t ELSE picked_up_at END,
         delivered_at    = CASE WHEN p_status = 'delivered' THEN t ELSE delivered_at END,
         returned_at     = CASE WHEN p_status = 'returned_to_seller' THEN t ELSE returned_at END,
         cancelled_at    = CASE WHEN p_status = 'cancelled' THEN t ELSE cancelled_at END,
         return_charge   = CASE WHEN p_status = 'returned_to_seller' THEN coalesce(p_return_charge, 0) ELSE return_charge END,
         failed_attempts = failed_attempts + CASE WHEN p_status = 'delivery_failed' THEN 1 ELSE 0 END,
         last_source     = p_source,
         last_event_id   = p_event_id
   WHERE id = p_shipment
   RETURNING * INTO s;
  UPDATE delivery.provider_events SET outcome = 'applied' WHERE provider = s.provider AND event_id = p_event_id;
  IF s.order_cancelled_at IS NOT NULL AND (implied OR p_status = 'picked_up') THEN
    INSERT INTO delivery.issues (order_id, kind, detail)
    VALUES (s.order_id, 'pickup_after_cancel', jsonb_build_object('shipment', s.id)) ON CONFLICT DO NOTHING;
  END IF;
  INSERT INTO delivery.outbox (event_type, aggregate_id, payload)
  VALUES (CASE WHEN s.direction = 'return' AND p_status = 'delivered' THEN 'delivery.return.delivered'
               ELSE 'delivery.shipment.status_changed' END,
          s.order_id, jsonb_build_object('shipment', s.id, 'direction', s.direction, 'status', p_status,
                                         'simulated', s.simulated, 'at', t));
  RETURN QUERY SELECT 'applied',
         (implied OR p_status = 'picked_up'),
         (s.direction = 'forward' AND s.picked_up_at <= s.pickup_due_at),
         p_status = 'delivered', p_status = 'returned_to_seller', s.order_cancelled_at IS NOT NULL;
END $$;

-- FR-DLV-11: a not_received dispute may be opened once CP-17 has passed since pickup without delivery
CREATE FUNCTION delivery.not_received_allowed(p_order uuid, p_cp17 interval) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM delivery.shipments
                  WHERE order_id = p_order AND direction = 'forward'
                    AND status IN ('picked_up', 'in_transit', 'delivery_failed')
                    AND picked_up_at + p_cp17 <= now())
$$;

-- =====================================================================
-- Reference data: fare table version 1 (CP-43), from a published rate card (R14):
-- RedX merchant rates, inside Dhaka / sub-area / outside Dhaka: BDT 50 / 80 / 100 up to 1 kg,
-- 65 / 95 / 120 up to 2 kg, then 15 / 15 / 20 per kg. Administrators publish new versions.
-- =====================================================================
INSERT INTO delivery.fare_tables (version, effective_from, source)
VALUES (1, '2026-10-01T00:00:00+06:00', 'RedX published merchant rates (SRS R14), retrieved October 2026; to be reviewed by the administrator');
INSERT INTO delivery.fare_rows (version, zone, up_to_1kg, up_to_2kg, per_extra_kg) VALUES
  (1, 'inside_dhaka',   5000,  6500, 1500),
  (1, 'dhaka_suburbs',  8000,  9500, 1500),
  (1, 'outside_dhaka', 10000, 12000, 2000);

-- =====================================================================
-- Grants (SEC-INF-03)
-- =====================================================================
GRANT USAGE ON SCHEMA delivery TO tb_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA delivery TO tb_app;
REVOKE UPDATE ON delivery.code_entries, delivery.shipment_history, delivery.fare_tables, delivery.fare_rows FROM tb_app;
GRANT DELETE ON delivery.provider_events TO tb_app;                         -- retention CP-32
`;
