-- =====================================================================
-- TrustBazaar - Unit 2: Order, Payment & Escrow - PostgreSQL 15 schema
-- Design document: docs/design/02_orders_payments.pdf
-- Requirements: SRS v2.0 FR-PAY-01..21, FR-FIX-01..05 (order side),
--   FR-AUC-14/15 (order side), FR-DLV-11..13 and FR-GAM-10/17 (escrow
--   side), FR-DSP-02/06/10/11 (escrow side), FR-MON-01..10, FR-TNS-05/07,
--   SEC-PAY-01..07.
-- Depends on: 01_identity_access.sql (identity.users, identity.staff_accounts,
--   identity.forbid_change, audit.actor_type).
-- Conventions as Unit 1 (DC-4): random UUID keys, timestamptz, money as
-- bigint poisha (1 BDT = 100 poisha), invariants enforced in the database.
-- References to later units (listings, delivery, disputes) are plain UUIDs
-- without foreign keys (DC-5).
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS orders;
CREATE SCHEMA IF NOT EXISTS payments;

-- ---------------------------------------------------------------- types
CREATE TYPE orders.order_kind     AS ENUM ('fixed_price', 'auction', 'second_chance');
CREATE TYPE orders.item_kind      AS ENUM ('physical', 'game_account');
CREATE TYPE orders.fulfilment     AS ENUM ('self_pickup', 'courier', 'game_account');
CREATE TYPE orders.order_status   AS ENUM ('awaiting_payment', 'cancelled', 'paid', 'closed');
CREATE TYPE orders.cancel_reason  AS ENUM
  ('checkout_expired', 'payment_window_expired', 'buyer_abandoned', 'listing_withdrawn');
CREATE TYPE orders.escrow_state   AS ENUM
  ('held', 'frozen_disputed', 'released', 'refunded', 'partially_refunded');      -- FR-PAY-06
CREATE TYPE orders.release_policy AS ENUM ('standard', 'game_protection');      -- FR-GAM-17
CREATE TYPE orders.fulfilment_step AS ENUM
  ('meetup_handover', 'courier_pickup', 'credentials_delivered');               -- FR-PAY-08
CREATE TYPE orders.delivery_source AS ENUM
  ('handover_code', 'courier_delivered', 'game_takeover');                     -- delivery event
CREATE TYPE orders.cancel_request_status AS ENUM ('pending', 'accepted', 'declined', 'lapsed');

CREATE TYPE payments.provider       AS ENUM ('bkash', 'nagad', 'stripe');
CREATE TYPE payments.purpose        AS ENUM ('order', 'featured_listing', 'subscription');
CREATE TYPE payments.attempt_status AS ENUM
  ('created', 'redirected', 'succeeded', 'failed', 'cancelled', 'expired',
   'succeeded_duplicate',    -- a second successful payment for an already-paid order: refunded
   'succeeded_rejected');    -- succeeded at the provider but not accepted (mismatch or late): refunded
CREATE TYPE payments.refund_reason AS ENUM
  ('fulfilment_deadline', 'cancellation', 'dispute_full', 'dispute_partial', 'courier_returned',
   'duplicate_payment', 'amount_mismatch', 'late_payment', 'fee_refund');
CREATE TYPE payments.refund_status AS ENUM ('pending', 'sent', 'succeeded', 'failed', 'manual_required');
CREATE TYPE payments.payout_account_kind   AS ENUM ('bkash_wallet', 'nagad_wallet', 'bank');
CREATE TYPE payments.payout_account_status AS ENUM
  ('pending_review', 'cooling_off', 'active', 'rejected', 'replaced');
CREATE TYPE payments.payout_status AS ENUM
  ('waiting_account', 'waiting_cooling_off', 'held', 'pending', 'sent', 'failed');
CREATE TYPE payments.entry_kind AS ENUM
  ('payment_received', 'escrow_release', 'escrow_refund', 'escrow_partial', 'refund_paid',
   'payout_sent', 'courier_settled', 'fee_received', 'courier_return_charge',
   'chargeback', 'chargeback_recovery');

