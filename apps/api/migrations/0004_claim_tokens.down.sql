-- Reverse of 0004_claim_tokens.up.sql.

BEGIN;

DROP POLICY IF EXISTS claim_tokens_issuer_insert ON patients_claim_tokens;
DROP POLICY IF EXISTS claim_tokens_issuer_select ON patients_claim_tokens;

REVOKE ALL ON patients_claim_tokens FROM mir_app;

DROP FUNCTION IF EXISTS patients_claim_with_token(text);
DROP TABLE IF EXISTS patients_claim_tokens;

COMMIT;
