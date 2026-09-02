-- Reverse of 0017_appointment_reminders.up.sql.

BEGIN;

DROP INDEX IF EXISTS scheduling_appointments_reminder_due_idx;
ALTER TABLE scheduling_appointments DROP COLUMN reminder_sent_at;

COMMIT;
