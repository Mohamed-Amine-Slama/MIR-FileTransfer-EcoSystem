-- BUILD_SPEC P3.2 — row-level security. The second of the two independent
-- authorization layers required by ADR-6. A bug in application RBAC must not
-- expose data, and vice versa.
--
-- THREE PROPERTIES THIS FILE DEPENDS ON:
--
-- 1. `mir_app` is NOT a superuser and does NOT have BYPASSRLS. Superusers and
--    BYPASSRLS roles ignore every policy below.
-- 2. `mir_app` does NOT own these tables. Table owners bypass RLS unless FORCE
--    is set — and owners can also drop policies. FORCE is set anyway, as
--    defence in depth.
-- 3. Every request sets `app.user_id` and `app.user_role` INSIDE the same
--    transaction as its queries. A SET LOCAL outside the transaction silently
--    does nothing (P4.2), which would leave every policy evaluating NULL.
--
-- NULL HANDLING — the reason `true` is passed to current_setting():
--   current_setting('app.user_role')        -> ERROR if unset
--   current_setting('app.user_role', true)  -> NULL if unset
-- The spec's example omits the second argument. That form throws whenever the
-- setting is absent, which breaks migrations, health checks, and background
-- jobs. With NULL every comparison yields NULL, the row is filtered out, and
-- the query returns nothing. Fail closed, quietly.
--
-- WHY THE HELPER FUNCTIONS ARE `SECURITY DEFINER`:
--
-- Written naively, these policies recurse. Visibility of a patient depends on
-- an appointment; visibility of an appointment depends on the patient; and
-- PostgreSQL aborts with "infinite recursion detected in policy for relation".
-- Any cross-table lookup performed inside a policy re-enters the target
-- table's own policies.
--
-- The helpers below run as their owner, so their internal reads are not
-- subject to RLS and the cycle is broken. To keep that from becoming an
-- exfiltration primitive:
--   * every helper is STABLE and returns a BOOLEAN, never a row or an id;
--   * none takes the caller's identity as a parameter — they read it from
--     app_current_user_id(), so a caller can only ever ask about their OWN
--     relationship to a record;
--   * search_path is pinned, so the function body cannot be hijacked by a
--     caller-controlled schema.

BEGIN;

-- ---------------------------------------------------------------------------
-- Application role
--
-- Created without LOGIN and without a password on purpose: a password in a
-- committed migration is a committed secret (§6). Credentials are attached out
-- of band — by Terraform from Secrets Manager in deployed environments, and by
-- the test harness / local bootstrap in development.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mir_app') THEN
    CREATE ROLE mir_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  ELSE
    -- Re-assert the safety attributes in case the role was altered by hand.
    ALTER ROLE mir_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO mir_app;

-- Read/write, but NO DELETE anywhere. Erasing patient data is a retention
-- process with its own controls (L5), never something a request handler can do
-- by accident or by injection.
GRANT SELECT, INSERT, UPDATE ON
  identity_users,
  identity_doctor_profiles,
  patients_patients,
  consent_records,
  imaging_studies,
  imaging_instances,
  scheduling_availability,
  scheduling_appointments,
  scheduling_appointment_studies
TO mir_app;

-- P4.4: the audit log is append-only. SELECT and INSERT only — no UPDATE, no
-- DELETE, ever. This grant, not the REVOKE in 0001, is what makes it true for
-- the application.
GRANT SELECT, INSERT ON audit_events TO mir_app;

GRANT EXECUTE ON FUNCTION uuid_generate_v7() TO mir_app;

-- ---------------------------------------------------------------------------
-- Session accessors (SECURITY INVOKER — they read only session state).
-- Centralising the lookup means the NULL-safe form is used consistently; a
-- policy that forgot the `true` argument would throw instead of denying.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS uuid
LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION app_current_role() RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(current_setting('app.user_role', true), '');
$$;

-- DECISION D3 / P10.3. Defaults to FALSE when unset: imaging is visible to the
-- receiving doctor only after payment succeeds. This toggle moves the PAYMENT
-- gate only — it never bypasses consent.
CREATE OR REPLACE FUNCTION app_triage_before_payment() RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(NULLIF(current_setting('app.triage_before_payment', true), '')::boolean, false);
$$;

-- ---------------------------------------------------------------------------
-- Relationship helpers (SECURITY DEFINER — see the header note).
-- Each answers exactly one yes/no question about the CURRENT user.
-- ---------------------------------------------------------------------------

