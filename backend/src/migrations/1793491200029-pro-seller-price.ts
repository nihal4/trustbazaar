import { MigrationInterface, QueryRunner } from 'typeorm';

// Unit 2, U2-06 (Decisions log, 2026-11-17; agreed with the user). Runs as tb_owner (SEC-INF-03).
//   FR-MON-06: the Pro Seller subscription's monthly price is the new parameter CP-48 ({"monthly_poisha": n}; null
//   means not offered yet). The SRS has no parameter for it; the placeholder is BDT 500 until the team agrees the fees.
//   Configuration versions are append-only and a new one needs a staff member, so CP-48 is added to every existing
//   version: each version stays complete, and an order's own version answers it too. staff.config_violations gains
//   its rule. docs/design/sql/07_disputes_trust_staff.sql holds the result (CP-48 in the seeded version 1).
export class ProSellerPrice1793491200029 implements MigrationInterface {
  name = 'ProSellerPrice1793491200029';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`INSERT INTO staff.config_values (version, code, value)
      SELECT version, 'CP-48', '{"monthly_poisha":50000}'::jsonb FROM staff.config_versions
      ON CONFLICT (version, code) DO NOTHING`);
    await q.query(VIOLATIONS);
  }

  public async down(q: QueryRunner): Promise<void> {
    // the values are append-only (staff.config_values refuses DELETE); down restores only the rule
    await q.query(VIOLATIONS_BEFORE);
  }
}

