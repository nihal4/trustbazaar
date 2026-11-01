-- =====================================================================
-- TrustBazaar - Unit 3: Auction Engine; Listings, Search & Fixed-Price
-- PostgreSQL 15 schema.  Design document: docs/design/03_listings_auctions.pdf
-- Requirements: SRS v2.0 FR-LST-01..13, FR-SRC-01..06, FR-AUC-01..18,
--   FR-FIX-02/04/05 (stock side), FR-MON-05 (featured display),
--   FR-TNS-02/08 (flags), NFR-PERF-02/03/05, NFR-REL-01, NFR-SCL-01..03.
-- Depends on: 01_identity_access.sql (identity.users, staff, forbid_change,
--   audit.actor_type). Later units (orders, game accounts) are referenced
--   by plain UUIDs (DC-5).
-- The bid engine runs inside the database (auctions.place_bid), so that the
-- critical section - read state, decide, write - happens under one row lock
-- in one round trip. The service layer calls it after its own checks.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;      -- substring and fuzzy matching (Bangla and English)

CREATE SCHEMA IF NOT EXISTS listings;
CREATE SCHEMA IF NOT EXISTS auctions;

-- ---------------------------------------------------------------- types
CREATE TYPE listings.item_kind      AS ENUM ('physical', 'game_account');
CREATE TYPE listings.sale_format    AS ENUM ('fixed_price', 'auction');
CREATE TYPE listings.item_condition AS ENUM ('new', 'like_new', 'used', 'for_parts');
CREATE TYPE listings.status         AS ENUM
  ('draft', 'pending_review', 'active', 'sold', 'ended_unsold', 'cancelled', 'removed');   -- FR-LST-12
CREATE TYPE listings.fulfilment_options AS ENUM ('pickup_only', 'courier_only', 'pickup_or_courier');
CREATE TYPE listings.weight_class   AS ENUM ('up_to_1kg', 'up_to_2kg', 'up_to_5kg', 'up_to_10kg', 'over_10kg');
CREATE TYPE listings.size_class     AS ENUM ('small', 'medium', 'large', 'oversize');
CREATE TYPE auctions.auction_status AS ENUM ('open', 'awarded', 'unsold', 'cancelled');
CREATE TYPE auctions.bid_outcome    AS ENUM ('leading', 'outbid', 'raised_own_max');
CREATE TYPE auctions.offer_status   AS ENUM ('offered', 'accepted', 'declined', 'expired');

-- =====================================================================
-- Categories (FR-LST-10)
-- =====================================================================
CREATE TABLE listings.categories (
  id          smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  parent_id   smallint REFERENCES listings.categories(id),
  slug        varchar(60) NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]+$'),
  name_en     varchar(80) NOT NULL,
  name_bn     varchar(80) NOT NULL,
  item_kind   listings.item_kind NOT NULL,
  prohibited  boolean NOT NULL DEFAULT false,      -- shown in the policy, never selectable
  sort_order  smallint NOT NULL DEFAULT 0
);

CREATE TABLE listings.screening_terms (                                       -- FR-LST-11
  id        integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  term      varchar(80) NOT NULL UNIQUE,            -- lower case; Bangla or English
  severity  varchar(10) NOT NULL CHECK (severity IN ('prohibited', 'high_risk')),
  added_by  uuid REFERENCES identity.staff_accounts(id),
  added_at  timestamptz NOT NULL DEFAULT now()
);

