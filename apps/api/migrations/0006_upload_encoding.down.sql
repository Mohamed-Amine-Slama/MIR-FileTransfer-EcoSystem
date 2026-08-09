BEGIN;
ALTER TABLE imaging_upload_files DROP COLUMN IF EXISTS content_encoding;
COMMIT;
