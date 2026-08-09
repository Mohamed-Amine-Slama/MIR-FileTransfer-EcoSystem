-- Reverse of 0005_upload_sessions.up.sql.

BEGIN;

DROP POLICY IF EXISTS upload_files_owner ON imaging_upload_files;
DROP POLICY IF EXISTS upload_sessions_owner ON imaging_upload_sessions;

REVOKE ALL ON imaging_upload_files, imaging_upload_sessions FROM mir_app;

DROP FUNCTION IF EXISTS app_owns_upload_session(uuid);

DROP TABLE IF EXISTS imaging_upload_files;
DROP TABLE IF EXISTS imaging_upload_sessions;

COMMIT;
