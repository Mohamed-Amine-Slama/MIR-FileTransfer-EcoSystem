-- The practice assistant — brief §5.5, and the second half of the practice
-- calendar 0014 opened up.
--
-- A clinic is not run by the doctor alone: somebody answers the phone and books
-- the appointments. That person must be able to write to a doctor's diary and
-- must never reach a scan.
--
-- WHY THIS IS A ROLE AND NOT JUST A SEAT. Modelling the assistant purely as an
-- `identity_memberships.seat_role` was the first thing tried, and it cannot
-- work: every policy in this schema turns on `app_current_role()`, which reads
-- `identity_users.role`. An assistant left as `applicant` matches no policy —
-- and the "fix" would be to write policies naming `applicant`, which destroys
-- the fail-closed property that makes self-registration safe (0009).
--
-- So the two are split, and BOTH are required:
--   the ROLE       says what this account is        (identity_users.role)
--   the MEMBERSHIP says whose calendar it may touch (app_assists_doctor)
-- Neither grants anything on its own. An `assistant` with no membership matches
-- every policy below at `app_assists_doctor(...) = false` and sees nothing.
--
-- WHAT AN ASSISTANT CANNOT REACH, and how that is enforced.
-- There is no policy here on imaging_studies, imaging_instances or
-- consent_records, so the consent-plus-payment gate is untouched. There is also
-- deliberately NO SELECT POLICY ON patients_patients. That is the important
-- one: RLS is row-level, so a SELECT policy would hand over date_of_birth,
-- national_id and sex along with the name, leaving the actual restriction to a
-- SELECT list in a service that a later refactor can widen without noticing.
-- Instead the assistant's two reads go through SECURITY DEFINER functions that
-- have no column for anything clinical — the restriction is in the return type,
-- where it cannot be widened by accident.

BEGIN;

-- ---------------------------------------------------------------------------
-- The role, and the seat that binds it to a practice.
-- ---------------------------------------------------------------------------
ALTER TABLE identity_users DROP CONSTRAINT identity_users_role_check;
ALTER TABLE identity_users ADD CONSTRAINT identity_users_role_check
  CHECK (role IN ('libya_doctor','tunisia_doctor','patient','admin','applicant','assistant'));

ALTER TABLE identity_memberships DROP CONSTRAINT identity_memberships_seat_role_check;
ALTER TABLE identity_memberships ADD CONSTRAINT identity_memberships_seat_role_check
  CHECK (seat_role IN ('owner','member','assistant'));

ALTER TABLE identity_invitations DROP CONSTRAINT identity_invitations_seat_role_check;
ALTER TABLE identity_invitations ADD CONSTRAINT identity_invitations_seat_role_check
  CHECK (seat_role IN ('owner','member','assistant'));

-- ---------------------------------------------------------------------------
-- Relationship helpers. Same four rules as every other one in this schema
-- (0010): STABLE, returns a boolean and never a row or an id, takes no caller
-- identity — it reads app_current_user_id(), so a caller can only ever ask
-- about their OWN relationship — and pins search_path.
-- ---------------------------------------------------------------------------

/** Does the CALLER assist this doctor — i.e. share an organisation with them? */
CREATE OR REPLACE FUNCTION app_assists_doctor(p_doctor uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM identity_memberships me
    JOIN identity_memberships them ON them.organisation_id = me.organisation_id
    WHERE me.user_id = app_current_user_id()
      AND me.seat_role = 'assistant'
      AND them.user_id = p_doctor
      AND them.seat_role IN ('owner','member')
  );
$$;

/**
 * Is this patient one of the practice's?
 *
 * Needed because `app_assists_doctor(doctor_id)` alone would let an assistant
 * attach ANY patient id to an appointment on their doctor's calendar. The ids
 * are uuidv7 and the assistant cannot read the table, so guessing one is not a
 * realistic attack — but "not realistically guessable" is not the standard the
 * rest of this schema is held to.
 */
CREATE OR REPLACE FUNCTION app_assistant_patient(p_patient uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM patients_patients p
    WHERE p.id = p_patient AND app_assists_doctor(p.created_by_doctor)
  );
$$;

