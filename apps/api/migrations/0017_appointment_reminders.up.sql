-- A marker for "the reminder has gone out".
--
-- WITHOUT THIS THE SWEEP IS NOT IDEMPOTENT. A job that selects "appointments
-- starting in the next 24 hours" and notifies them re-notifies the same people
-- on its next tick, and again after every container restart. The failure is
-- silent from the server's side and extremely loud from the patient's.
--
-- A timestamp rather than a boolean, for the same reason `granted_at` is a
-- timestamp: when it went out is the question anyone debugging a complaint
-- about a missing reminder will actually ask.

BEGIN;

ALTER TABLE scheduling_appointments
  ADD COLUMN reminder_sent_at timestamptz;

-- The sweep's own query: upcoming, confirmed, not yet reminded. Partial, so it
-- stays small — the rows it indexes are a rolling day's worth, not the history.
CREATE INDEX scheduling_appointments_reminder_due_idx
  ON scheduling_appointments (starts_at)
  WHERE reminder_sent_at IS NULL AND status = 'confirmed';

COMMIT;