const VIOLATIONS = String.raw`
CREATE OR REPLACE FUNCTION staff.config_violations(c jsonb, prev jsonb) RETURNS text[] LANGUAGE plpgsql STABLE AS $$
DECLARE v text[] := '{}';
BEGIN
  IF (c #>> '{CP-01,access}')::interval NOT BETWEEN interval '5 minutes' AND interval '30 minutes' THEN v := v || 'CP-01 must be 5-30 minutes'::text; END IF;
  IF (c #>> '{CP-02,idle}')::interval > (c #>> '{CP-02,absolute}')::interval THEN v := v || 'CP-02 idle must not exceed absolute'::text; END IF;
  IF (c #>> '{CP-03,idle}')::interval > interval '30 minutes' THEN v := v || 'CP-03 staff idle must be at most 30 minutes'::text; END IF;
  IF (c #>> '{CP-05,validity}')::interval > interval '10 minutes' THEN v := v || 'CP-05 OTP validity must be at most 10 minutes'::text; END IF;
  IF (c #>> '{CP-06,reset}')::interval > interval '60 minutes' THEN v := v || 'CP-06 reset link must be at most 60 minutes'::text; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(c -> 'CP-07') d WHERE d::interval > interval '72 hours') THEN v := v || 'CP-07 durations at most 72 hours'::text; END IF;
  IF (c #>> '{CP-08,bps}')::int <= 0 OR (c #>> '{CP-08,min_poisha}')::bigint <= 0 THEN v := v || 'CP-08 increment must be positive'::text; END IF;
  IF (c #>> '{CP-09,window}')::interval <= interval '0' OR (c #>> '{CP-09,extension}')::interval <= interval '0' THEN v := v || 'CP-09 window and extension must be positive'::text; END IF;
  IF (c #>> '{CP-10}')::interval NOT BETWEEN interval '1 hour' AND interval '72 hours' THEN v := v || 'CP-10 must be 1-72 hours'::text; END IF;
  IF (c #>> '{CP-11}')::interval NOT BETWEEN interval '1 hour' AND interval '72 hours' THEN v := v || 'CP-11 must be 1-72 hours'::text; END IF;
  IF (c #>> '{CP-12,strikes}')::int < 1 THEN v := v || 'CP-12 strikes must be at least 1'::text; END IF;
  IF (c #>> '{CP-13}')::interval NOT BETWEEN interval '5 minutes' AND interval '60 minutes' THEN v := v || 'CP-13 must be 5-60 minutes'::text; END IF;
  IF (c #>> '{CP-14}')::numeric <= 0 THEN v := v || 'CP-14 must be positive'::text; END IF;
  IF (c #>> '{CP-18}')::interval >= (c #>> '{CP-19}')::interval THEN v := v || 'CP-19 auto-release must be longer than the CP-18 dispute window'::text; END IF;
  IF (c #>> '{CP-24}')::interval < interval '3 days' THEN v := v || 'CP-24 protection period must be at least 3 days'::text; END IF;
  IF (c #>> '{CP-25,pro_bps}')::int > (c #>> '{CP-25,standard_bps}')::int THEN v := v || 'CP-25 Pro commission must not exceed standard'::text; END IF;
  IF (c #>> '{CP-26}')::int NOT BETWEEN 0 AND 5000 THEN v := v || 'CP-26 delivery margin must be 0-50%'::text; END IF;
  IF (c #>> '{CP-28,pro}')::int < (c #>> '{CP-28,standard}')::int THEN v := v || 'CP-28 Pro limit must be at least the standard limit'::text; END IF;
  IF (c #>> '{CP-29}')::interval < interval '12 hours' THEN v := v || 'CP-29 cooling-off must be at least 12 hours'::text; END IF;
  IF prev IS NOT NULL AND NOT ((c -> 'CP-30') @> (prev -> 'CP-30')) THEN v := v || 'CP-30 four-eyes list may only grow'::text; END IF;
  IF (c #>> '{CP-31}')::interval > interval '15 minutes' THEN v := v || 'CP-31 signed links at most 15 minutes'::text; END IF;
  IF (c #>> '{CP-34}')::int < 1 THEN v := v || 'CP-34 must be at least 1'::text; END IF;
  IF (c #>> '{CP-40}')::interval < interval '1 year' THEN v := v || 'CP-40 security-log retention at least 1 year'::text; END IF;
  IF (c #>> '{CP-41}')::interval > interval '30 days' THEN v := v || 'CP-41 erasure within 30 days'::text; END IF;
  IF (c #>> '{CP-45}')::int NOT BETWEEN 3 AND 10 THEN v := v || 'CP-45 must be 3-10'::text; END IF;
  IF (c #>> '{CP-46}')::interval > interval '60 minutes' THEN v := v || 'CP-46 reconciliation at most 60 minutes'::text; END IF;
  IF (c #>> '{CP-47,strikes}')::int < 1 THEN v := v || 'CP-47 must be at least 1'::text; END IF;
  IF (c #>> '{CP-48,monthly_poisha}')::bigint <= 0 THEN v := v || 'CP-48 Pro Seller price must be positive or unset'::text; END IF;
  RETURN v;
END $$;

`;