/** Did the current user (a Libyan doctor) create this patient record? */
CREATE OR REPLACE FUNCTION app_created_patient(p_patient uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM patients_patients
    WHERE id = p_patient AND created_by_doctor = app_current_user_id()
  );
$$;

/** Has the current user (a patient) claimed this patient record? */
CREATE OR REPLACE FUNCTION app_claimed_patient(p_patient uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM patients_patients
    WHERE id = p_patient AND claimed_by_user = app_current_user_id()
  );
$$;

/** Does the current user (a Tunisian doctor) have a live appointment with this patient? */
CREATE OR REPLACE FUNCTION app_has_appointment_with(p_patient uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM scheduling_appointments
    WHERE patient_id = p_patient
      AND doctor_id = app_current_user_id()
      AND status <> 'cancelled'
  );
$$;

/**
 * Does a valid, unrevoked cross-border consent naming the CURRENT user exist
 * for this patient? (P5.3 — the legally critical gate.)
 */
CREATE OR REPLACE FUNCTION app_has_consent_for(p_patient uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM consent_records
    WHERE patient_id = p_patient
      AND scope = 'cross_border_transfer'
      AND granted_to = app_current_user_id()
      AND revoked_at IS NULL
  );
$$;

/**
 * Is this study linked to an appointment with the current user that has
 * cleared the payment gate? DECISION D3 is applied here.
 */
CREATE OR REPLACE FUNCTION app_study_linked_to_my_appointment(p_study uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM scheduling_appointment_studies sas
    JOIN scheduling_appointments a ON a.id = sas.appointment_id
    WHERE sas.study_id = p_study
      AND a.doctor_id = app_current_user_id()
      AND a.status <> 'cancelled'
      AND (app_triage_before_payment() OR a.status IN ('confirmed', 'completed'))
  );
$$;

/**
 * Full visibility decision for a single study, mirroring the three SELECT
 * policies on imaging_studies. Used by dependent tables so the rule lives in
 * one place and the copies cannot drift apart.
 */
CREATE OR REPLACE FUNCTION app_can_see_study(p_study uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM imaging_studies s
    WHERE s.id = p_study
      AND (
        (app_current_role() = 'libya_doctor'   AND s.uploaded_by = app_current_user_id())
        OR (app_current_role() = 'patient'     AND app_claimed_patient(s.patient_id))
        OR (app_current_role() = 'tunisia_doctor'
            AND app_study_linked_to_my_appointment(s.id)
            AND app_has_consent_for(s.patient_id))
      )
  );
$$;

/** Is this appointment one the current user is a party to? */
CREATE OR REPLACE FUNCTION app_can_see_appointment(p_appointment uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM scheduling_appointments a
    WHERE a.id = p_appointment
      AND (
        (app_current_role() = 'tunisia_doctor' AND a.doctor_id = app_current_user_id())
        OR (app_current_role() = 'patient'      AND app_claimed_patient(a.patient_id))
        OR (app_current_role() = 'libya_doctor' AND app_created_patient(a.patient_id))
      )
  );
$$;

GRANT EXECUTE ON FUNCTION
  app_current_user_id(), app_current_role(), app_triage_before_payment(),
  app_created_patient(uuid), app_claimed_patient(uuid),
  app_has_appointment_with(uuid), app_has_consent_for(uuid),
  app_study_linked_to_my_appointment(uuid), app_can_see_study(uuid),
  app_can_see_appointment(uuid)
TO mir_app;

-- ---------------------------------------------------------------------------
-- Enable RLS. FORCE makes the policies apply to the table owner too, so a
-- migration or maintenance connection cannot quietly read everything.
-- (Superusers still bypass; that is what break-glass access is for — P14.1.)
-- ---------------------------------------------------------------------------
ALTER TABLE identity_users                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_users                 FORCE  ROW LEVEL SECURITY;
ALTER TABLE identity_doctor_profiles       ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_doctor_profiles       FORCE  ROW LEVEL SECURITY;
ALTER TABLE patients_patients              ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients_patients              FORCE  ROW LEVEL SECURITY;
ALTER TABLE consent_records                ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_records                FORCE  ROW LEVEL SECURITY;
ALTER TABLE imaging_studies                ENABLE ROW LEVEL SECURITY;
ALTER TABLE imaging_studies                FORCE  ROW LEVEL SECURITY;
ALTER TABLE imaging_instances              ENABLE ROW LEVEL SECURITY;
ALTER TABLE imaging_instances              FORCE  ROW LEVEL SECURITY;
ALTER TABLE scheduling_availability        ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduling_availability        FORCE  ROW LEVEL SECURITY;
ALTER TABLE scheduling_appointments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduling_appointments        FORCE  ROW LEVEL SECURITY;
ALTER TABLE scheduling_appointment_studies ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduling_appointment_studies FORCE  ROW LEVEL SECURITY;
ALTER TABLE audit_events                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events                   FORCE  ROW LEVEL SECURITY;

