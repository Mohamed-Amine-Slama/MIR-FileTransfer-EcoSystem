-- Reverse of 0014_practice_calendar.up.sql.
--
-- Appointments recorded as 'no_show' are moved to 'completed' rather than
-- 'cancelled'. Both are lossy, but only one is dangerous: 'cancelled' is
-- outside the exclusion constraint, so a down-migration that chose it would
-- release slots that were genuinely consumed and let a later booking overlap a
-- visit that already happened.

BEGIN;

DROP INDEX IF EXISTS scheduling_appointments_doctor_day_idx;

UPDATE scheduling_appointments SET status = 'completed' WHERE status = 'no_show';

ALTER TABLE scheduling_appointments DROP CONSTRAINT scheduling_appointments_status_check;
ALTER TABLE scheduling_appointments ADD CONSTRAINT scheduling_appointments_status_check
  CHECK (status IN ('pending_payment','authorised','confirmed','cancelled','completed'));

ALTER TABLE scheduling_appointments
  DROP COLUMN created_by,
  DROP COLUMN cancel_reason,
  DROP COLUMN kind,
  DROP COLUMN notes,
  DROP COLUMN reason;

DROP POLICY IF EXISTS appointments_referring_update ON scheduling_appointments;
DROP POLICY IF EXISTS appointments_doctor_insert ON scheduling_appointments;

DROP POLICY IF EXISTS availability_bookable ON scheduling_availability;
DROP POLICY IF EXISTS availability_owner ON scheduling_availability;

CREATE POLICY availability_owner ON scheduling_availability FOR ALL
  USING (app_current_role() = 'tunisia_doctor' AND doctor_id = app_current_user_id())
  WITH CHECK (app_current_role() = 'tunisia_doctor' AND doctor_id = app_current_user_id());

CREATE POLICY availability_bookable ON scheduling_availability FOR SELECT
  USING (app_current_role() = 'patient');

DROP POLICY IF EXISTS patients_creator_update ON patients_patients;
DROP POLICY IF EXISTS patients_creator_insert ON patients_patients;
DROP POLICY IF EXISTS patients_creator ON patients_patients;

CREATE POLICY patients_creator ON patients_patients FOR SELECT
  USING (app_current_role() = 'libya_doctor' AND created_by_doctor = app_current_user_id());

CREATE POLICY patients_creator_insert ON patients_patients FOR INSERT
  WITH CHECK (app_current_role() = 'libya_doctor' AND created_by_doctor = app_current_user_id());

CREATE POLICY patients_creator_update ON patients_patients FOR UPDATE
  USING (app_current_role() = 'libya_doctor' AND created_by_doctor = app_current_user_id())
  WITH CHECK (created_by_doctor = app_current_user_id());

COMMIT;