-- =====================================================================
-- Orders (FR-FIX, FR-AUC-14/15, FR-MON-10, DR-03)
-- =====================================================================
CREATE TABLE orders.orders (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                   orders.order_kind NOT NULL,
  listing_id             uuid NOT NULL,                        -- Listings unit (no FK, DC-5)
  item_kind              orders.item_kind NOT NULL,
  buyer_id               uuid NOT NULL REFERENCES identity.users(id),
  seller_id              uuid NOT NULL REFERENCES identity.users(id),
  quantity               integer NOT NULL CHECK (quantity >= 1),
  unit_price             bigint  NOT NULL CHECK (unit_price > 0),
  item_price             bigint  NOT NULL,
  fulfilment             orders.fulfilment,                    -- chosen before payment
  delivery_quote_id      uuid,                                 -- Delivery unit quote, fixed at checkout
  delivery_fee           bigint  NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0),
  total                  bigint  NOT NULL,
  -- snapshot of the listing and of the fee rules when the order was created (DR-03, FR-MON-10, FR-OPS-08)
  listing_snapshot       jsonb   NOT NULL,
  commission_bps         integer NOT NULL CHECK (commission_bps BETWEEN 0 AND 5000),     -- 500 = 5 %
  delivery_margin_bps    integer NOT NULL CHECK (delivery_margin_bps BETWEEN 0 AND 5000),
  params_version         integer NOT NULL,
  status                 orders.order_status NOT NULL DEFAULT 'awaiting_payment',
  payment_due_at         timestamptz NOT NULL,                 -- CP-13 checkout hold or CP-10/CP-11 window
  paid_at                timestamptz,
  fulfilment_step        orders.fulfilment_step,               -- which step must happen by fulfilment_due_at
  fulfilment_due_at      timestamptz,
  fulfilment_done_at     timestamptz,
  delivery_event_at      timestamptz,
  delivery_event_source  orders.delivery_source,
  cancelled_at           timestamptz,
  cancel_reason          orders.cancel_reason,
  closed_at              timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT buyer_not_seller CHECK (buyer_id <> seller_id),                                              -- FR-FIX-01, FR-AUC-02
  CONSTRAINT item_price_matches CHECK (item_price = unit_price * quantity),
  CONSTRAINT total_matches CHECK (total = item_price + delivery_fee),
  CONSTRAINT auction_single_unit CHECK (kind = 'fixed_price' OR quantity = 1),                               -- FR-LST-05
  -- fee only for courier (FR-DLV-02, FR-GAM-06)
  CONSTRAINT fee_only_for_courier CHECK (fulfilment IS NOT DISTINCT FROM 'courier' OR delivery_fee = 0),
  CONSTRAINT courier_needs_quote CHECK (fulfilment IS DISTINCT FROM 'courier' OR delivery_quote_id IS NOT NULL),
  -- game accounts are fulfilled only by the game-account handover, and only they are
  CONSTRAINT game_fulfilment_matches CHECK (fulfilment IS NULL OR ((item_kind = 'game_account') = (fulfilment = 'game_account'))),
  -- payment requires a chosen fulfilment method
  CONSTRAINT paid_needs_fulfilment CHECK (status IN ('awaiting_payment', 'cancelled') OR fulfilment IS NOT NULL),
  CONSTRAINT paid_at_matches_status CHECK ((status IN ('paid', 'closed')) = (paid_at IS NOT NULL)),
  CONSTRAINT cancel_fields CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL AND cancel_reason IS NOT NULL)),
  CONSTRAINT closed_fields CHECK ((status = 'closed') = (closed_at IS NOT NULL)),
  CONSTRAINT paid_needs_deadline CHECK (paid_at IS NULL OR (fulfilment_step IS NOT NULL AND fulfilment_due_at IS NOT NULL)),
  CONSTRAINT done_after_paid CHECK (fulfilment_done_at IS NULL OR paid_at IS NOT NULL),
  CONSTRAINT delivery_event_fields CHECK ((delivery_event_at IS NULL) = (delivery_event_source IS NULL)),
  CONSTRAINT delivery_after_fulfilment CHECK (delivery_event_at IS NULL OR fulfilment_done_at IS NOT NULL)
);
CREATE INDEX orders_buyer   ON orders.orders (buyer_id, created_at DESC);
CREATE INDEX orders_seller  ON orders.orders (seller_id, created_at DESC);
CREATE INDEX orders_listing ON orders.orders (listing_id);
-- scheduled jobs (NFR-REL-03): each scans only rows that are due
CREATE INDEX orders_due_payment     ON orders.orders (payment_due_at)    WHERE status = 'awaiting_payment';
CREATE INDEX orders_due_fulfilment  ON orders.orders (fulfilment_due_at) WHERE status = 'paid' AND fulfilment_done_at IS NULL;
-- an auction listing has at most one live (unpaid or paid) order (FR-AUC-14/15)
CREATE UNIQUE INDEX orders_one_live_auction ON orders.orders (listing_id)
  WHERE kind IN ('auction', 'second_chance') AND status IN ('awaiting_payment', 'paid', 'closed');

