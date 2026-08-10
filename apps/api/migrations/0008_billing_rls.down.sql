BEGIN;
DROP POLICY IF EXISTS appointments_admin_update ON scheduling_appointments;
DROP POLICY IF EXISTS appointments_admin ON scheduling_appointments;
COMMIT;
