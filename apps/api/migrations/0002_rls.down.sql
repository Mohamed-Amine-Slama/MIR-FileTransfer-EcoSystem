-- Reverse of 0002_rls.up.sql.
--
-- Dropping the policies leaves RLS DISABLED, which is wide open. That is
-- correct for a down migration (it restores the prior state) but it means a
-- rollback to 0001 must never be left in place on an environment holding real
-- data. The rollback runbook says so explicitly.

BEGIN;

DROP POLICY IF EXISTS audit_admin_read ON audit_events;
DROP POLICY IF EXISTS audit_append ON audit_events;

DROP POLICY IF EXISTS appointment_studies_insert ON scheduling_appointment_studies;
DROP POLICY IF EXISTS appointment_studies_visible ON scheduling_appointment_studies;

DROP POLICY IF EXISTS appointments_referring_doctor ON scheduling_appointments;
DROP POLICY IF EXISTS appointments_doctor_update ON scheduling_appointments;
DROP POLICY IF EXISTS appointments_doctor ON scheduling_appointments;
DROP POLICY IF EXISTS appointments_patient_update ON scheduling_appointments;
DROP POLICY IF EXISTS appointments_patient_insert ON scheduling_appointments;
DROP POLICY IF EXISTS appointments_patient ON scheduling_appointments;

DROP POLICY IF EXISTS availability_bookable ON scheduling_availability;
DROP POLICY IF EXISTS availability_owner ON scheduling_availability;

DROP POLICY IF EXISTS instances_update ON imaging_instances;
DROP POLICY IF EXISTS instances_insert ON imaging_instances;
DROP POLICY IF EXISTS instances_follow_study ON imaging_instances;

DROP POLICY IF EXISTS studies_receiving_doctor ON imaging_studies;
DROP POLICY IF EXISTS studies_patient ON imaging_studies;
DROP POLICY IF EXISTS studies_uploader_update ON imaging_studies;
DROP POLICY IF EXISTS studies_uploader_insert ON imaging_studies;
DROP POLICY IF EXISTS studies_uploader ON imaging_studies;

DROP POLICY IF EXISTS consent_receiving_doctor ON consent_records;
DROP POLICY IF EXISTS consent_referring_doctor ON consent_records;
DROP POLICY IF EXISTS consent_patient_revoke ON consent_records;
DROP POLICY IF EXISTS consent_patient_insert ON consent_records;
DROP POLICY IF EXISTS consent_patient_select ON consent_records;

DROP POLICY IF EXISTS patients_receiving_doctor ON patients_patients;
DROP POLICY IF EXISTS patients_claimed ON patients_patients;
DROP POLICY IF EXISTS patients_creator_update ON patients_patients;
DROP POLICY IF EXISTS patients_creator_insert ON patients_patients;
DROP POLICY IF EXISTS patients_creator ON patients_patients;

DROP POLICY IF EXISTS doctor_profiles_admin ON identity_doctor_profiles;
DROP POLICY IF EXISTS doctor_profiles_self ON identity_doctor_profiles;

DROP POLICY IF EXISTS users_admin_update ON identity_users;
DROP POLICY IF EXISTS users_admin ON identity_users;
DROP POLICY IF EXISTS users_discoverable_doctors ON identity_users;
DROP POLICY IF EXISTS users_self ON identity_users;

ALTER TABLE audit_events                   NO FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_events                   DISABLE ROW LEVEL SECURITY;
ALTER TABLE scheduling_appointment_studies NO FORCE ROW LEVEL SECURITY;
ALTER TABLE scheduling_appointment_studies DISABLE ROW LEVEL SECURITY;
ALTER TABLE scheduling_appointments        NO FORCE ROW LEVEL SECURITY;
ALTER TABLE scheduling_appointments        DISABLE ROW LEVEL SECURITY;
ALTER TABLE scheduling_availability        NO FORCE ROW LEVEL SECURITY;
ALTER TABLE scheduling_availability        DISABLE ROW LEVEL SECURITY;
ALTER TABLE imaging_instances              NO FORCE ROW LEVEL SECURITY;
ALTER TABLE imaging_instances              DISABLE ROW LEVEL SECURITY;
ALTER TABLE imaging_studies                NO FORCE ROW LEVEL SECURITY;
ALTER TABLE imaging_studies                DISABLE ROW LEVEL SECURITY;
ALTER TABLE consent_records                NO FORCE ROW LEVEL SECURITY;
ALTER TABLE consent_records                DISABLE ROW LEVEL SECURITY;
ALTER TABLE patients_patients              NO FORCE ROW LEVEL SECURITY;
ALTER TABLE patients_patients              DISABLE ROW LEVEL SECURITY;
ALTER TABLE identity_doctor_profiles       NO FORCE ROW LEVEL SECURITY;
ALTER TABLE identity_doctor_profiles       DISABLE ROW LEVEL SECURITY;
ALTER TABLE identity_users                 NO FORCE ROW LEVEL SECURITY;
ALTER TABLE identity_users                 DISABLE ROW LEVEL SECURITY;

DROP FUNCTION IF EXISTS app_can_see_appointment(uuid);
DROP FUNCTION IF EXISTS app_can_see_study(uuid);
DROP FUNCTION IF EXISTS app_study_linked_to_my_appointment(uuid);
DROP FUNCTION IF EXISTS app_has_consent_for(uuid);
DROP FUNCTION IF EXISTS app_has_appointment_with(uuid);
DROP FUNCTION IF EXISTS app_claimed_patient(uuid);
DROP FUNCTION IF EXISTS app_created_patient(uuid);
DROP FUNCTION IF EXISTS app_triage_before_payment();
DROP FUNCTION IF EXISTS app_current_role();
DROP FUNCTION IF EXISTS app_current_user_id();

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM mir_app;
REVOKE ALL ON SCHEMA public FROM mir_app;

-- The role itself is intentionally left in place. Dropping it would fail
-- wherever it still owns or is referenced by objects in other databases, and a
-- down migration that fails halfway is worse than one that leaves a role.

COMMIT;
