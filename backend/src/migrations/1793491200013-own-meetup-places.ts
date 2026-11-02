import { MigrationInterface, QueryRunner } from 'typeorm';

// Unit 4, U4-03 follow-up (Decisions log, 2026-11-02). Runs as tb_owner (SEC-INF-03).
//   FR-DLV-04: either party may propose a meetup point; besides the curated points suggested under FR-DLV-03, a
//   proposal may name a place of the parties' own (a name and an optional map pin in Bangladesh), which the other
//   party must still accept. docs/design/sql/04_delivery.sql holds the result (table, guard, propose_meetup,
//   respond_meetup, as copied here); this migration brings a database migrated before it to the same schema.
export class OwnMeetupPlaces1793491200013 implements MigrationInterface {
  name = 'OwnMeetupPlaces1793491200013';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(SQL);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DELETE FROM delivery.meetup_proposals WHERE point_id IS NULL;
      ALTER TABLE delivery.meetup_proposals DROP CONSTRAINT proposal_one_place, DROP CONSTRAINT proposal_own_place, DROP CONSTRAINT proposal_pin,
        DROP COLUMN place_name, DROP COLUMN place_lat, DROP COLUMN place_lng, ALTER COLUMN point_id SET NOT NULL;`);
  }
}

const SQL = String.raw`-- U4-03 follow-up (Decisions log, 2026-11-02): a proposal names a suggested point or a place of the parties' own.
ALTER TABLE delivery.meetup_proposals
  ALTER COLUMN point_id DROP NOT NULL,
  ADD COLUMN place_name varchar(120),
  ADD COLUMN place_lat numeric(8,5) CHECK (place_lat BETWEEN 20.0 AND 27.0),
  ADD COLUMN place_lng numeric(8,5) CHECK (place_lng BETWEEN 88.0 AND 93.0),
  ADD CONSTRAINT proposal_one_place CHECK ((point_id IS NULL) <> (place_name IS NULL)),
  ADD CONSTRAINT proposal_own_place CHECK (place_name IS NULL OR (length(btrim(place_name)) >= 3 AND place_name !~ '[\x01-\x1F\x7F]')),
  ADD CONSTRAINT proposal_pin CHECK ((place_lat IS NULL) = (place_lng IS NULL) AND (place_name IS NOT NULL OR place_lat IS NULL));

CREATE OR REPLACE FUNCTION delivery.proposal_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'proposed' THEN RAISE EXCEPTION 'a proposal starts as proposed' USING ERRCODE = 'check_violation'; END IF;
    RETURN NEW;
  END IF;
  IF (NEW.order_id, NEW.proposed_by, NEW.point_id, NEW.place_name, NEW.place_lat, NEW.place_lng, NEW.meet_at, NEW.note, NEW.created_at)
     IS DISTINCT FROM (OLD.order_id, OLD.proposed_by, OLD.point_id, OLD.place_name, OLD.place_lat, OLD.place_lng, OLD.meet_at, OLD.note, OLD.created_at) THEN
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

-- the signature gains the own place: the old function is replaced, not overloaded
DROP FUNCTION delivery.propose_meetup(uuid, uuid, uuid, timestamptz, varchar, interval, interval);
CREATE FUNCTION delivery.propose_meetup(p_order uuid, p_user uuid, p_point uuid, p_meet_at timestamptz,
                                        p_note varchar, p_lead interval, p_buffer interval,
                                        p_place_name varchar DEFAULT NULL, p_place_lat numeric DEFAULT NULL,
                                        p_place_lng numeric DEFAULT NULL)
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
  IF p_point IS NULL AND p_place_name IS NULL THEN
    RAISE EXCEPTION 'a meetup needs a suggested point or a place of your own' USING ERRCODE = 'check_violation';
  END IF;
  IF p_point IS NOT NULL AND NOT EXISTS (SELECT 1 FROM delivery.meetup_points WHERE id = p_point AND active) THEN
    RAISE EXCEPTION 'not an active meetup point' USING ERRCODE = 'check_violation';
  END IF;
  IF p_meet_at < now() + p_lead OR p_meet_at > h.due_at - p_buffer THEN
    RAISE EXCEPTION 'meetup time must be between % from now and % before the handover deadline', p_lead, p_buffer
      USING ERRCODE = 'check_violation';
  END IF;
  UPDATE delivery.meetup_proposals SET status = 'superseded', responded_at = now()
   WHERE order_id = p_order AND status = 'proposed';
  INSERT INTO delivery.meetup_proposals (order_id, proposed_by, point_id, place_name, place_lat, place_lng, meet_at, note)
  VALUES (p_order, p_user, p_point, p_place_name, p_place_lat, p_place_lng, p_meet_at, p_note) RETURNING id INTO pid;
  INSERT INTO delivery.outbox (event_type, aggregate_id, payload)
  VALUES ('delivery.meetup.proposed', p_order, jsonb_build_object('proposalId', pid, 'by', p_user, 'meetAt', p_meet_at, 'ownPlace', p_point IS NULL));
  RETURN pid;
END $$;

CREATE OR REPLACE FUNCTION delivery.respond_meetup(p_proposal uuid, p_user uuid, p_accept boolean)
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
  VALUES ('delivery.meetup.agreed', p.order_id, jsonb_build_object('proposalId', p_proposal, 'pointId', p.point_id, 'ownPlace', p.point_id IS NULL, 'meetAt', p.meet_at));
  RETURN 'accepted';
END $$;

GRANT EXECUTE ON FUNCTION delivery.propose_meetup(uuid, uuid, uuid, timestamptz, varchar, interval, interval, varchar, numeric, numeric) TO tb_app;
`;