-- =====================================================================
-- Escrow (FR-PAY-05..11, Table 4.8 of the SRS)
-- =====================================================================
CREATE TABLE orders.escrows (
  order_id          uuid PRIMARY KEY REFERENCES orders.orders(id),
  state             orders.escrow_state NOT NULL DEFAULT 'held',
  release_policy    orders.release_policy NOT NULL,
  amount_collected  bigint NOT NULL CHECK (amount_collected > 0),
  amount_released   bigint NOT NULL DEFAULT 0 CHECK (amount_released >= 0),   -- to seller, courier and platform
  amount_refunded   bigint NOT NULL DEFAULT 0 CHECK (amount_refunded >= 0),   -- to buyer
  dispute_window_ends_at timestamptz,          -- delivery event + CP-18 (physical) / + CP-24 (game)
  auto_release_at   timestamptz,               -- delivery event + CP-19 (physical) / + CP-24 (game)
  open_dispute_id   uuid,                      -- Disputes unit (no FK)
  created_at        timestamptz NOT NULL DEFAULT now(),
  terminal_at       timestamptz,
  CONSTRAINT escrow_amount_cap CHECK (amount_released + amount_refunded <= amount_collected),
  -- amounts match the state
  CONSTRAINT escrow_open_no_amounts CHECK (state NOT IN ('held', 'frozen_disputed') OR (amount_released = 0 AND amount_refunded = 0)),
  CONSTRAINT escrow_terminal_sums CHECK (state NOT IN ('released', 'refunded', 'partially_refunded')
         OR amount_released + amount_refunded = amount_collected),
  CONSTRAINT escrow_released_no_refund CHECK (state <> 'released' OR amount_refunded = 0),
  CONSTRAINT escrow_refunded_no_release CHECK (state <> 'refunded' OR amount_released = 0),
  CONSTRAINT escrow_partial_both CHECK (state <> 'partially_refunded' OR (amount_released > 0 AND amount_refunded > 0)),
  CONSTRAINT escrow_terminal_time CHECK ((state IN ('released', 'refunded', 'partially_refunded')) = (terminal_at IS NOT NULL)),
  CONSTRAINT escrow_frozen_has_dispute CHECK ((state = 'frozen_disputed') = (open_dispute_id IS NOT NULL)),
  CONSTRAINT escrow_window_before_release CHECK (dispute_window_ends_at IS NULL OR auto_release_at IS NULL OR dispute_window_ends_at <= auto_release_at)
);
CREATE INDEX escrow_auto_release ON orders.escrows (auto_release_at) WHERE state = 'held' AND auto_release_at IS NOT NULL;