-- ===========================================================================
-- identity_users
-- ===========================================================================
CREATE POLICY users_self ON identity_users FOR SELECT
  USING (id = app_current_user_id());

-- Patients must be able to find a Tunisian doctor in order to book one.
CREATE POLICY users_discoverable_doctors ON identity_users FOR SELECT
  USING (role = 'tunisia_doctor' AND status = 'active' AND app_current_role() IS NOT NULL);

-- Admins manage doctor verification (§1.1). Note admins get identity, NOT imaging.
CREATE POLICY users_admin ON identity_users FOR SELECT
  USING (app_current_role() = 'admin');

CREATE POLICY users_admin_update ON identity_users FOR UPDATE
  USING (app_current_role() = 'admin')
  WITH CHECK (app_current_role() = 'admin');

-- ===========================================================================
-- identity_doctor_profiles
-- ===========================================================================
CREATE POLICY doctor_profiles_self ON identity_doctor_profiles FOR SELECT
  USING (user_id = app_current_user_id());

CREATE POLICY doctor_profiles_admin ON identity_doctor_profiles FOR ALL
  USING (app_current_role() = 'admin')
  WITH CHECK (app_current_role() = 'admin');

-- ===========================================================================
-- patients_patients
-- ===========================================================================

-- DECISION D1: the Libyan doctor creates the record, and sees only their own.
CREATE POLICY patients_creator ON patients_patients FOR SELECT
  USING (app_current_role() = 'libya_doctor' AND created_by_doctor = app_current_user_id());

CREATE POLICY patients_creator_insert ON patients_patients FOR INSERT
  WITH CHECK (app_current_role() = 'libya_doctor' AND created_by_doctor = app_current_user_id());

CREATE POLICY patients_creator_update ON patients_patients FOR UPDATE
  USING (app_current_role() = 'libya_doctor' AND created_by_doctor = app_current_user_id())
  WITH CHECK (created_by_doctor = app_current_user_id());

-- The patient, once they have claimed the record via phone OTP (P5.2).
CREATE POLICY patients_claimed ON patients_patients FOR SELECT
  USING (app_current_role() = 'patient' AND claimed_by_user = app_current_user_id());

-- The receiving doctor sees the patient only where an appointment AND a valid
-- consent naming them both exist. Demographics are patient data too.
CREATE POLICY patients_receiving_doctor ON patients_patients FOR SELECT
  USING (
    app_current_role() = 'tunisia_doctor'
    AND app_has_appointment_with(id)
    AND app_has_consent_for(id)
  );

-- ===========================================================================
-- consent_records
-- ===========================================================================
CREATE POLICY consent_patient_select ON consent_records FOR SELECT
  USING (app_current_role() = 'patient' AND app_claimed_patient(patient_id));

-- Only the patient may grant consent — never the doctor on their behalf (L4).
CREATE POLICY consent_patient_insert ON consent_records FOR INSERT
  WITH CHECK (app_current_role() = 'patient' AND app_claimed_patient(patient_id));

-- Revocation sets revoked_at. Consent is never deleted — the record of it
-- having been granted is itself the evidence.
CREATE POLICY consent_patient_revoke ON consent_records FOR UPDATE
  USING (app_current_role() = 'patient' AND app_claimed_patient(patient_id))
  WITH CHECK (app_claimed_patient(patient_id));

-- The referring doctor may see whether consent exists, to know whether the
-- transfer is unblocked. They cannot create it.
CREATE POLICY consent_referring_doctor ON consent_records FOR SELECT
  USING (app_current_role() = 'libya_doctor' AND app_created_patient(patient_id));

-- The receiving doctor may see consents naming them, so the UI can explain why
-- access was granted or withdrawn.
CREATE POLICY consent_receiving_doctor ON consent_records FOR SELECT
  USING (app_current_role() = 'tunisia_doctor' AND granted_to = app_current_user_id());

-- ===========================================================================
-- imaging_studies — the policies the P3.2 gate tests directly
-- ===========================================================================

