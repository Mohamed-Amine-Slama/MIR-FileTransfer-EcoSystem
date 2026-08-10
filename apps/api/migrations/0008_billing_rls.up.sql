-- BUILD_SPEC P11 — let payment state transitions reach the appointment.
--
-- THE BUG THIS FIXES:
-- billing runs provider-driven transitions under a system identity (role
-- 'admin'), but scheduling_appointments had no admin UPDATE policy. The
-- UPDATE therefore matched zero rows — and an UPDATE that matches nothing is
-- NOT an error. Payments captured cleanly while the appointment stayed at
-- 'pending_payment' forever: the doctor never saw a confirmed booking, the
-- patient was charged, and no log line said anything was wrong.
--
-- SCOPE: admin may read and update APPOINTMENTS. That is consistent with §1.1,
-- which gives the platform admin support and verification duties. It grants
-- nothing toward imaging — admins still cannot see a single study (there is no
-- admin policy on imaging_studies, and the P3.2 suite asserts that).

BEGIN;

CREATE POLICY appointments_admin ON scheduling_appointments FOR SELECT
  USING (app_current_role() = 'admin');

CREATE POLICY appointments_admin_update ON scheduling_appointments FOR UPDATE
  USING (app_current_role() = 'admin')
  WITH CHECK (app_current_role() = 'admin');

COMMIT;
