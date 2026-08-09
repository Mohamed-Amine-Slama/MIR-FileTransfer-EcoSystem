-- Reverse of 0003_consent_terms.up.sql.

BEGIN;

DROP POLICY IF EXISTS consent_terms_readable ON consent_terms;
REVOKE ALL ON consent_terms FROM mir_app;

ALTER TABLE consent_records DROP CONSTRAINT IF EXISTS consent_records_terms_fk;
ALTER TABLE consent_records DROP COLUMN IF EXISTS terms_scope;

DROP TRIGGER IF EXISTS consent_terms_immutable_trg ON consent_terms;
DROP FUNCTION IF EXISTS consent_terms_immutable();
DROP TABLE IF EXISTS consent_terms;

COMMIT;
