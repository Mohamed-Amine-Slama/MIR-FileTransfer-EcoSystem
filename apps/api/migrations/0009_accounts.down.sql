-- Reverse of 0009_accounts.up.sql.
--
-- The role CHECK is restored to the four P3.1 roles. Any `applicant` row would
-- violate it, so those are demoted to 'patient' first — the least-privileged
-- surviving role, and the honest answer for an account whose whole meaning was
-- "not yet granted anything".

BEGIN;

DROP POLICY IF EXISTS users_self_update ON identity_users;
DROP TRIGGER IF EXISTS identity_users_guard_privileged ON identity_users;
DROP FUNCTION IF EXISTS identity_guard_privileged_columns();

DROP POLICY IF EXISTS preferences_own_update ON identity_user_preferences;
DROP POLICY IF EXISTS preferences_own_insert ON identity_user_preferences;
DROP POLICY IF EXISTS preferences_own_select ON identity_user_preferences;

REVOKE ALL ON identity_user_preferences, identity_email_verifications FROM mir_app;

DROP FUNCTION IF EXISTS identity_register_account(text, text, text, text, text);
DROP FUNCTION IF EXISTS identity_issue_email_code(text, text, integer);
DROP FUNCTION IF EXISTS identity_verify_email(text, text);

DROP TABLE IF EXISTS identity_email_verifications;
DROP TABLE IF EXISTS identity_user_preferences;

UPDATE identity_users SET role = 'patient' WHERE role = 'applicant';

ALTER TABLE identity_users DROP CONSTRAINT identity_users_role_check;
ALTER TABLE identity_users ADD CONSTRAINT identity_users_role_check
  CHECK (role IN ('libya_doctor','tunisia_doctor','patient','admin'));

DROP INDEX IF EXISTS identity_users_email_idx;
ALTER TABLE identity_users DROP COLUMN IF EXISTS job_title;
ALTER TABLE identity_users DROP COLUMN IF EXISTS email;

COMMIT;
