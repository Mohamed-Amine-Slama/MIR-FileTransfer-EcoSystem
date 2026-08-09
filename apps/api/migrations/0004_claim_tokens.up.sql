-- BUILD_SPEC P5.2 — patient claim flow.
--
-- DECISION D1: the Libyan doctor creates the patient record; the patient later
-- proves the phone number is theirs and claims it. Until that happens
-- `claimed_by_user` is NULL and the record is invisible to every patient
-- account (P3.2).
--
-- WHY THE TOKEN IS STORED AS A HASH:
-- the claim token is a bearer credential — whoever holds it can attach a
-- stranger's medical imaging to their own account. Storing it in plaintext
-- means a read-only database leak, a stray log line, or a support engineer
-- with a SELECT grant is enough to hijack a patient record. Only the SHA-256
-- is stored; the code the patient receives exists in the SMS and nowhere else.

BEGIN;

CREATE TABLE patients_claim_tokens (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  patient_id   uuid NOT NULL REFERENCES patients_patients(id),
  -- SHA-256 of the code sent by SMS. Never the code itself.
  token_hash   text NOT NULL,
  -- Denormalised from the patient record at issue time: the token is bound to
  -- the number it was sent to, so changing the patient's phone afterwards
  -- cannot redirect an outstanding token to a new handset.
  phone_e164   text NOT NULL,
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz,
  issued_by    uuid NOT NULL REFERENCES identity_users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX patients_claim_tokens_hash_idx ON patients_claim_tokens (token_hash);
CREATE INDEX patients_claim_tokens_patient_idx ON patients_claim_tokens (patient_id);

-- ---------------------------------------------------------------------------
-- Claiming, as a SECURITY DEFINER function.
--
-- The claim is a genuine chicken-and-egg: the patient cannot SELECT or UPDATE
-- the record precisely because they have not claimed it yet. Rather than
-- loosening the RLS policies — which would make unclaimed records visible to
-- every patient account and defeat the point — the whole operation is done by
-- one narrowly scoped function that:
--
--   * refuses to run for any role except 'patient';
--   * derives the phone number from the AUTHENTICATED user, never from an
--     argument, so a caller cannot claim against someone else's number;
--   * consumes the token and links the record in a single statement pair, so
--     two concurrent redemptions cannot both succeed.
--
-- It takes only the token hash. It cannot be used to link an arbitrary patient
-- to an arbitrary user.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION patients_claim_with_token(p_token_hash text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user    uuid := app_current_user_id();
  v_phone   text;
  v_patient uuid;
  v_linked  int;
BEGIN
  IF app_current_role() IS DISTINCT FROM 'patient' THEN
    RAISE EXCEPTION 'only a patient account may claim a record'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_user IS NULL THEN
    RAISE EXCEPTION 'no authenticated user' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT phone_e164 INTO v_phone FROM identity_users WHERE id = v_user;
  IF v_phone IS NULL THEN
    RAISE EXCEPTION 'unknown user' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Single-use and expiry are enforced in the WHERE clause, so redemption is
  -- atomic: exactly one concurrent caller can flip consumed_at from NULL.
  UPDATE patients_claim_tokens
  SET consumed_at = now()
  WHERE token_hash = p_token_hash
    AND phone_e164 = v_phone
    AND consumed_at IS NULL
    AND expires_at > now()
  RETURNING patient_id INTO v_patient;

  IF v_patient IS NULL THEN
    RETURN NULL;  -- unknown, expired, already used, or wrong phone
  END IF;

  UPDATE patients_patients
  SET claimed_by_user = v_user
  WHERE id = v_patient
    AND claimed_by_user IS NULL;

  GET DIAGNOSTICS v_linked = ROW_COUNT;

  IF v_linked = 0 THEN
    -- Already claimed, by this user or another. Re-claiming is not an error
    -- for the rightful owner, but must never move a record between accounts.
    IF EXISTS (SELECT 1 FROM patients_patients
               WHERE id = v_patient AND claimed_by_user = v_user) THEN
      RETURN v_patient;
    END IF;
    RAISE EXCEPTION 'record already claimed by another account'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN v_patient;
END;
$$;

-- ---------------------------------------------------------------------------
-- Access control on the token table itself.
--
-- The referring doctor issues tokens for their own patients. Nobody reads the
-- hash back through the application — redemption goes through the function
-- above — so there is no SELECT policy for patients at all.
-- ---------------------------------------------------------------------------
ALTER TABLE patients_claim_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients_claim_tokens FORCE  ROW LEVEL SECURITY;

CREATE POLICY claim_tokens_issuer_select ON patients_claim_tokens FOR SELECT
  USING (app_current_role() = 'libya_doctor' AND app_created_patient(patient_id));

CREATE POLICY claim_tokens_issuer_insert ON patients_claim_tokens FOR INSERT
  WITH CHECK (
    app_current_role() = 'libya_doctor'
    AND app_created_patient(patient_id)
    AND issued_by = app_current_user_id()
  );

GRANT SELECT, INSERT ON patients_claim_tokens TO mir_app;
GRANT EXECUTE ON FUNCTION patients_claim_with_token(text) TO mir_app;

COMMIT;
