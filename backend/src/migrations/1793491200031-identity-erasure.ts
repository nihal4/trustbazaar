import { MigrationInterface, QueryRunner } from 'typeorm';

// Unit 1, U1-09 (Decisions log, 2026-11-17; agreed with the user). Runs as tb_owner (SEC-INF-03).
//   FR-PRV-04: the erasure of closed accounts past erase_after, and of KYC data rejected more than 30 days ago, as
//   SECURITY DEFINER functions: the application role cannot delete MFA factors or identity claims, so the functions
//   check that the erasure is due and do it. docs/design/sql/01_identity_access.sql holds the result.
export class IdentityErasure1793491200031 implements MigrationInterface {
  name = 'IdentityErasure1793491200031';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(UP);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP FUNCTION identity.erase_rejected_kyc(integer);
      DROP FUNCTION identity.erase_user(uuid);
      DROP FUNCTION identity.erase_kyc_rows(uuid, uuid);`);
  }
}

const UP = String.raw`
CREATE FUNCTION identity.erase_kyc_rows(p_user uuid, p_submission uuid) RETURNS TABLE (storage_key varchar)
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE identity.kyc_submissions
     SET doc_number_enc = NULL, doc_number_bidx = NULL, full_name_enc = NULL, dob_enc = NULL, person_bidx = NULL,
         precheck = NULL, rejection_note = NULL, erased_at = now()
   WHERE erased_at IS NULL AND (id = p_submission OR (p_submission IS NULL AND user_id = p_user));
  RETURN QUERY
    UPDATE identity.kyc_files f SET wrapped_dek = NULL, erased_at = now()
      FROM identity.kyc_submissions k
     WHERE k.id = f.submission_id AND f.erased_at IS NULL
       AND (k.id = p_submission OR (p_submission IS NULL AND k.user_id = p_user))
    RETURNING f.storage_key;
END $$;
REVOKE ALL ON FUNCTION identity.erase_kyc_rows(uuid, uuid) FROM PUBLIC;

-- A closed account past erase_after: personal fields emptied, MFA factors and the identity claim deleted, KYC erased,
-- erased_at set. The user row stays (orders and settlements reference it). Erasing an erased account does nothing.
CREATE FUNCTION identity.erase_user(p_user uuid) RETURNS TABLE (storage_key varchar)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE u record;
BEGIN
  SELECT account_status, erase_after, erased_at INTO u FROM identity.users WHERE id = p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'user % not found', p_user USING ERRCODE = 'no_data_found'; END IF;
  IF u.erased_at IS NOT NULL THEN RETURN; END IF;
  IF u.account_status <> 'closed' OR u.erase_after IS NULL OR u.erase_after > now() THEN
    RAISE EXCEPTION 'user % is not due for erasure', p_user USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM identity.kyc_submissions WHERE user_id = p_user AND status = 'pending_review') THEN
    RAISE EXCEPTION 'user % has a KYC submission under review', p_user USING ERRCODE = 'check_violation';
  END IF;
  UPDATE identity.users
     SET display_name = 'Deleted user', phone_e164 = NULL, email = NULL, email_verified_at = NULL, password_hash = NULL,
         password_single_factor_ok = true, mfa_enabled = false, area_district = NULL, approx_lat = NULL, approx_lng = NULL,
         erased_at = now(), updated_at = now()
   WHERE id = p_user;
  DELETE FROM identity.recovery_codes WHERE totp_factor_id IN (SELECT id FROM identity.totp_factors WHERE user_id = p_user);
  DELETE FROM identity.totp_factors WHERE user_id = p_user;
  DELETE FROM identity.identity_claims WHERE user_id = p_user;
  RETURN QUERY SELECT e.storage_key FROM identity.erase_kyc_rows(p_user, NULL) e;
END $$;
REVOKE ALL ON FUNCTION identity.erase_user(uuid) FROM PUBLIC;

-- KYC data of submissions rejected more than 30 days ago when the user has not submitted again (SRS Table 7.2).
CREATE FUNCTION identity.erase_rejected_kyc(p_limit integer DEFAULT 200) RETURNS TABLE (storage_key varchar)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE s record;
BEGIN
  FOR s IN
    SELECT k.id, k.user_id FROM identity.kyc_submissions k
     WHERE k.status = 'rejected' AND k.erased_at IS NULL AND k.decided_at < now() - interval '30 days'
       AND NOT EXISTS (SELECT 1 FROM identity.kyc_submissions n WHERE n.user_id = k.user_id AND n.submitted_at > k.submitted_at)
     ORDER BY k.decided_at LIMIT p_limit FOR UPDATE OF k SKIP LOCKED
  LOOP
    RETURN QUERY SELECT e.storage_key FROM identity.erase_kyc_rows(s.user_id, s.id) e;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION identity.erase_rejected_kyc(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity.erase_user(uuid), identity.erase_rejected_kyc(integer) TO tb_app;
`;