-- permitted transitions only (FR-PAY-06); any other is refused
CREATE FUNCTION orders.check_escrow_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'held' THEN
      RAISE EXCEPTION 'escrow must start in held' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    IF NOT ((OLD.state, NEW.state) IN (
        ('held'::orders.escrow_state, 'released'::orders.escrow_state),
        ('held',            'refunded'),
        ('held',            'frozen_disputed'),
        ('frozen_disputed', 'released'),
        ('frozen_disputed', 'refunded'),
        ('frozen_disputed', 'partially_refunded'),
        ('frozen_disputed', 'held'))) THEN
      RAISE EXCEPTION 'escrow % -> % is not permitted', OLD.state, NEW.state
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF OLD.state IN ('released', 'refunded', 'partially_refunded') THEN
    RAISE EXCEPTION 'escrow is terminal' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.amount_collected <> OLD.amount_collected THEN
    RAISE EXCEPTION 'amount_collected is fixed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER escrow_transition BEFORE INSERT OR UPDATE ON orders.escrows
  FOR EACH ROW EXECUTE FUNCTION orders.check_escrow_transition();

CREATE TABLE orders.escrow_history (                                          -- FR-PAY-10, append-only
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id      uuid NOT NULL REFERENCES orders.orders(id),
  from_state    orders.escrow_state,                     -- NULL for creation
  to_state      orders.escrow_state NOT NULL,
  actor_type    audit.actor_type NOT NULL,
  actor_id      uuid,
  reason        text NOT NULL,
  amount_released bigint NOT NULL DEFAULT 0,
  amount_refunded bigint NOT NULL DEFAULT 0,
  related_id    uuid,                                    -- dispute, approval, refund ...
  at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX escrow_hist_order ON orders.escrow_history (order_id, at);
CREATE TRIGGER escrow_history_append_only BEFORE UPDATE OR DELETE ON orders.escrow_history
  FOR EACH ROW EXECUTE FUNCTION identity.forbid_change();

CREATE TABLE orders.cancellation_requests (                                   -- FR-PAY-09
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      uuid NOT NULL REFERENCES orders.orders(id),
  requested_by  uuid NOT NULL REFERENCES identity.users(id),
  reason        varchar(500) NOT NULL,
  status        orders.cancel_request_status NOT NULL DEFAULT 'pending',
  created_at    timestamptz NOT NULL DEFAULT now(),
  decided_at    timestamptz,
  CHECK ((status = 'pending') = (decided_at IS NULL))
);
CREATE UNIQUE INDEX cancel_one_pending ON orders.cancellation_requests (order_id) WHERE status = 'pending';

CREATE TABLE orders.outbox (                                                  -- DC-6
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_type      varchar(80) NOT NULL CHECK (event_type ~ '^(orders|payments)\.[a-z_]+\.[a-z_]+$'),
  aggregate_id    uuid NOT NULL,
  payload         jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  attempts        smallint NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  dispatched_at   timestamptz
);
CREATE INDEX orders_outbox_pending ON orders.outbox (next_attempt_at) WHERE dispatched_at IS NULL;

-- =====================================================================
-- Payment attempts and provider events (FR-PAY-01..04, SEC-PAY-03/04/07)
-- =====================================================================
CREATE TABLE payments.attempts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),   -- also the merchant reference sent to the provider
  purpose              payments.purpose NOT NULL,
  order_id             uuid REFERENCES orders.orders(id),
  subject_id           uuid,                                         -- featured listing or subscription
  payer_id             uuid NOT NULL REFERENCES identity.users(id),
  provider             payments.provider NOT NULL,
  amount               bigint NOT NULL CHECK (amount > 0),           -- computed on the server (SEC-PAY-06)
  currency             char(3) NOT NULL DEFAULT 'BDT' CHECK (currency = 'BDT'),
  idempotency_key      uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  provider_payment_id  varchar(120),
  provider_txn_id      varchar(120),                                 -- needed for refunds
  status               payments.attempt_status NOT NULL DEFAULT 'created',
  created_at           timestamptz NOT NULL DEFAULT now(),
  expires_at           timestamptz NOT NULL,
  confirmed_at         timestamptz,
  failure_code         varchar(60),
  CHECK ((purpose = 'order') = (order_id IS NOT NULL)),
  CHECK (purpose = 'order' OR subject_id IS NOT NULL),
  CHECK ((status IN ('succeeded', 'succeeded_duplicate', 'succeeded_rejected')) = (confirmed_at IS NOT NULL))
);
CREATE UNIQUE INDEX attempts_provider_ref ON payments.attempts (provider, provider_payment_id) WHERE provider_payment_id IS NOT NULL;
-- acceptance criterion 4: an order can be paid only once
CREATE UNIQUE INDEX attempts_one_success_per_order ON payments.attempts (order_id) WHERE status = 'succeeded';
CREATE INDEX attempts_inflight ON payments.attempts (created_at) WHERE status IN ('created', 'redirected');