-- Libyan doctor: only studies they uploaded.
CREATE POLICY studies_uploader ON imaging_studies FOR SELECT
  USING (app_current_role() = 'libya_doctor' AND uploaded_by = app_current_user_id());

CREATE POLICY studies_uploader_insert ON imaging_studies FOR INSERT
  WITH CHECK (
    app_current_role() = 'libya_doctor'
    AND uploaded_by = app_current_user_id()
    AND app_created_patient(patient_id)
  );

CREATE POLICY studies_uploader_update ON imaging_studies FOR UPDATE
  USING (app_current_role() = 'libya_doctor' AND uploaded_by = app_current_user_id())
  WITH CHECK (uploaded_by = app_current_user_id());

-- Patient: only their own.
CREATE POLICY studies_patient ON imaging_studies FOR SELECT
  USING (app_current_role() = 'patient' AND app_claimed_patient(patient_id));

-- Tunisian doctor: linked appointment that has cleared the payment gate (D3),
-- AND a valid consent naming them.
CREATE POLICY studies_receiving_doctor ON imaging_studies FOR SELECT
  USING (
    app_current_role() = 'tunisia_doctor'
    AND app_study_linked_to_my_appointment(id)
    AND app_has_consent_for(patient_id)
  );

-- ===========================================================================
-- imaging_instances — visibility follows the parent study exactly.
-- ===========================================================================
CREATE POLICY instances_follow_study ON imaging_instances FOR SELECT
  USING (app_can_see_study(study_id));

CREATE POLICY instances_insert ON imaging_instances FOR INSERT
  WITH CHECK (app_current_role() = 'libya_doctor' AND app_can_see_study(study_id));

CREATE POLICY instances_update ON imaging_instances FOR UPDATE
  USING (app_current_role() = 'libya_doctor' AND app_can_see_study(study_id))
  WITH CHECK (app_can_see_study(study_id));

-- ===========================================================================
-- scheduling_availability
-- ===========================================================================
CREATE POLICY availability_owner ON scheduling_availability FOR ALL
  USING (app_current_role() = 'tunisia_doctor' AND doctor_id = app_current_user_id())
  WITH CHECK (app_current_role() = 'tunisia_doctor' AND doctor_id = app_current_user_id());

-- Patients need to see availability in order to book it.
CREATE POLICY availability_bookable ON scheduling_availability FOR SELECT
  USING (app_current_role() = 'patient');

-- ===========================================================================
-- scheduling_appointments
-- ===========================================================================
CREATE POLICY appointments_patient ON scheduling_appointments FOR SELECT
  USING (app_current_role() = 'patient' AND app_claimed_patient(patient_id));

CREATE POLICY appointments_patient_insert ON scheduling_appointments FOR INSERT
  WITH CHECK (app_current_role() = 'patient' AND app_claimed_patient(patient_id));

CREATE POLICY appointments_patient_update ON scheduling_appointments FOR UPDATE
  USING (app_current_role() = 'patient' AND app_claimed_patient(patient_id))
  WITH CHECK (app_claimed_patient(patient_id));

CREATE POLICY appointments_doctor ON scheduling_appointments FOR SELECT
  USING (app_current_role() = 'tunisia_doctor' AND doctor_id = app_current_user_id());

CREATE POLICY appointments_doctor_update ON scheduling_appointments FOR UPDATE
  USING (app_current_role() = 'tunisia_doctor' AND doctor_id = app_current_user_id())
  WITH CHECK (doctor_id = app_current_user_id());

-- The referring doctor may follow the referral's progress.
CREATE POLICY appointments_referring_doctor ON scheduling_appointments FOR SELECT
  USING (app_current_role() = 'libya_doctor' AND app_created_patient(patient_id));

-- ===========================================================================
-- scheduling_appointment_studies
-- ===========================================================================
CREATE POLICY appointment_studies_visible ON scheduling_appointment_studies FOR SELECT
  USING (app_can_see_appointment(appointment_id));

CREATE POLICY appointment_studies_insert ON scheduling_appointment_studies FOR INSERT
  WITH CHECK (app_can_see_appointment(appointment_id) AND app_can_see_study(study_id));

-- ===========================================================================
-- audit_events
--
-- Anyone authenticated may append. Only admins may read. Nobody may update or
-- delete — enforced by the absence of the grant, above.
-- ===========================================================================
CREATE POLICY audit_append ON audit_events FOR INSERT
  WITH CHECK (app_current_role() IS NOT NULL);

CREATE POLICY audit_admin_read ON audit_events FOR SELECT
  USING (app_current_role() = 'admin');

COMMIT;