const VIOLATIONS_BEFORE = String.raw`
CREATE OR REPLACE FUNCTION staff.config_violations(c jsonb, prev jsonb) RETURNS text[] LANGUAGE plpgsql STABLE AS $$
DECLARE v text[] := '{}';
BEGIN
  IF (c #>> '{CP-01,access}')::interval NOT BETWEEN interval '5 minutes' AND interval '30 minutes' THEN v := v || 'CP-01 must be 5-30 minutes'::text; END IF;
  IF (c #>> '{CP-02,idle}')::interval > (c #>> '{CP-02,absolute}')::interval THEN v := v || 'CP-02 idle must not exceed absolute'::text; END IF;
  IF (c #>> '{CP-03,idle}')::interval > interval '30 minutes' THEN v := v || 'CP-03 staff idle must be at most 30 minutes'::text; END IF;
  IF (c #>> '{CP-05,validity}')::interval > interval '10 minutes' THEN v := v || 'CP-05 OTP validity must be at most 10 minutes'::text; END IF;
  IF (c #>> '{CP-06,reset}')::interval > interval '60 minutes' THEN v := v || 'CP-06 reset link must be at most 60 minutes'::text; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(c -> 'CP-07') d WHERE d::interval > interval '72 hours') THEN v := v || 'CP-07 durations at most 72 hours'::text; END IF;
  IF (c #>> '{CP-08,bps}')::int <= 0 OR (c #>> '{CP-08,min_poisha}')::bigint <= 0 THEN v := v || 'CP-08 increment must be positive'::text; END IF;
  IF (c #>> '{CP-09,window}')::interval <= interval '0' OR (c #>> '{CP-09,extension}')::interval <= interval '0' THEN v := v || 'CP-09 window and extension must be positive'::text; END IF;
  IF (c #>> '{CP-10}')::interval NOT BETWEEN interval '1 hour' AND interval '72 hours' THEN v := v || 'CP-10 must be 1-72 hours'::text; END IF;
  IF (c #>> '{CP-11}')::interval NOT BETWEEN interval '1 hour' AND interval '72 hours' THEN v := v || 'CP-11 must be 1-72 hours'::text; END IF;
  IF (c #>> '{CP-12,strikes}')::int < 1 THEN v := v || 'CP-12 strikes must be at least 1'::text; END IF;
  IF (c #>> '{CP-13}')::interval NOT BETWEEN interval '5 minutes' AND interval '60 minutes' THEN v := v || 'CP-13 must be 5-60 minutes'::text; END IF;
  IF (c #>> '{CP-14}')::numeric <= 0 THEN v := v || 'CP-14 must be positive'::text; END IF;
  IF (c #>> '{CP-18}')::interval >= (c #>> '{CP-19}')::interval THEN v := v || 'CP-19 auto-release must be longer than the CP-18 dispute window'::text; END IF;
  IF (c #>> '{CP-24}')::interval < interval '3 days' THEN v := v || 'CP-24 protection period must be at least 3 days'::text; END IF;
  IF (c #>> '{CP-25,pro_bps}')::int > (c #>> '{CP-25,standard_bps}')::int THEN v := v || 'CP-25 Pro commission must not exceed standard'::text; END IF;
  IF (c #>> '{CP-26}')::int NOT BETWEEN 0 AND 5000 THEN v := v || 'CP-26 delivery margin must be 0-50%'::text; END IF;
  IF (c #>> '{CP-28,pro}')::int < (c #>> '{CP-28,standard}')::int THEN v := v || 'CP-28 Pro limit must be at least the standard limit'::text; END IF;
  IF (c #>> '{CP-29}')::interval < interval '12 hours' THEN v := v || 'CP-29 cooling-off must be at least 12 hours'::text; END IF;
  IF prev IS NOT NULL AND NOT ((c -> 'CP-30') @> (prev -> 'CP-30')) THEN v := v || 'CP-30 four-eyes list may only grow'::text; END IF;
  IF (c #>> '{CP-31}')::interval > interval '15 minutes' THEN v := v || 'CP-31 signed links at most 15 minutes'::text; END IF;
  IF (c #>> '{CP-34}')::int < 1 THEN v := v || 'CP-34 must be at least 1'::text; END IF;
  IF (c #>> '{CP-40}')::interval < interval '1 year' THEN v := v || 'CP-40 security-log retention at least 1 year'::text; END IF;
  IF (c #>> '{CP-41}')::interval > interval '30 days' THEN v := v || 'CP-41 erasure within 30 days'::text; END IF;
  IF (c #>> '{CP-45}')::int NOT BETWEEN 3 AND 10 THEN v := v || 'CP-45 must be 3-10'::text; END IF;
  IF (c #>> '{CP-46}')::interval > interval '60 minutes' THEN v := v || 'CP-46 reconciliation at most 60 minutes'::text; END IF;
  IF (c #>> '{CP-47,strikes}')::int < 1 THEN v := v || 'CP-47 must be at least 1'::text; END IF;
  RETURN v;
END $$;

`;