-- =====================================================================
-- Listings (FR-LST-01..12, FR-FIX-04/05, FR-SRC-04)
-- =====================================================================
CREATE TABLE listings.listings (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id            uuid NOT NULL REFERENCES identity.users(id),
  item_kind            listings.item_kind NOT NULL,
  sale_format          listings.sale_format NOT NULL,
  category_id          smallint NOT NULL REFERENCES listings.categories(id),
  title                varchar(120) NOT NULL CHECK (length(btrim(title)) >= 5),
  description          varchar(5000) NOT NULL CHECK (length(btrim(description)) >= 20),
  condition            listings.item_condition,
  no_visible_defects   boolean,                    -- the declaration of FR-LST-02
  weight_class         listings.weight_class,
  size_class           listings.size_class,
  fulfilment_options   listings.fulfilment_options,
  area_district        varchar(40),
  approx_lat           numeric(6,3) CHECK (approx_lat BETWEEN 20.0 AND 27.0),
  approx_lng           numeric(6,3) CHECK (approx_lng BETWEEN 88.0 AND 93.0),
  price                bigint CHECK (price > 0),   -- fixed price, poisha
  quantity_total       integer NOT NULL DEFAULT 1 CHECK (quantity_total >= 1),
  quantity_available   integer NOT NULL DEFAULT 1,
  quantity_reserved    integer NOT NULL DEFAULT 0,
  quantity_sold        integer NOT NULL DEFAULT 0,
  status               listings.status NOT NULL DEFAULT 'draft',
  locked_at            timestamptz,                -- first bid or first order (FR-LST-07)
  seller_visible       boolean NOT NULL DEFAULT true,   -- false while the seller is unverified or suspended
  featured_until       timestamptz,                -- set from payments.featured.* events (FR-MON-05)
  ai_draft_used        boolean NOT NULL DEFAULT false,  -- FR-LST-13 (seller confirmed the text)
  published_at         timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  search_tsv           tsvector GENERATED ALWAYS AS
                         (setweight(to_tsvector('simple', title), 'A') ||
                          setweight(to_tsvector('simple', description), 'B')) STORED,
  -- stock: every unit is available, reserved by an unpaid order, or sold (FR-FIX-02/05)
  CONSTRAINT stock_non_negative CHECK (quantity_available >= 0 AND quantity_reserved >= 0 AND quantity_sold >= 0),
  CONSTRAINT stock_adds_up CHECK (quantity_available + quantity_reserved + quantity_sold = quantity_total),
  CONSTRAINT auction_single_unit CHECK (sale_format = 'fixed_price' OR quantity_total = 1),
  CONSTRAINT fixed_needs_price CHECK ((sale_format = 'fixed_price') = (price IS NOT NULL)),
  -- physical items carry condition, defect declaration, parcel classes, fulfilment and location
  CONSTRAINT physical_fields CHECK (item_kind <> 'physical' OR
     (condition IS NOT NULL AND no_visible_defects IS NOT NULL AND fulfilment_options IS NOT NULL
      AND approx_lat IS NOT NULL AND area_district IS NOT NULL)),
  CONSTRAINT courier_needs_parcel CHECK (fulfilment_options IS NULL OR fulfilment_options = 'pickup_only'
                                         OR (weight_class IS NOT NULL AND size_class IS NOT NULL)),
  -- no courier fare covers an item over 10 kg or an oversize item (I-23; Unit 4 DV-24, DV-25)
  CONSTRAINT courier_parcel_fits CHECK (fulfilment_options IS NULL OR fulfilment_options = 'pickup_only'
                                        OR (weight_class <> 'over_10kg' AND size_class <> 'oversize')),
  CONSTRAINT game_fields CHECK (item_kind <> 'game_account' OR
     (condition IS NULL AND fulfilment_options IS NULL AND weight_class IS NULL AND quantity_total = 1)),
  CONSTRAINT location_pair CHECK ((approx_lat IS NULL) = (approx_lng IS NULL)),
  CONSTRAINT published_time CHECK (status IN ('draft', 'pending_review') OR published_at IS NOT NULL
                                   OR status IN ('cancelled', 'removed'))
);
CREATE INDEX listings_seller   ON listings.listings (seller_id, status);
CREATE INDEX listings_search   ON listings.listings USING gin (search_tsv) WHERE status = 'active';
CREATE INDEX listings_title_trgm ON listings.listings USING gin (title gin_trgm_ops) WHERE status = 'active';
CREATE INDEX listings_browse   ON listings.listings (category_id, published_at DESC) WHERE status = 'active' AND seller_visible;
CREATE INDEX listings_price    ON listings.listings (price) WHERE status = 'active' AND seller_visible;
CREATE INDEX listings_geo      ON listings.listings (approx_lat, approx_lng) WHERE status = 'active' AND seller_visible;
CREATE INDEX listings_featured ON listings.listings (featured_until) WHERE featured_until IS NOT NULL;

-- edits after the first bid or order, and status transitions (FR-LST-01, 07, 10, 12)
CREATE FUNCTION listings.check_listing_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prohibited boolean; cat_kind listings.item_kind;
BEGIN
  SELECT c.prohibited, c.item_kind INTO prohibited, cat_kind FROM listings.categories c WHERE c.id = NEW.category_id;
  IF prohibited THEN
    RAISE EXCEPTION 'category % is prohibited', NEW.category_id USING ERRCODE = 'check_violation';
  END IF;
  IF cat_kind <> NEW.item_kind THEN
    RAISE EXCEPTION 'category does not match item kind' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.item_kind <> OLD.item_kind OR NEW.sale_format <> OLD.sale_format THEN
      IF OLD.status NOT IN ('draft', 'pending_review') THEN
        RAISE EXCEPTION 'item kind and sale format are fixed after publication' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    IF OLD.locked_at IS NOT NULL AND (NEW.title, NEW.description, NEW.price, NEW.quantity_total, NEW.category_id, NEW.condition)
         IS DISTINCT FROM (OLD.title, OLD.description, OLD.price, OLD.quantity_total, OLD.category_id, OLD.condition) THEN
      RAISE EXCEPTION 'listing content is locked after the first bid or order; add a clarification instead'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT ((OLD.status, NEW.status) IN (
         ('draft'::listings.status, 'pending_review'::listings.status), ('draft', 'active'), ('draft', 'cancelled'),
         ('pending_review', 'active'), ('pending_review', 'draft'), ('pending_review', 'removed'),
         ('active', 'sold'), ('active', 'ended_unsold'), ('active', 'cancelled'), ('active', 'removed'))) THEN
      RAISE EXCEPTION 'listing status % -> % is not permitted', OLD.status, NEW.status USING ERRCODE = 'check_violation';
    END IF;
    NEW.updated_at := now();
  ELSIF NEW.status NOT IN ('draft', 'pending_review') THEN
    RAISE EXCEPTION 'a new listing starts as draft or pending_review' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER listing_change BEFORE INSERT OR UPDATE ON listings.listings
  FOR EACH ROW EXECUTE FUNCTION listings.check_listing_change();