CREATE TABLE payments.provider_events (                                       -- SEC-PAY-04
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider       payments.provider NOT NULL,
  event_id       varchar(160) NOT NULL,          -- provider's event id, or a derived id for query results
  event_type     varchar(80)  NOT NULL,
  verified_by    varchar(20)  NOT NULL CHECK (verified_by IN ('signature', 'query')),
  attempt_id     uuid REFERENCES payments.attempts(id),
  payload_sha256 bytea NOT NULL CHECK (octet_length(payload_sha256) = 32),
  received_at    timestamptz NOT NULL DEFAULT now(),
  processed_at   timestamptz,
  UNIQUE (provider, event_id)                    -- a replayed event cannot be processed twice
);

-- =====================================================================
-- Refunds (FR-PAY-11/12)
-- =====================================================================
CREATE TABLE payments.refunds (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id         uuid NOT NULL REFERENCES payments.attempts(id),   -- refunded to the original payment
  order_id           uuid REFERENCES orders.orders(id),
  amount             bigint NOT NULL CHECK (amount > 0),
  reason             payments.refund_reason NOT NULL,
  idempotency_key    uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  status             payments.refund_status NOT NULL DEFAULT 'pending',
  provider_refund_id varchar(120),
  attempts_made      smallint NOT NULL DEFAULT 0,
  next_attempt_at    timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  completed_at       timestamptz,
  CHECK ((status = 'succeeded') = (completed_at IS NOT NULL))
);
CREATE INDEX refunds_due ON payments.refunds (next_attempt_at) WHERE status IN ('pending', 'failed');

-- the total refunded from one payment can never exceed that payment
CREATE FUNCTION payments.check_refund_cap() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE paid bigint; refunded bigint;
BEGIN
  SELECT amount INTO paid FROM payments.attempts WHERE id = NEW.attempt_id FOR UPDATE;
  SELECT coalesce(sum(amount), 0) INTO refunded FROM payments.refunds
   WHERE attempt_id = NEW.attempt_id AND id <> NEW.id AND status <> 'manual_required';
  IF refunded + NEW.amount > paid THEN
    RAISE EXCEPTION 'refunds (% + %) exceed payment %', refunded, NEW.amount, paid
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER refund_cap BEFORE INSERT OR UPDATE OF amount ON payments.refunds
  FOR EACH ROW EXECUTE FUNCTION payments.check_refund_cap();

-- =====================================================================
-- Payout accounts and payouts (FR-PAY-17..19, FR-TNS-05)
-- =====================================================================
CREATE TABLE payments.payout_accounts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES identity.users(id),
  kind               payments.payout_account_kind NOT NULL,
  wallet_e164        varchar(16) CHECK (wallet_e164 ~ '^\+8801[3-9][0-9]{8}$'),
  bank_name          varchar(80),
  branch_name        varchar(80),
  routing_number     varchar(9)  CHECK (routing_number ~ '^[0-9]{9}$'),
  account_name       varchar(120),
  account_number_enc bytea,                                  -- AES-256-GCM (Unit 1 field key)
  account_last4      char(4),
  status             payments.payout_account_status NOT NULL,
  effective_at       timestamptz,                            -- end of cooling-off CP-29
  reviewed_by        uuid REFERENCES identity.staff_accounts(id),
  reviewed_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  replaced_at        timestamptz,
  CONSTRAINT bank_fields CHECK ((kind = 'bank') = (bank_name IS NOT NULL AND routing_number IS NOT NULL
                            AND account_name IS NOT NULL AND account_number_enc IS NOT NULL)),
  CONSTRAINT wallet_fields CHECK ((kind <> 'bank') = (wallet_e164 IS NOT NULL)),
  CONSTRAINT review_only_bank CHECK (status <> 'pending_review' OR kind = 'bank'),        -- only bank accounts need the name check
  CONSTRAINT usable_has_effective CHECK (status NOT IN ('cooling_off', 'active') OR effective_at IS NOT NULL),
  CONSTRAINT bank_reviewed CHECK (kind <> 'bank' OR status NOT IN ('cooling_off', 'active') OR reviewed_by IS NOT NULL)
);
-- one usable (or pending) payout account per seller
CREATE UNIQUE INDEX payout_account_one_current ON payments.payout_accounts (user_id)
  WHERE status IN ('pending_review', 'cooling_off', 'active');

