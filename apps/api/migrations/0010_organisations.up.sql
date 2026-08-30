-- Brief §3, §5.1, §5.5 — organisations, seats, and the verification decision.
--
-- WHAT THIS MAKES REAL. `Provider` in packages/contracts has existed since the
-- case layer was designed, but only as a fixture: apps/web/lib/api/mock/ served
-- it and nothing in Postgres held one. Sign-up needs somewhere to put the
-- application, seats need somewhere to count, and the verification decision
-- needs somewhere to be recorded, so the organisation becomes a table here.
--
-- THE CENTRAL RULE OF THIS FILE: approving an organisation is what grants a
-- clinical role. Registration (0009) can only ever produce an `applicant`, and
-- an applicant matches no policy in this schema. `identity_decide_verification`
-- below is the single place where that changes, it is restricted to ops, and it
-- derives the role from the CORRIDOR rather than accepting one — so there is no
-- argument to it that grants a role the corridor does not define (§4.3).
--
-- L1 REMAINS OPEN. Nothing here asserts that the cross-border transfer is
-- lawful; an approved organisation is one whose paperwork ops has checked, and
-- that is all the word means in this schema.

BEGIN;

-- ---------------------------------------------------------------------------
-- The organisation.
--
-- `side` excludes 'ops' structurally, mirroring `EndpointSide` in the contract:
-- platform staff are not a provider, and §3 requires the two sign-up paths stay
-- separate rather than being one form gated by a role dropdown. There is no
-- value of this table that creates platform staff.
-- ---------------------------------------------------------------------------
CREATE TABLE identity_organisations (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  kind                text NOT NULL CHECK (kind IN ('clinic','laboratory','doctor')),
  legal_name          text NOT NULL,

  -- Opaque to the database on purpose. Corridors are configured in the
  -- application (lib/corridor/registry.ts is the one file that names a
  -- country); a foreign key to a corridors table would move that configuration
  -- into a migration and make adding one a schema change (§4.3).
  corridor_id         text NOT NULL,
  side                text NOT NULL CHECK (side IN ('source','destination')),

  verification_status text NOT NULL DEFAULT 'pending'
                        CHECK (verification_status IN ('pending','approved','rejected')),
  submitted_at        timestamptz NOT NULL DEFAULT now(),
  decided_at          timestamptz,
  decided_by          uuid REFERENCES identity_users(id),
  -- A dictionary key, never free text: an ops reviewer's English sentence is
  -- unreadable to an Arabic-speaking applicant (§4.2).
  reason_key          text,

  -- Shape comes from the corridor's documentRequirements, which the database
  -- has no opinion about. Validated against the corridor in the application.
  credentials         jsonb NOT NULL DEFAULT '{}'::jsonb,

  seat_count          integer NOT NULL DEFAULT 1 CHECK (seat_count >= 1),
  created_at          timestamptz NOT NULL DEFAULT now(),

  -- Mirrors `providerVerificationSchema`'s refinement, so "rejected, blank
  -- date" is unrepresentable in the database as well as in the contract.
  CONSTRAINT organisations_decided_has_date
    CHECK (verification_status = 'pending' OR decided_at IS NOT NULL)
);

CREATE INDEX identity_organisations_queue_idx
  ON identity_organisations (verification_status, submitted_at);

-- ---------------------------------------------------------------------------
-- Seats — brief §5.5 P1.
--
-- A JOIN TABLE, NOT A COLUMN ON THE USER. A radiologist reading for two
-- practices is ordinary, and `organisation_id` on `identity_users` makes that
-- unrepresentable — after which supporting it is a data migration rather than a
-- schema one.
-- ---------------------------------------------------------------------------
CREATE TABLE identity_memberships (
  organisation_id  uuid NOT NULL REFERENCES identity_organisations(id),
  user_id          uuid NOT NULL REFERENCES identity_users(id),
  seat_role        text NOT NULL DEFAULT 'member' CHECK (seat_role IN ('owner','member')),
  invited_by       uuid REFERENCES identity_users(id),
  accepted_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organisation_id, user_id)
);