-- ---------------------------------------------------------------------------
-- Granting the role.
--
-- `identity_grant_membership_role` refuses anything outside the corridor
-- endpoint roles, correctly, and must keep doing so — it is the function that
-- guarantees a seat cannot mint a clinical account. This is its sibling for the
-- one non-clinical seat, with the same shape and the same restrictions:
-- applicant -> assistant only, approved organisation only, assistant seat only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION identity_grant_assistant_role(p_org uuid, p_user uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE identity_users
  SET role = 'assistant', status = 'active'
  WHERE id = p_user
    AND role = 'applicant'
    AND EXISTS (
      SELECT 1 FROM identity_memberships m
      JOIN identity_organisations o ON o.id = m.organisation_id
      WHERE m.organisation_id = p_org
        AND m.user_id = p_user
        AND m.seat_role = 'assistant'
        AND o.verification_status = 'approved'
    );
END;
$$;

-- ---------------------------------------------------------------------------
-- The calendar an assistant may operate.
-- ---------------------------------------------------------------------------
CREATE POLICY availability_assistant ON scheduling_availability FOR ALL
  USING (app_current_role() = 'assistant' AND app_assists_doctor(doctor_id))
  WITH CHECK (app_current_role() = 'assistant' AND app_assists_doctor(doctor_id));

CREATE POLICY appointments_assistant ON scheduling_appointments FOR SELECT
  USING (app_current_role() = 'assistant' AND app_assists_doctor(doctor_id));

CREATE POLICY appointments_assistant_insert ON scheduling_appointments FOR INSERT
  WITH CHECK (
    app_current_role() = 'assistant'
    AND app_assists_doctor(doctor_id)
    AND app_assistant_patient(patient_id)
  );

CREATE POLICY appointments_assistant_update ON scheduling_appointments FOR UPDATE
  USING (app_current_role() = 'assistant' AND app_assists_doctor(doctor_id))
  WITH CHECK (app_assists_doctor(doctor_id) AND app_assistant_patient(patient_id));

-- Registering a walk-in, on behalf of the doctor.
--
-- `created_by_doctor` is the DOCTOR, never the assistant. If the assistant put
-- themselves there, `patients_creator` would not match for the doctor and the
-- doctor could not see the patient their own receptionist just booked.
CREATE POLICY patients_assistant_insert ON patients_patients FOR INSERT
  WITH CHECK (app_current_role() = 'assistant' AND app_assists_doctor(created_by_doctor));

-- ---------------------------------------------------------------------------
-- The two reads. Everything the assistant can learn about a patient is in these
-- return types: a name and a phone number. There is no column here for a date
-- of birth, a national id, a sex, a study, or a consent record, so no query and
-- no later edit to a service can select one.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION scheduling_assistant_agenda(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (
  id            uuid,
  doctor_id     uuid,
  doctor_name   text,
  patient_id    uuid,
  patient_name  text,
  patient_phone text,
  starts_at     timestamptz,
  ends_at       timestamptz,
  status        text,
  kind          text,
  reason        text,
  notes         text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT a.id, a.doctor_id, d.full_name, a.patient_id, p.full_name, p.phone_e164,
         a.starts_at, a.ends_at, a.status, a.kind, a.reason, a.notes
  FROM scheduling_appointments a
  JOIN identity_users d ON d.id = a.doctor_id
  JOIN patients_patients p ON p.id = a.patient_id
  WHERE app_current_role() = 'assistant'
    AND app_assists_doctor(a.doctor_id)
    AND (p_from IS NULL OR a.ends_at > p_from)
    AND (p_to IS NULL OR a.starts_at < p_to)
  ORDER BY a.starts_at;
$$;

/** Phone-only, matching the privacy control already in force on /patients. */
CREATE OR REPLACE FUNCTION scheduling_assistant_patient_search(p_phone text)
RETURNS TABLE (id uuid, full_name text, phone_e164 text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT p.id, p.full_name, p.phone_e164
  FROM patients_patients p
  WHERE app_current_role() = 'assistant'
    AND p.phone_e164 = p_phone
    AND app_assists_doctor(p.created_by_doctor)
  ORDER BY p.full_name;
$$;

GRANT EXECUTE ON FUNCTION app_assists_doctor(uuid) TO mir_app;
GRANT EXECUTE ON FUNCTION app_assistant_patient(uuid) TO mir_app;
GRANT EXECUTE ON FUNCTION identity_grant_assistant_role(uuid, uuid) TO mir_app;
GRANT EXECUTE ON FUNCTION scheduling_assistant_agenda(timestamptz, timestamptz) TO mir_app;
GRANT EXECUTE ON FUNCTION scheduling_assistant_patient_search(text) TO mir_app;

COMMIT;