CREATE TABLE payments.payouts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id           uuid NOT NULL UNIQUE REFERENCES orders.orders(id),   -- one payout per order
  seller_id          uuid NOT NULL REFERENCES identity.users(id),
  payout_account_id  uuid REFERENCES payments.payout_accounts(id),
  amount             bigint NOT NULL CHECK (amount > 0),
  status             payments.payout_status NOT NULL,
  hold_reason        varchar(120),
  simulated          boolean NOT NULL,                       -- true in the academic deliverable (FR-PAY-19)
  idempotency_key    uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  provider_ref       varchar(120),
  attempts_made      smallint NOT NULL DEFAULT 0,
  next_attempt_at    timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  sent_at            timestamptz,
  CONSTRAINT payout_sent_time CHECK ((status = 'sent') = (sent_at IS NOT NULL)),
  CONSTRAINT payout_needs_account CHECK (status IN ('waiting_account', 'held') OR payout_account_id IS NOT NULL),
  CONSTRAINT payout_hold_reason CHECK ((status = 'held') = (hold_reason IS NOT NULL))
);
CREATE INDEX payouts_due ON payments.payouts (next_attempt_at) WHERE status IN ('pending', 'failed', 'waiting_cooling_off');

-- =====================================================================
-- Double-entry ledger (FR-PAY-12/13/14, FR-MON-09, DR-05)
-- Debits are positive, credits negative; every entry sums to zero.
-- =====================================================================
CREATE TABLE payments.ledger_accounts (
  code         varchar(40) PRIMARY KEY,
  kind         varchar(10) NOT NULL CHECK (kind IN ('asset', 'liability', 'revenue', 'expense')),
  description  text NOT NULL
);
INSERT INTO payments.ledger_accounts (code, kind, description) VALUES
  ('provider_clearing',       'asset',     'Funds held at payment providers (per provider in line.party)'),
  ('payout_clearing',         'asset',     'Funds sent out to sellers and couriers, awaiting provider settlement'),
  ('seller_receivable',       'asset',     'Amounts owed back by sellers (chargebacks)'),
  ('escrow_liability',        'liability', 'Buyer money held in escrow, per order'),
  ('seller_payable',          'liability', 'Released money owed to sellers'),
  ('courier_payable',         'liability', 'Delivery fees owed to couriers'),
  ('buyer_refund_payable',    'liability', 'Refunds owed to buyers'),
  ('revenue_commission',      'revenue',   'Transaction commission (FR-MON-01)'),
  ('revenue_delivery_margin', 'revenue',   'Delivery margin (FR-MON-03)'),
  ('revenue_featured',        'revenue',   'Featured listing fees (FR-MON-05)'),
  ('revenue_subscription',    'revenue',   'Pro Seller subscriptions (FR-MON-06)'),
  ('expense_courier_returns', 'expense',   'Courier charges for failed deliveries (FR-DLV-12)');