CREATE TABLE listings.listing_photos (                                       -- FR-LST-02
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id     uuid NOT NULL REFERENCES listings.listings(id),
  position       smallint NOT NULL CHECK (position BETWEEN 1 AND 10),        -- CP-33
  storage_key    varchar(80) NOT NULL UNIQUE,
  width          smallint NOT NULL CHECK (width BETWEEN 1 AND 4000),
  height         smallint NOT NULL CHECK (height BETWEEN 1 AND 4000),
  shows_defects  boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  removed_at     timestamptz
);
-- positions are unique among the photos shown, so a removed photo's position can be used again
CREATE UNIQUE INDEX listing_photos_live_position ON listings.listing_photos (listing_id, position) WHERE removed_at IS NULL;

-- a physical listing is published only with two photos and a defect photo or a no-defects declaration
CREATE FUNCTION listings.check_publishable() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n int; defect_photo boolean;
BEGIN
  IF NEW.status IN ('pending_review', 'active') AND OLD.status = 'draft' AND NEW.item_kind = 'physical' THEN
    SELECT count(*), coalesce(bool_or(shows_defects), false) INTO n, defect_photo
      FROM listings.listing_photos WHERE listing_id = NEW.id AND removed_at IS NULL;
    IF n < 2 THEN
      RAISE EXCEPTION 'a physical listing needs at least two photos' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT defect_photo AND NOT NEW.no_visible_defects THEN
      RAISE EXCEPTION 'mark a photo as showing defects or declare that there are none' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER listing_publishable BEFORE UPDATE OF status ON listings.listings
  FOR EACH ROW EXECUTE FUNCTION listings.check_publishable();

