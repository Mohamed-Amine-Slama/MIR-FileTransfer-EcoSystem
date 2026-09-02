-- Reverse of 0015_assistant.up.sql.
--
-- Assistant accounts are demoted to 'applicant' — the role is about to stop
-- existing in the CHECK constraint, and an account left holding it would fail
-- every subsequent write to its own row. 'applicant' is the correct landing
-- place for the same reason it is the landing place for a rejected verification:
-- it is granted nothing.

BEGIN;

DROP FUNCTION IF EXISTS scheduling_assistant_patient_search(text);
DROP FUNCTION IF EXISTS scheduling_assistant_agenda(timestamptz, timestamptz);
DROP FUNCTION IF EXISTS identity_grant_assistant_role(uuid, uuid);

DROP POLICY IF EXISTS patients_assistant_insert ON patients_patients;
DROP POLICY IF EXISTS appointments_assistant_update ON scheduling_appointments;
DROP POLICY IF EXISTS appointments_assistant_insert ON scheduling_appointments;
DROP POLICY IF EXISTS appointments_assistant ON scheduling_appointments;
DROP POLICY IF EXISTS availability_assistant ON scheduling_availability;

DROP FUNCTION IF EXISTS app_assistant_patient(uuid);
DROP FUNCTION IF EXISTS app_assists_doctor(uuid);

UPDATE identity_users SET role = 'applicant' WHERE role = 'assistant';
UPDATE identity_memberships SET seat_role = 'member' WHERE seat_role = 'assistant';
UPDATE identity_invitations SET seat_role = 'member' WHERE seat_role = 'assistant';

ALTER TABLE identity_invitations DROP CONSTRAINT identity_invitations_seat_role_check;
ALTER TABLE identity_invitations ADD CONSTRAINT identity_invitations_seat_role_check
  CHECK (seat_role IN ('owner','member'));

ALTER TABLE identity_memberships DROP CONSTRAINT identity_memberships_seat_role_check;
ALTER TABLE identity_memberships ADD CONSTRAINT identity_memberships_seat_role_check
  CHECK (seat_role IN ('owner','member'));

ALTER TABLE identity_users DROP CONSTRAINT identity_users_role_check;
ALTER TABLE identity_users ADD CONSTRAINT identity_users_role_check
  CHECK (role IN ('libya_doctor','tunisia_doctor','patient','admin','applicant'));

COMMIT;