CREATE TABLE payments.journal_entries (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind        payments.entry_kind NOT NULL,
  order_id    uuid REFERENCES orders.orders(id),
  source_id   uuid,                        -- attempt, refund, payout ...
  memo        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX journal_order ON payments.journal_entries (order_id);

CREATE TABLE payments.journal_lines (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entry_id      bigint NOT NULL REFERENCES payments.journal_entries(id),
  account_code  varchar(40) NOT NULL REFERENCES payments.ledger_accounts(code),
  party_id      uuid,                      -- user, provider-specific clearing, courier ...
  amount        bigint NOT NULL CHECK (amount <> 0)
);
CREATE INDEX journal_lines_entry ON payments.journal_lines (entry_id);
CREATE INDEX journal_lines_account ON payments.journal_lines (account_code, party_id);

-- every journal entry must balance; checked at commit, so lines can be inserted one by one
CREATE FUNCTION payments.check_entry_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s bigint; n int;
BEGIN
  SELECT coalesce(sum(amount), 0), count(*) INTO s, n FROM payments.journal_lines WHERE entry_id = NEW.entry_id;
  IF n < 2 OR s <> 0 THEN
    RAISE EXCEPTION 'journal entry % does not balance (lines %, sum %)', NEW.entry_id, n, s
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER journal_balanced AFTER INSERT ON payments.journal_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION payments.check_entry_balanced();
CREATE TRIGGER journal_entries_append_only BEFORE UPDATE OR DELETE ON payments.journal_entries
  FOR EACH ROW EXECUTE FUNCTION identity.forbid_change();
CREATE TRIGGER journal_lines_append_only BEFORE UPDATE OR DELETE ON payments.journal_lines
  FOR EACH ROW EXECUTE FUNCTION identity.forbid_change();

-- =====================================================================
-- Settlement record per order (FR-PAY-13/14) and the fee calculation
-- =====================================================================
CREATE TABLE payments.settlements (
  order_id          uuid PRIMARY KEY REFERENCES orders.orders(id),
  amount_collected  bigint NOT NULL CHECK (amount_collected > 0),
  item_price        bigint NOT NULL CHECK (item_price > 0),
  delivery_fee      bigint NOT NULL CHECK (delivery_fee >= 0),
  commission        bigint NOT NULL CHECK (commission >= 0),
  courier_payout    bigint NOT NULL CHECK (courier_payout >= 0),
  delivery_margin   bigint NOT NULL CHECK (delivery_margin >= 0),
  seller_payout     bigint NOT NULL CHECK (seller_payout >= 0),
  refund_total      bigint NOT NULL CHECK (refund_total >= 0),
  commission_bps    integer NOT NULL,
  delivery_margin_bps integer NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT settlement_collected CHECK (amount_collected = item_price + delivery_fee),
  CONSTRAINT settlement_parts_sum CHECK (commission + courier_payout + delivery_margin + seller_payout + refund_total = amount_collected),
  CONSTRAINT settlement_fee_parts CHECK (courier_payout + delivery_margin <= delivery_fee)
);
CREATE TRIGGER settlements_append_only BEFORE UPDATE OR DELETE ON payments.settlements
  FOR EACH ROW EXECUTE FUNCTION identity.forbid_change();

-- Reference implementation of the split (FR-PAY-11, FR-PAY-14, FR-MON-01, FR-DLV-13).
-- The application implements the same rules; tests compare the two.
--   item_refund : part of the item price refunded to the buyer (0 .. item_price)
--   courier_done: true if the courier picked the item up. If it did, the delivery fee is earned
--                 (courier payout + margin); if not, the whole fee goes back to the buyer.
-- The parts therefore always add up to item_price + delivery_fee.
CREATE FUNCTION payments.split(item_price bigint, delivery_fee bigint, item_refund bigint, courier_done boolean,
                               commission_bps int, margin_bps int)
RETURNS TABLE (commission bigint, courier_payout bigint, delivery_margin bigint,
               seller_payout bigint, refund_total bigint)
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  released bigint;
BEGIN
  IF item_refund < 0 OR item_refund > item_price THEN
    RAISE EXCEPTION 'item refund % out of range 0..%', item_refund, item_price;
  END IF;
  released   := item_price - item_refund;                            -- refund comes from the item price first
  commission := (released * commission_bps + 5000) / 10000;          -- half-up to the poisha
  IF courier_done THEN
    delivery_margin := (delivery_fee * margin_bps + 5000) / 10000;
    courier_payout  := delivery_fee - delivery_margin;
    refund_total    := item_refund;
  ELSE
    delivery_margin := 0;
    courier_payout  := 0;
    refund_total    := item_refund + delivery_fee;
  END IF;
  seller_payout := released - commission;                              -- remainder, calculated last
  RETURN NEXT;
END $$;

-- =====================================================================
-- Chargebacks (FR-PAY-20, Could), reconciliation issues (FR-PAY-15)
-- =====================================================================
CREATE TABLE payments.chargebacks (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id        uuid NOT NULL REFERENCES payments.attempts(id),
  provider_case_id  varchar(120) NOT NULL UNIQUE,
  amount            bigint NOT NULL CHECK (amount > 0),
  status            varchar(20) NOT NULL CHECK (status IN ('open', 'lost', 'won', 'recovered')),
  recovered_amount  bigint NOT NULL DEFAULT 0 CHECK (recovered_amount >= 0),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (recovered_amount <= amount)
);

CREATE TABLE payments.reconciliation_issues (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         varchar(40) NOT NULL CHECK (kind IN
               ('amount_mismatch', 'late_payment', 'duplicate_payment', 'refund_failed', 'payout_failed',
                'provider_disagrees', 'stalled_delivery', 'manual_refund_required')),
  order_id     uuid REFERENCES orders.orders(id),
  attempt_id   uuid REFERENCES payments.attempts(id),
  refund_id    uuid REFERENCES payments.refunds(id),
  payout_id    uuid REFERENCES payments.payouts(id),
  detail       jsonb NOT NULL,
  status       varchar(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  resolved_by  uuid REFERENCES identity.staff_accounts(id),
  resolved_at  timestamptz,
  resolution   text,
  CHECK ((status = 'resolved') = (resolved_by IS NOT NULL AND resolved_at IS NOT NULL AND resolution IS NOT NULL))
);
CREATE INDEX recon_open ON payments.reconciliation_issues (created_at) WHERE status = 'open';

-- =====================================================================
-- Monetization: featured listings and Pro Seller subscriptions (Could)
-- =====================================================================
CREATE TABLE payments.featured_purchases (                                   -- FR-MON-05
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id   uuid NOT NULL,                       -- Listings unit (no FK)
  seller_id    uuid NOT NULL REFERENCES identity.users(id),
  hours        smallint NOT NULL CHECK (hours IN (24, 48)),                -- CP-37
  fee          bigint NOT NULL CHECK (fee > 0),
  attempt_id   uuid REFERENCES payments.attempts(id),
  starts_at    timestamptz,
  ends_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK ((starts_at IS NULL) = (ends_at IS NULL)),
  CHECK (ends_at IS NULL OR ends_at = starts_at + make_interval(hours => hours))
);

CREATE TABLE payments.subscriptions (                                         -- FR-MON-06..08
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES identity.users(id),
  status                varchar(12) NOT NULL CHECK (status IN ('active', 'past_due', 'cancelled', 'lapsed')),
  current_period_end    timestamptz NOT NULL,
  provider              payments.provider NOT NULL,
  provider_subscription_id varchar(120),          -- Stripe only; MFS renewals are paid each month
  failed_renewals       smallint NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  cancelled_at          timestamptz
);
CREATE UNIQUE INDEX subscription_one_live ON payments.subscriptions (user_id) WHERE status IN ('active', 'past_due');

-- revenue log (FR-MON-09): every line on a revenue account, separate from settlements
CREATE VIEW payments.revenue_log AS
  SELECT e.id AS entry_id, e.created_at, e.kind, e.order_id, l.account_code, -l.amount AS revenue
    FROM payments.journal_entries e JOIN payments.journal_lines l ON l.entry_id = e.id
   WHERE l.account_code LIKE 'revenue\_%';

-- =====================================================================
-- Grants (SEC-INF-03). The application role cannot change schema or rewrite history.
-- =====================================================================
GRANT USAGE ON SCHEMA orders, payments TO tb_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA orders, payments TO tb_app;
REVOKE UPDATE ON orders.escrow_history, payments.journal_entries, payments.journal_lines,
                 payments.settlements, payments.ledger_accounts FROM tb_app;
GRANT SELECT ON payments.revenue_log TO tb_app;
GRANT EXECUTE ON FUNCTION payments.split(bigint, bigint, bigint, boolean, int, int) TO tb_app;