CREATE TABLE listings.clarifications (                                      -- FR-LST-07, append-only
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  listing_id  uuid NOT NULL REFERENCES listings.listings(id),
  body        varchar(1000) NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER clarifications_append_only BEFORE UPDATE OR DELETE ON listings.clarifications
  FOR EACH ROW EXECUTE FUNCTION identity.forbid_change();

CREATE TABLE listings.status_history (                                      -- FR-LST-12, append-only
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  listing_id  uuid NOT NULL REFERENCES listings.listings(id),
  from_status listings.status,
  to_status   listings.status NOT NULL,
  actor_type  audit.actor_type NOT NULL,
  actor_id    uuid,
  reason      text NOT NULL,
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER listing_history_append_only BEFORE UPDATE OR DELETE ON listings.status_history
  FOR EACH ROW EXECUTE FUNCTION identity.forbid_change();

-- what an order's events did to its reserved units (orders.order.paid: sold; orders.order.cancelled:
-- released). One outcome per order, so a redelivered event never moves stock twice (DC-6), and a
-- cancellation after payment returns nothing (I-14: the seller relists). Append-only.
CREATE TABLE listings.stock_moves (
  order_id    uuid PRIMARY KEY,                    -- Unit 2's order (DC-5: no foreign key to a later unit)
  kind        varchar(10) NOT NULL CHECK (kind IN ('sold', 'released')),
  listing_id  uuid NOT NULL REFERENCES listings.listings(id),
  quantity    integer NOT NULL CHECK (quantity >= 1),
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stock_moves_listing ON listings.stock_moves (listing_id);
CREATE TRIGGER stock_moves_append_only BEFORE UPDATE OR DELETE ON listings.stock_moves
  FOR EACH ROW EXECUTE FUNCTION identity.forbid_change();

-- ---------------------------------------------------------------- stock port (DC-13): single statements
-- reserve: returns true if reserved; false means "not available" (FR-FIX-05)
CREATE FUNCTION listings.reserve(p_listing uuid, p_qty int) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  UPDATE listings.listings
     SET quantity_available = quantity_available - p_qty,
         quantity_reserved  = quantity_reserved + p_qty,
         locked_at          = coalesce(locked_at, now())
   WHERE id = p_listing AND status = 'active' AND seller_visible
     AND sale_format = 'fixed_price' AND quantity_available >= p_qty;
  RETURN FOUND;
END $$;

CREATE FUNCTION listings.release(p_listing uuid, p_qty int) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE listings.listings
     SET quantity_available = quantity_available + p_qty,
         quantity_reserved  = quantity_reserved - p_qty
   WHERE id = p_listing;
END $$;

-- on orders.order.paid: reserved -> sold; the listing is sold when nothing is left (FR-FIX-04)
CREATE FUNCTION listings.mark_sold(p_listing uuid, p_qty int) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE listings.listings
     SET quantity_reserved = quantity_reserved - p_qty,
         quantity_sold     = quantity_sold + p_qty
   WHERE id = p_listing;
  UPDATE listings.listings SET status = 'sold'
   WHERE id = p_listing AND status = 'active' AND quantity_available = 0 AND quantity_reserved = 0;
END $$;

-- ---------------------------------------------------------------- distance (FR-SRC-02/05)
-- great-circle distance in km (haversine); inputs are the rounded coordinates
CREATE FUNCTION listings.distance_km(lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric)
RETURNS double precision LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT 2 * 6371.0 * asin(sqrt(
      power(sin(radians((lat2 - lat1)::float8) / 2), 2) +
      cos(radians(lat1::float8)) * cos(radians(lat2::float8)) * power(sin(radians((lng2 - lng1)::float8) / 2), 2)))
$$;

-- =====================================================================
-- Auctions (FR-AUC-01..18)
-- =====================================================================
CREATE TABLE auctions.auctions (
  listing_id        uuid PRIMARY KEY REFERENCES listings.listings(id),
  seller_id         uuid NOT NULL REFERENCES identity.users(id),
  start_price       bigint NOT NULL CHECK (start_price > 0),
  reserve_price     bigint,                                    -- hidden (FR-AUC-09)
  -- rule snapshot at publication (FR-OPS-08): CP-08 and CP-09
  inc_bps           integer NOT NULL CHECK (inc_bps BETWEEN 1 AND 5000),          -- 200 = 2 %
  inc_min           bigint  NOT NULL CHECK (inc_min > 0),                         -- 5000 = BDT 50
  snipe_window      interval NOT NULL CHECK (snipe_window > interval '0'),
  snipe_extension   interval NOT NULL CHECK (snipe_extension > interval '0'),
  starts_at         timestamptz NOT NULL,
  original_end_at   timestamptz NOT NULL,
  end_at            timestamptz NOT NULL,                      -- authoritative (FR-AUC-01)
  status            auctions.auction_status NOT NULL DEFAULT 'open',
  leader_id         uuid REFERENCES identity.users(id),
  leader_max        bigint,                                    -- hidden proxy maximum (FR-AUC-08)
  current_price     bigint,
  bid_count         integer NOT NULL DEFAULT 0,
  version           bigint NOT NULL DEFAULT 0,                 -- broadcast sequence number
  winner_id         uuid REFERENCES identity.users(id),
  final_price       bigint,
  closed_at         timestamptz,
  CONSTRAINT reserve_at_least_start CHECK (reserve_price IS NULL OR reserve_price >= start_price),
  CONSTRAINT end_only_extends CHECK (end_at >= original_end_at AND original_end_at > starts_at),
  CONSTRAINT leader_fields CHECK ((leader_id IS NULL) = (leader_max IS NULL) AND (leader_id IS NULL) = (current_price IS NULL)),
  CONSTRAINT price_within_max CHECK (current_price IS NULL OR (current_price >= start_price AND current_price <= leader_max)),
  CONSTRAINT seller_not_leader CHECK (leader_id IS NULL OR leader_id <> seller_id),
  CONSTRAINT award_fields CHECK ((status = 'awarded') = (winner_id IS NOT NULL AND final_price IS NOT NULL)),
  CONSTRAINT closed_time CHECK ((status = 'open') = (closed_at IS NULL)),
  CONSTRAINT award_meets_reserve CHECK (status <> 'awarded' OR reserve_price IS NULL OR final_price >= reserve_price)
);
CREATE INDEX auctions_due ON auctions.auctions (end_at) WHERE status = 'open';      -- close job, "ending soonest"

CREATE TABLE auctions.bids (                                    -- inputs; bids are binding (FR-AUC-10)
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  auction_id    uuid NOT NULL REFERENCES auctions.auctions(listing_id),
  bidder_id     uuid NOT NULL REFERENCES identity.users(id),
  max_amount    bigint NOT NULL CHECK (max_amount > 0),         -- the bidder's maximum (a plain bid is its own maximum)
  received_at   timestamptz NOT NULL,                           -- server receipt time (FR-AUC-04)
  outcome       auctions.bid_outcome NOT NULL,                  -- as decided when placed
  price_after   bigint NOT NULL,
  leader_after  uuid NOT NULL,
  extended_to   timestamptz,                                    -- set when the bid triggered anti-sniping
  voided_at     timestamptz,
  voided_by     uuid REFERENCES identity.staff_accounts(id),
  void_reason   text,
  CONSTRAINT void_fields CHECK ((voided_at IS NULL) = (voided_by IS NULL) AND (voided_at IS NULL) = (void_reason IS NULL))
);
CREATE INDEX bids_auction ON auctions.bids (auction_id, received_at, id);
CREATE INDEX bids_bidder  ON auctions.bids (bidder_id, received_at DESC);
-- bids are never deleted, and only the void fields may change
CREATE FUNCTION auctions.bids_only_void() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'bids cannot be deleted' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF (NEW.auction_id, NEW.bidder_id, NEW.max_amount, NEW.received_at, NEW.outcome, NEW.price_after, NEW.leader_after)
     IS DISTINCT FROM (OLD.auction_id, OLD.bidder_id, OLD.max_amount, OLD.received_at, OLD.outcome, OLD.price_after, OLD.leader_after)
     OR OLD.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'a bid can only be voided, once' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bids_immutable BEFORE UPDATE OR DELETE ON auctions.bids
  FOR EACH ROW EXECUTE FUNCTION auctions.bids_only_void();

CREATE TABLE auctions.bidder_aliases (                          -- consistent mask per auction (FR-AUC-13)
  auction_id  uuid NOT NULL REFERENCES auctions.auctions(listing_id),
  bidder_id   uuid NOT NULL REFERENCES identity.users(id),
  alias_no    integer NOT NULL,
  PRIMARY KEY (auction_id, bidder_id),
  UNIQUE (auction_id, alias_no)
);

CREATE TABLE auctions.strikes (                                 -- FR-AUC-16
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES identity.users(id),
  auction_id  uuid NOT NULL REFERENCES auctions.auctions(listing_id),
  order_id    uuid NOT NULL,                                    -- Unit 2 order (no FK)
  at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id)                                             -- one strike per unpaid order
);
CREATE TABLE auctions.bidding_restrictions (
  user_id     uuid PRIMARY KEY REFERENCES identity.users(id),
  until       timestamptz NOT NULL,
  reason      text NOT NULL,
  set_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE auctions.second_chance_offers (                    -- FR-AUC-15
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id  uuid NOT NULL REFERENCES auctions.auctions(listing_id),
  bidder_id   uuid NOT NULL REFERENCES identity.users(id),
  price       bigint NOT NULL CHECK (price > 0),
  status      auctions.offer_status NOT NULL DEFAULT 'offered',
  offered_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  decided_at  timestamptz,
  order_id    uuid,
  CHECK ((status = 'offered') = (decided_at IS NULL)),
  CHECK ((status = 'accepted') = (order_id IS NOT NULL)),
  UNIQUE (auction_id, bidder_id)                                -- a bidder is offered the item at most once
);
CREATE UNIQUE INDEX offer_one_open ON auctions.second_chance_offers (auction_id) WHERE status = 'offered';

CREATE TABLE auctions.flags (                                   -- FR-AUC-18, FR-TNS-08
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  auction_id  uuid NOT NULL REFERENCES auctions.auctions(listing_id),
  kind        varchar(40) NOT NULL CHECK (kind IN ('new_account_cluster', 'linked_to_seller', 'last_second_pattern', 'self_outbid_pattern')),
  score       numeric(4,3) NOT NULL CHECK (score BETWEEN 0 AND 1),
  detail      jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);

CREATE TABLE auctions.outbox (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_type      varchar(80) NOT NULL CHECK (event_type ~ '^(listings|auctions)\.[a-z_]+\.[a-z_]+$'),
  aggregate_id    uuid NOT NULL,
  payload         jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  attempts        smallint NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  dispatched_at   timestamptz
);
CREATE INDEX auctions_outbox_pending ON auctions.outbox (next_attempt_at) WHERE dispatched_at IS NULL;

-- =====================================================================
-- Bid engine (FR-AUC-02..09, FR-AUC-13)
-- =====================================================================
-- minimum increment over a price: greater of inc_bps of the price and inc_min,
-- rounded up to a whole taka (CP-08)
CREATE FUNCTION auctions.increment(p_price bigint, p_bps int, p_min bigint) RETURNS bigint
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT greatest(((p_price * p_bps + 999999) / 1000000) * 100, p_min)
$$;

-- Pure decision: given the current state and one new maximum, return the new state.
-- Used by place_bid and by replay, so a recomputation after a void follows exactly the same rules.
-- Raises 'below_minimum' or 'max_not_higher' when the bid is not acceptable.
CREATE FUNCTION auctions.resolve(
    p_start bigint, p_reserve bigint, p_bps int, p_min bigint,
    p_leader uuid, p_leader_max bigint, p_price bigint,
    p_bidder uuid, p_max bigint,
    OUT leader uuid, OUT leader_max bigint, OUT price bigint, OUT outcome auctions.bid_outcome)
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE required bigint;
BEGIN
  IF p_leader IS NULL THEN                                      -- first bid
    IF p_max < p_start THEN
      RAISE EXCEPTION 'below_minimum: first bid must be at least %', p_start USING ERRCODE = 'P0001';
    END IF;
    leader := p_bidder; leader_max := p_max; price := p_start; outcome := 'leading';
  ELSIF p_bidder = p_leader THEN                                 -- leader raises own maximum
    IF p_max <= p_leader_max THEN
      RAISE EXCEPTION 'max_not_higher: new maximum must exceed your current maximum' USING ERRCODE = 'P0001';
    END IF;
    leader := p_leader; leader_max := p_max; price := p_price; outcome := 'raised_own_max';
  ELSE
    required := p_price + auctions.increment(p_price, p_bps, p_min);
    IF p_max < required THEN
      RAISE EXCEPTION 'below_minimum: bid must be at least %', required USING ERRCODE = 'P0001';
    END IF;
    IF p_max > p_leader_max THEN                                 -- challenger takes the lead
      leader := p_bidder; leader_max := p_max;
      price := least(p_max, p_leader_max + auctions.increment(p_leader_max, p_bps, p_min));
      outcome := 'leading';
    ELSE                                                         -- leader's proxy answers; ties go to the earlier maximum
      leader := p_leader; leader_max := p_leader_max;
      price := least(p_leader_max, p_max + auctions.increment(p_max, p_bps, p_min));
      outcome := 'outbid';
    END IF;
  END IF;
  -- reserve: if the leader's maximum reaches the reserve, the price rises to it, so that a bidder
  -- willing to pay the reserve is not left below it by the proxy step (FR-AUC-09)
  IF p_reserve IS NOT NULL AND price < p_reserve AND leader_max >= p_reserve THEN
    price := p_reserve;
  END IF;
END $$;

-- Place one bid. The caller (BidService) has already checked that the bidder is verified, not
-- suspended, within the rate limit, and that the auction's listing is visible. The transaction
-- must start when the request is received: now() (transaction start) is the receipt time.
CREATE FUNCTION auctions.place_bid(p_auction uuid, p_bidder uuid, p_max bigint,
    OUT bid_id bigint, OUT outcome auctions.bid_outcome, OUT price bigint, OUT leader_alias int,
    OUT end_at timestamptz, OUT extended boolean, OUT previous_leader uuid, OUT version bigint)
LANGUAGE plpgsql AS $$
DECLARE
  a auctions.auctions%ROWTYPE;
  r record;
  received timestamptz := now();
  restricted timestamptz;
BEGIN
  SET LOCAL lock_timeout = '1s';                                  -- bounds waiting; see close grace DV-17
  SELECT * INTO a FROM auctions.auctions WHERE listing_id = p_auction FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'auction_not_found' USING ERRCODE = 'P0001'; END IF;
  IF a.status <> 'open' OR received < a.starts_at THEN
    RAISE EXCEPTION 'auction_not_open' USING ERRCODE = 'P0001';
  END IF;
  -- the listing must be active and its seller visible (not unverified or suspended: FR-SRC-04, FR-TNS-05)
  PERFORM 1 FROM listings.listings WHERE id = p_auction AND status = 'active' AND seller_visible;
  IF NOT FOUND THEN RAISE EXCEPTION 'auction_not_open: listing not available' USING ERRCODE = 'P0001'; END IF;
  IF received >= a.end_at THEN                                    -- decided by receipt time (FR-AUC-04)
    RAISE EXCEPTION 'auction_ended' USING ERRCODE = 'P0001';
  END IF;
  IF p_bidder = a.seller_id THEN
    RAISE EXCEPTION 'seller_cannot_bid' USING ERRCODE = 'P0001';
  END IF;
  SELECT until INTO restricted FROM auctions.bidding_restrictions WHERE user_id = p_bidder;
  IF restricted IS NOT NULL AND restricted > received THEN
    RAISE EXCEPTION 'bidder_restricted until %', restricted USING ERRCODE = 'P0001';
  END IF;

  r := auctions.resolve(a.start_price, a.reserve_price, a.inc_bps, a.inc_min,
                        a.leader_id, a.leader_max, a.current_price, p_bidder, p_max);

  previous_leader := a.leader_id;
  extended := received >= a.end_at - a.snipe_window;               -- anti-sniping (FR-AUC-05)
  end_at := CASE WHEN extended THEN greatest(a.end_at, received + a.snipe_extension) ELSE a.end_at END;

  INSERT INTO auctions.bidder_aliases (auction_id, bidder_id, alias_no)
  SELECT p_auction, p_bidder, coalesce(max(alias_no), 0) + 1 FROM auctions.bidder_aliases WHERE auction_id = p_auction
  ON CONFLICT (auction_id, bidder_id) DO NOTHING;

  INSERT INTO auctions.bids (auction_id, bidder_id, max_amount, received_at, outcome, price_after, leader_after, extended_to)
  VALUES (p_auction, p_bidder, p_max, received, r.outcome, r.price, r.leader, CASE WHEN extended THEN end_at END)
  RETURNING id INTO bid_id;

  UPDATE auctions.auctions
     SET leader_id = r.leader, leader_max = r.leader_max, current_price = r.price,
         bid_count = auctions.auctions.bid_count + 1, end_at = place_bid.end_at,
         version = auctions.auctions.version + 1
   WHERE listing_id = p_auction
  RETURNING auctions.auctions.version INTO version;

  IF a.bid_count = 0 THEN                                          -- first bid locks the listing (FR-LST-07)
    UPDATE listings.listings SET locked_at = coalesce(locked_at, received) WHERE id = p_auction;
  END IF;

  SELECT alias_no INTO leader_alias FROM auctions.bidder_aliases WHERE auction_id = p_auction AND bidder_id = r.leader;
  outcome := r.outcome; price := r.price;
END $$;

-- Replay all bids that are not voided, in the order they were processed, through the same rules
-- (FR-AUC-10). Processing order is the bid id order: ids are assigned under the auction's row lock,
-- so they record the sequence in which bids were actually decided. Receipt time can differ (a bid
-- received earlier may wait longer for the lock), and is used only for the end-time rule.
-- Returns the public bid history: bidder alias, the amount shown, and whether that bid led.
-- A bid that would be rejected on replay (possible only after a void) is shown as not counted.
CREATE FUNCTION auctions.replay(p_auction uuid)
RETURNS TABLE (bid_id bigint, received_at timestamptz, alias_no int, shown_amount bigint,
               is_leading boolean, counted boolean, leader uuid, leader_max bigint, price bigint)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  a auctions.auctions%ROWTYPE;
  b record;
  st record;
  cur_leader uuid; cur_max bigint; cur_price bigint;
BEGIN
  SELECT * INTO a FROM auctions.auctions WHERE listing_id = p_auction;
  FOR b IN SELECT x.id, x.bidder_id, x.max_amount, x.received_at FROM auctions.bids x
            WHERE x.auction_id = p_auction AND x.voided_at IS NULL ORDER BY x.id LOOP
    BEGIN
      st := auctions.resolve(a.start_price, a.reserve_price, a.inc_bps, a.inc_min,
                             cur_leader, cur_max, cur_price, b.bidder_id, b.max_amount);
      cur_leader := st.leader; cur_max := st.leader_max; cur_price := st.price;
      bid_id := b.id; received_at := b.received_at;
      SELECT ba.alias_no INTO alias_no FROM auctions.bidder_aliases ba WHERE ba.auction_id = p_auction AND ba.bidder_id = b.bidder_id;
      -- a leading bid shows the price it set; an outbid bid shows the bidder's own amount;
      -- the leader's maximum is never shown (FR-AUC-08, FR-AUC-13)
      is_leading := st.outcome <> 'outbid';
      shown_amount := CASE WHEN st.outcome = 'outbid' THEN b.max_amount ELSE st.price END;
      counted := true; leader := cur_leader; leader_max := cur_max; price := cur_price;
      RETURN NEXT;
    EXCEPTION WHEN raise_exception THEN
      bid_id := b.id; received_at := b.received_at; alias_no := NULL; shown_amount := NULL;
      is_leading := false; counted := false; leader := cur_leader; leader_max := cur_max; price := cur_price;
      RETURN NEXT;
    END;
  END LOOP;
END $$;

-- Recompute the auction after a void (FR-AUC-10). The end time is not shortened: an extension
-- caused by a voided bid stays, because other bidders may have relied on it.
CREATE FUNCTION auctions.recompute(p_auction uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE lst record; n int;
BEGIN
  PERFORM 1 FROM auctions.auctions WHERE listing_id = p_auction AND status = 'open' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'only an open auction can be recomputed'; END IF;
  SELECT count(*) FILTER (WHERE counted) INTO n FROM auctions.replay(p_auction);
  SELECT * INTO lst FROM auctions.replay(p_auction) r ORDER BY r.bid_id DESC LIMIT 1;
  UPDATE auctions.auctions
     SET leader_id = lst.leader, leader_max = lst.leader_max, current_price = lst.price,
         bid_count = coalesce(n, 0), version = version + 1
   WHERE listing_id = p_auction;
END $$;

-- Close one auction if it is due (FR-AUC-09, FR-AUC-14). p_grace (DV-17) must exceed the bid
-- lock_timeout, so that every bid received before end_at has finished before the close decides.
-- Returns the new status; the caller creates the order (Unit 2 OrdersPort) in the same transaction.
CREATE FUNCTION auctions.close_if_due(p_auction uuid, p_grace interval)
RETURNS auctions.auction_status LANGUAGE plpgsql AS $$
DECLARE a auctions.auctions%ROWTYPE;
BEGIN
  SELECT * INTO a FROM auctions.auctions WHERE listing_id = p_auction FOR UPDATE;
  IF a.status <> 'open' OR now() < a.end_at + p_grace THEN
    RETURN a.status;                                             -- not due, or already closed
  END IF;
  IF a.leader_id IS NULL OR (a.reserve_price IS NOT NULL AND a.current_price < a.reserve_price) THEN
    UPDATE auctions.auctions SET status = 'unsold', closed_at = now() WHERE listing_id = p_auction;
    RETURN 'unsold';
  END IF;
  UPDATE auctions.auctions SET status = 'awarded', winner_id = a.leader_id, final_price = a.current_price, closed_at = now()
   WHERE listing_id = p_auction;
  RETURN 'awarded';
END $$;

-- Next eligible bidder for a second-chance offer (FR-AUC-15): highest maximum among bidders who
-- have not won or been offered the item, whose bids are not voided and who are not restricted.
CREATE FUNCTION auctions.next_second_chance(p_auction uuid, OUT bidder uuid, OUT price bigint)
LANGUAGE sql STABLE AS $$
  SELECT b.bidder_id, max(b.max_amount)
    FROM auctions.bids b JOIN auctions.auctions a ON a.listing_id = b.auction_id
   WHERE b.auction_id = p_auction AND b.voided_at IS NULL
     AND b.bidder_id IS DISTINCT FROM a.winner_id
     AND NOT EXISTS (SELECT 1 FROM auctions.second_chance_offers o WHERE o.auction_id = p_auction AND o.bidder_id = b.bidder_id)
     AND NOT EXISTS (SELECT 1 FROM auctions.bidding_restrictions r WHERE r.user_id = b.bidder_id AND r.until > now())
   GROUP BY b.bidder_id
   ORDER BY max(b.max_amount) DESC, min(b.id)
   LIMIT 1
$$;

-- Record a non-payment strike; restrict bidding on reaching the threshold (FR-AUC-16, CP-12)
CREATE FUNCTION auctions.record_strike(p_user uuid, p_auction uuid, p_order uuid,
                                       p_threshold int, p_window interval, p_ban interval) RETURNS boolean
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  INSERT INTO auctions.strikes (user_id, auction_id, order_id) VALUES (p_user, p_auction, p_order)
  ON CONFLICT (order_id) DO NOTHING;
  SELECT count(*) INTO n FROM auctions.strikes WHERE user_id = p_user AND at > now() - p_window;
  IF n >= p_threshold THEN
    INSERT INTO auctions.bidding_restrictions (user_id, until, reason)
    VALUES (p_user, now() + p_ban, format('%s non-payment strikes within %s', n, p_window))
    ON CONFLICT (user_id) DO UPDATE SET until = greatest(auctions.bidding_restrictions.until, EXCLUDED.until),
                                        reason = EXCLUDED.reason, set_at = now();
    RETURN true;
  END IF;
  RETURN false;
END $$;

-- =====================================================================
-- Search view (FR-SRC-01..05): only active listings of visible sellers, open auctions only
-- =====================================================================
CREATE VIEW listings.searchable AS
  SELECT l.id, l.seller_id, l.item_kind, l.sale_format, l.category_id, l.title, l.condition,
         l.area_district, l.approx_lat, l.approx_lng, l.published_at, l.search_tsv,
         CASE WHEN l.sale_format = 'auction' THEN coalesce(a.current_price, a.start_price) ELSE l.price END AS display_price,
         a.end_at AS auction_end_at,
         (a.reserve_price IS NOT NULL AND coalesce(a.current_price, 0) < a.reserve_price) AS reserve_not_met,
         (l.featured_until IS NOT NULL AND l.featured_until > now()) AS featured,
         (l.quantity_available = 0 AND l.quantity_reserved > 0) AS currently_reserved
    FROM listings.listings l
    LEFT JOIN auctions.auctions a ON a.listing_id = l.id
   WHERE l.status = 'active' AND l.seller_visible
     AND (l.sale_format = 'fixed_price' OR a.status = 'open');

-- =====================================================================
-- Grants (SEC-INF-03)
-- =====================================================================
GRANT USAGE ON SCHEMA listings, auctions TO tb_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA listings, auctions TO tb_app;
REVOKE UPDATE ON listings.clarifications, listings.status_history, listings.stock_moves FROM tb_app;
GRANT SELECT ON listings.searchable TO tb_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA listings, auctions TO tb_app;