CREATE INDEX identity_memberships_user_idx ON identity_memberships (user_id);

CREATE TABLE identity_invitations (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  organisation_id  uuid NOT NULL REFERENCES identity_organisations(id),
  email            text NOT NULL,
  -- SHA-256 only. Whoever holds this token joins the organisation and can then
  -- read its cases; it is as much a bearer credential as a claim token.
  token_hash       text NOT NULL UNIQUE,
  seat_role        text NOT NULL DEFAULT 'member' CHECK (seat_role IN ('owner','member')),
  invited_by       uuid NOT NULL REFERENCES identity_users(id),
  expires_at       timestamptz NOT NULL,
  consumed_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX identity_invitations_org_idx ON identity_invitations (organisation_id)
  WHERE consumed_at IS NULL;

-- ---------------------------------------------------------------------------
-- Relationship helpers.
--
-- SECURITY DEFINER for the reason given at length in 0002_rls.up.sql: a
-- cross-table lookup inside a policy re-enters the target table's own policies
-- and PostgreSQL aborts with "infinite recursion detected in policy". Each
-- follows the same four rules — STABLE, returns a boolean and never a row or an
-- id, takes no caller identity (it reads app_current_user_id(), so a caller can
-- only ask about their OWN relationship), and pins search_path.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_member_of(p_org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM identity_memberships
    WHERE organisation_id = p_org AND user_id = app_current_user_id()
  );
$$;

CREATE OR REPLACE FUNCTION app_owns_org(p_org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM identity_memberships
    WHERE organisation_id = p_org
      AND user_id = app_current_user_id()
      AND seat_role = 'owner'
  );
$$;

-- ---------------------------------------------------------------------------
-- Creating an organisation.
--
-- A chicken-and-egg like the patient claim: the applicant cannot INSERT a
-- membership for an organisation that does not exist yet, and cannot be a
-- member of the organisation they are about to create. Rather than loosening
-- the policies — which would let anyone insert a membership into anyone's
-- organisation — the whole operation is one function that creates the record
-- and seats the creator as its owner, atomically.
--
-- It refuses a caller who is not an applicant. An approved clinician starting a
-- second organisation is a real case, but it is one that needs an ops decision
-- of its own rather than a side door out of this function.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION identity_create_organisation(
  p_kind        text,
  p_legal_name  text,
  p_corridor_id text,
  p_side        text,
  p_credentials jsonb,
  p_seat_count  integer
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid := app_current_user_id();
  v_org  uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'no authenticated user' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF app_current_role() IS DISTINCT FROM 'applicant' THEN
    RAISE EXCEPTION 'only a pending applicant may register an organisation'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- One application at a time. Without this, a refused applicant can submit
  -- repeatedly and bury the ops queue.
  IF EXISTS (SELECT 1 FROM identity_memberships WHERE user_id = v_user) THEN
    RAISE EXCEPTION 'this account already belongs to an organisation'
      USING ERRCODE = 'unique_violation';
  END IF;

  INSERT INTO identity_organisations (kind, legal_name, corridor_id, side, credentials, seat_count)
  VALUES (p_kind, p_legal_name, p_corridor_id, p_side, p_credentials, p_seat_count)
  RETURNING id INTO v_org;

  INSERT INTO identity_memberships (organisation_id, user_id, seat_role)
  VALUES (v_org, v_user, 'owner');

  RETURN v_org;
END;
$$;

-- ---------------------------------------------------------------------------
-- The verification decision — the only path from `applicant` to a clinical role.
--
-- THE ROLE IS DERIVED, NOT SUPPLIED. It is read from the corridor endpoint the
-- organisation registered for, which the caller chose at sign-up and ops has
-- just checked the paperwork for. An ops account cannot use this to mint an
-- arbitrary role, and a future caller cannot pass one.
--
-- The corridor's role mapping lives in the application (§4.3), so it arrives as
-- a parameter — but a parameter ops does not choose: the service resolves it
-- from `corridor_id` and `side` on the row itself, and the function refuses any
-- role outside the clinical set.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION identity_decide_verification(
  p_org         uuid,
  p_approve     boolean,
  p_reason_key  text,
  p_granted_role text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := app_current_user_id();
BEGIN
  IF app_current_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'only platform staff may decide a verification'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_approve AND p_granted_role NOT IN ('libya_doctor','tunisia_doctor') THEN
    -- Belt and braces alongside the derivation in the service: 'admin' and
    -- 'patient' are not grantable by this route at any cost.
    RAISE EXCEPTION 'a verification may only grant a corridor endpoint role'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE identity_organisations
  SET verification_status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
      decided_at = now(),
      decided_by = v_actor,
      reason_key = p_reason_key
  WHERE id = p_org AND verification_status = 'pending';

  IF NOT FOUND THEN
    -- Already decided, or no such organisation. Re-deciding would silently
    -- move an approved provider back to pending and revoke access nobody asked
    -- to revoke.
    RAISE EXCEPTION 'no pending organisation with that id' USING ERRCODE = 'no_data_found';
  END IF;

  IF p_approve THEN
    -- Every seated member gains the role. A rejection grants nothing and takes
    -- nothing away — the account simply stays an applicant.
    UPDATE identity_users
    SET role = p_granted_role, status = 'active'
    WHERE id IN (SELECT user_id FROM identity_memberships WHERE organisation_id = p_org)
      AND role = 'applicant';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Accepting a seat invitation.
--
-- Definer again, and for the now-familiar reason: the invitee is by definition
-- not yet a member, so no policy on `identity_memberships` can admit their
-- INSERT. The token is the credential, single use is enforced in the WHERE
-- clause, and the seat limit is re-checked HERE rather than only at invite time
-- — an owner who lowered `seat_count` after sending invitations must not end up
-- over it because five people accepted at once.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION identity_accept_invitation(p_token_hash text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user  uuid := app_current_user_id();
  v_id    uuid;
  v_org   uuid;
  v_role  text;
  v_email text;
  v_seats integer;
  v_taken integer;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'no authenticated user' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT id, organisation_id, seat_role, email
    INTO v_id, v_org, v_role, v_email
  FROM identity_invitations
  WHERE token_hash = p_token_hash AND consumed_at IS NULL AND expires_at > now();

  IF v_id IS NULL THEN
    RETURN NULL;  -- unknown, expired, or already used — indistinguishable
  END IF;

  -- The invitation is bound to the address it was sent to. Without this, a
  -- forwarded email lets whoever received it join instead of the invitee.
  IF NOT EXISTS (
    SELECT 1 FROM identity_users WHERE id = v_user AND lower(email) = lower(v_email)
  ) THEN
    RETURN NULL;
  END IF;

  SELECT seat_count INTO v_seats FROM identity_organisations WHERE id = v_org;
  SELECT count(*) INTO v_taken FROM identity_memberships WHERE organisation_id = v_org;

  IF v_taken >= v_seats THEN
    RAISE EXCEPTION 'no seat available' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE identity_invitations SET consumed_at = now()
  WHERE id = v_id AND consumed_at IS NULL;

  IF NOT FOUND THEN
    RETURN NULL;  -- lost a race with a concurrent redemption
  END IF;

  INSERT INTO identity_memberships (organisation_id, user_id, seat_role, invited_by)
  SELECT v_org, v_user, v_role, invited_by FROM identity_invitations WHERE id = v_id;

  -- The invitee is seated but NOT yet granted a role. Joining an approved
  -- organisation should grant one immediately, and that needs the corridor's
  -- role mapping, which lives in the application (§4.3) and must not be
  -- embedded here. The service follows up with identity_grant_membership_role,
  -- which is a no-op for a pending organisation — so an invitee who joins
  -- before the decision simply stays an applicant until it lands.
  RETURN v_org;
END;
$$;

COMMENT ON FUNCTION identity_accept_invitation(text) IS
  'Seats an invitee. Role assignment for an invitee joining an already-approved '
  'organisation is done by the service via identity_grant_membership_role, which '
  'resolves the corridor role — this function deliberately does not embed the '
  'corridor mapping (brief 4.3).';

-- ---------------------------------------------------------------------------
-- Granting the corridor role to one member.
--
-- Separated from acceptance so the corridor mapping stays in the application.
-- Same guard as the decision function: only an endpoint role, never 'admin'.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION identity_grant_membership_role(p_org uuid, p_user uuid, p_role text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_role NOT IN ('libya_doctor','tunisia_doctor') THEN
    RAISE EXCEPTION 'a membership may only grant a corridor endpoint role'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE identity_users
  SET role = p_role, status = 'active'
  WHERE id = p_user
    AND role = 'applicant'
    AND EXISTS (
      SELECT 1 FROM identity_memberships m
      JOIN identity_organisations o ON o.id = m.organisation_id
      WHERE m.organisation_id = p_org
        AND m.user_id = p_user
        AND o.verification_status = 'approved'
    );
END;
$$;

-- ---------------------------------------------------------------------------
-- Access control.
--
-- Members read their own organisation; ops reads and decides on all of them.
-- Nobody UPDATEs an organisation through a policy — the verification decision
-- is the only mutation, and it goes through the function above so that
-- "approved" and "the members hold a role" can never disagree.
--
-- Invitations are readable and writable by an OWNER only. A member seeing the
-- outstanding invitation list is harmless; a member creating one is how a seat
-- gets handed to someone the practice did not agree to.
-- ---------------------------------------------------------------------------
ALTER TABLE identity_organisations ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_organisations FORCE  ROW LEVEL SECURITY;
ALTER TABLE identity_memberships   ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_memberships   FORCE  ROW LEVEL SECURITY;
ALTER TABLE identity_invitations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_invitations   FORCE  ROW LEVEL SECURITY;

CREATE POLICY organisations_member ON identity_organisations FOR SELECT
  USING (app_member_of(id));

CREATE POLICY organisations_ops ON identity_organisations FOR SELECT
  USING (app_current_role() = 'admin');

CREATE POLICY memberships_same_org ON identity_memberships FOR SELECT
  USING (app_member_of(organisation_id));

CREATE POLICY memberships_ops ON identity_memberships FOR SELECT
  USING (app_current_role() = 'admin');

CREATE POLICY invitations_owner ON identity_invitations FOR SELECT
  USING (app_owns_org(organisation_id));

CREATE POLICY invitations_owner_insert ON identity_invitations FOR INSERT
  WITH CHECK (app_owns_org(organisation_id) AND invited_by = app_current_user_id());

-- Revoking an outstanding invitation is an UPDATE (consumed_at), never a
-- DELETE: nothing in this schema grants DELETE to the application.
CREATE POLICY invitations_owner_update ON identity_invitations FOR UPDATE
  USING (app_owns_org(organisation_id))
  WITH CHECK (app_owns_org(organisation_id));

GRANT SELECT ON identity_organisations TO mir_app;
GRANT SELECT ON identity_memberships TO mir_app;
GRANT SELECT, INSERT, UPDATE ON identity_invitations TO mir_app;

GRANT EXECUTE ON FUNCTION app_member_of(uuid) TO mir_app;
GRANT EXECUTE ON FUNCTION app_owns_org(uuid) TO mir_app;
GRANT EXECUTE ON FUNCTION identity_create_organisation(text, text, text, text, jsonb, integer) TO mir_app;
GRANT EXECUTE ON FUNCTION identity_decide_verification(uuid, boolean, text, text) TO mir_app;
GRANT EXECUTE ON FUNCTION identity_accept_invitation(text) TO mir_app;
GRANT EXECUTE ON FUNCTION identity_grant_membership_role(uuid, uuid, text) TO mir_app;

COMMIT;
