-- Reverse of 0010_organisations.up.sql.
--
-- Members granted a clinical role by a verification decision are demoted back
-- to 'applicant': the record that justified the grant is being dropped, and
-- leaving the role behind would outlive its evidence. Accounts that held a
-- clinical role before this migration existed are untouched, because they have
-- no membership row.

BEGIN;

DROP POLICY IF EXISTS invitations_owner_update ON identity_invitations;
DROP POLICY IF EXISTS invitations_owner_insert ON identity_invitations;
DROP POLICY IF EXISTS invitations_owner ON identity_invitations;
DROP POLICY IF EXISTS memberships_ops ON identity_memberships;
DROP POLICY IF EXISTS memberships_same_org ON identity_memberships;
DROP POLICY IF EXISTS organisations_ops ON identity_organisations;
DROP POLICY IF EXISTS organisations_member ON identity_organisations;

REVOKE ALL ON identity_invitations, identity_memberships, identity_organisations FROM mir_app;

UPDATE identity_users SET role = 'applicant'
WHERE id IN (SELECT user_id FROM identity_memberships)
  AND role IN ('libya_doctor','tunisia_doctor');

DROP FUNCTION IF EXISTS identity_grant_membership_role(uuid, uuid, text);
DROP FUNCTION IF EXISTS identity_accept_invitation(text);
DROP FUNCTION IF EXISTS identity_decide_verification(uuid, boolean, text, text);
DROP FUNCTION IF EXISTS identity_create_organisation(text, text, text, text, jsonb, integer);
DROP FUNCTION IF EXISTS app_owns_org(uuid);
DROP FUNCTION IF EXISTS app_member_of(uuid);

DROP TABLE IF EXISTS identity_invitations;
DROP TABLE IF EXISTS identity_memberships;
DROP TABLE IF EXISTS identity_organisations;

COMMIT;
