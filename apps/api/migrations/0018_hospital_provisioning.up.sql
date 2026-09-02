-- Hospitals, and the accounts they provision.
--
-- WHAT `hospital` ADDS THAT `clinic` DID NOT. A hospital stands between the
-- platform and the clinicians working inside it: it invites their accounts and
-- routes appointments to them by specialty. That is the power to mint a
-- CLINICAL account, and a one-room clinic or a solo `doctor` registration must
-- not carry it — so it is a distinct kind that the application can gate on,
-- rather than a label on the existing one.
--
-- WHAT IT DOES NOT CHANGE, and this is the important half.
-- Registration still produces an `applicant` and nothing else. A hospital is an
-- organisation whose paperwork ops has checked; `identity_decide_verification`
-- remains the only path from `applicant` to a clinical role, and it still
-- DERIVES that role from the corridor rather than accepting one as an argument.
-- Choosing "hospital" on the sign-up form is a request, not a grant — exactly
-- as choosing "clinic" already was.
--
-- A hospital's invitee therefore gets their role the same way a seat invitee
-- always has: `identity_grant_membership_role`, which refuses anything outside
-- the corridor endpoint roles, and only for an APPROVED organisation. A
-- hospital that ops has not approved can invite nobody into a clinical role,
-- because the function it would have to go through says no.

BEGIN;

ALTER TABLE identity_organisations DROP CONSTRAINT identity_organisations_kind_check;
ALTER TABLE identity_organisations ADD CONSTRAINT identity_organisations_kind_check
  CHECK (kind IN ('clinic','hospital','laboratory','doctor'));

-- ---------------------------------------------------------------------------
-- What a hospital states about the clinician it is inviting.
--
-- Captured on the INVITATION rather than asked of the doctor on arrival: the
-- hospital is the party that knows which department it is hiring into, and
-- appointment routing (which matches on specialty) is broken until the value
-- exists. A doctor can correct it afterwards on their own profile.
--
-- Nullable, because an assistant invitation has no specialty and neither does
-- an ordinary seat.
-- ---------------------------------------------------------------------------
ALTER TABLE identity_invitations
  ADD COLUMN specialty  text,
  ADD COLUMN full_name  text;

-- ---------------------------------------------------------------------------
-- Who may invite whom.
--
-- Until now only an OWNER could create an invitation, which is right for a seat
-- that carries a clinical role: handing those out is how a practice acquires
-- clinicians, and it belongs to whoever owns the account.
--
-- An ASSISTANT seat is different in kind. It grants no clinical access at all
-- (0015), and the person who knows they need a receptionist is the doctor, not
-- the organisation's owner — who, in a hospital, may be an administrator three
-- floors away. So a seated clinician may invite an assistant and nothing else.
--
-- The seat_role condition is inside the policy, not left to the service: this is
-- the line between "can hire a receptionist" and "can mint a doctor".
-- ---------------------------------------------------------------------------
CREATE POLICY invitations_clinician_assistant_insert ON identity_invitations FOR INSERT
  WITH CHECK (
    app_current_role() IN ('libya_doctor','tunisia_doctor')
    AND app_member_of(organisation_id)
    AND invited_by = app_current_user_id()
    AND seat_role = 'assistant'
  );

-- A clinician sees the invitations they themselves sent, so the screen that
-- created one can show it as outstanding. Not the organisation's others.
CREATE POLICY invitations_clinician_own ON identity_invitations FOR SELECT
  USING (
    app_current_role() IN ('libya_doctor','tunisia_doctor')
    AND invited_by = app_current_user_id()
  );

COMMIT;
