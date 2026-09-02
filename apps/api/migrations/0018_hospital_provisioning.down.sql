-- Reverse of 0018_hospital_provisioning.up.sql.
--
-- Organisations registered as `hospital` become `clinic`: the value is about to
-- leave the CHECK constraint, and clinic is the nearest surviving meaning.
-- Their provisioning capability disappears with the kind, which is the point.

BEGIN;

DROP POLICY IF EXISTS invitations_clinician_own ON identity_invitations;
DROP POLICY IF EXISTS invitations_clinician_assistant_insert ON identity_invitations;

ALTER TABLE identity_invitations
  DROP COLUMN full_name,
  DROP COLUMN specialty;

UPDATE identity_organisations SET kind = 'clinic' WHERE kind = 'hospital';

ALTER TABLE identity_organisations DROP CONSTRAINT identity_organisations_kind_check;
ALTER TABLE identity_organisations ADD CONSTRAINT identity_organisations_kind_check
  CHECK (kind IN ('clinic','laboratory','doctor'));

COMMIT;
