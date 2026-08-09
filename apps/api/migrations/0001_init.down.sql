-- Reverse of 0001_init.up.sql (P3.1 gate requires up -> down -> up to succeed).

BEGIN;

DROP TABLE IF EXISTS audit_events;
DROP TABLE IF EXISTS scheduling_appointment_studies;
DROP TABLE IF EXISTS scheduling_appointments;
DROP TABLE IF EXISTS scheduling_availability;
DROP TABLE IF EXISTS imaging_instances;
DROP TABLE IF EXISTS imaging_studies;
DROP TABLE IF EXISTS consent_records;
DROP TABLE IF EXISTS patients_patients;
DROP TABLE IF EXISTS identity_doctor_profiles;
DROP TABLE IF EXISTS identity_users;

DROP FUNCTION IF EXISTS uuid_generate_v7();

-- Extensions are intentionally NOT dropped. They may be shared with other
-- schemas in the same database, and dropping btree_gist would silently break
-- any other exclusion constraint that depends on it.

COMMIT;
