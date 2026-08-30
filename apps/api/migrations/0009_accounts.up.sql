-- Brief §5.1 — self-service accounts, email verification, and preferences.
--
-- WHAT THIS ADDS AND WHY IT IS SHAPED THIS WAY.
--
-- Until now every `identity_users` row was provisioned out of band: someone
-- created it alongside a Keycloak user, and the application only ever read it.
-- §5.1 P0 requires providers to sign themselves up, which means the row is now
-- created by an unauthenticated request — and that changes the threat model of
-- this table, not just its columns.
--
-- THREE RULES FOLLOW FROM THAT.
--
-- 1. **A self-registered account gets the `applicant` role, never a clinical
--    one.** The role is what the RLS policies and the auth guard key on, so a
--    sign-up form that could set it would be a stranger asserting
--    `tunisia_doctor` about themselves over the internet. No policy in this
--    schema names `applicant`, so such an account matches nothing and reads
--    nothing — it is fail-closed by construction, not by review. The clinical
--    role is granted when ops approves the organisation (migration 0010).
--
-- 2. **The verification code is stored only as a SHA-256**, exactly as
--    `patients_claim_tokens` stores the claim token, and for the same reason: it
--    is a bearer credential, and a read-only database leak or a stray log line
--    must not be enough to activate someone else's account.
--
-- 3. **Verification runs through one SECURITY DEFINER function.** The caller is
--    unauthenticated by definition — they are proving who they are — so there
--    is no useful RLS context to run under. Rather than widening a policy or
--    handing the endpoint an admin connection, the whole operation is a single
--    narrow function that takes an address and a hash and returns one id.
--
-- This migration is additive and reversible. `email` is NULLABLE because rows
-- provisioned before self-registration existed have no address to backfill,
-- and inventing one would be worse than admitting the gap.

BEGIN;

-- ---------------------------------------------------------------------------
-- identity_users: an address to sign in with, and room for the new role.
-- ---------------------------------------------------------------------------

ALTER TABLE identity_users ADD COLUMN email      text;
ALTER TABLE identity_users ADD COLUMN job_title  text;

/*
 * Unique on the LOWERCASED address.
 *
 * A plain UNIQUE would let "Amal@clinic.test" and "amal@clinic.test" both
 * exist, and then sign-in resolves to whichever the query happened to match.
 * The functional index makes the two the same account at the storage layer, so
 * it holds even if a future writer forgets to normalise.
 */
CREATE UNIQUE INDEX identity_users_email_idx ON identity_users (lower(email));

-- The role set is defined once in packages/contracts/src/roles.ts and mirrored
-- here; the two must be changed together, which is the awkwardness that file
-- describes as deliberate.
ALTER TABLE identity_users DROP CONSTRAINT identity_users_role_check;
ALTER TABLE identity_users ADD CONSTRAINT identity_users_role_check
  CHECK (role IN ('libya_doctor','tunisia_doctor','patient','admin','applicant'));

-- ---------------------------------------------------------------------------
-- Preferences.
--
-- A separate table rather than more columns on identity_users: this is the row
-- a user rewrites from a settings screen, and keeping it apart means a
-- preference write can never touch the row that carries their role and status.
-- The UPDATE policy below is scoped to this table alone for exactly that reason.
-- ---------------------------------------------------------------------------
CREATE TABLE identity_user_preferences (
  user_id       uuid PRIMARY KEY REFERENCES identity_users(id),

  theme         text NOT NULL DEFAULT 'system'
                  CHECK (theme IN ('light','dark','system')),

  -- UI locale, so English is permitted here. Note this is deliberately WIDER
  -- than `identity_users.locale`, which is CHECK (locale IN ('ar','fr')):
  -- English is an admin presentation language and must never reach a column
  -- whose value is shown to a patient (brief §4.2).
  locale        text NOT NULL DEFAULT 'ar'
                  CHECK (locale IN ('ar','fr','en')),

  -- IANA zone name. Instants in this system cross three zones (P10.1), so the
  -- one the user reads in is stored rather than guessed per request.
  timezone      text NOT NULL DEFAULT 'UTC',

  -- Email and SMS are reminders ABOUT the in-app notification centre, and
  -- those are the user's to refuse. There is deliberately no in-app switch:
  -- §5.6 P0 makes case-level notification a requirement, and a provider must
  -- not be able to silently opt out of being told a case needs them.
  notify_email  boolean NOT NULL DEFAULT true,
  notify_sms    boolean NOT NULL DEFAULT true,

  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Email verification codes.
-- ---------------------------------------------------------------------------
CREATE TABLE identity_email_verifications (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id      uuid NOT NULL REFERENCES identity_users(id),

  -- SHA-256 of the six digits. Never the digits.
  code_hash    text NOT NULL,

  -- Denormalised from the user row at issue time, so changing an address
  -- afterwards cannot redirect an outstanding code to a new inbox. Same
  -- reasoning as `patients_claim_tokens.phone_e164`.
  email        text NOT NULL,

  purpose      text NOT NULL CHECK (purpose IN ('signup','email_change')),

  -- Guesses spent against THIS code. Six digits is a million possibilities,
  -- which is only adequate alongside this cap, the expiry, and the request-rate
  -- budget in shared/ratelimit. None of the three is optional.
  attempts     integer NOT NULL DEFAULT 0,

  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX identity_email_verifications_user_idx
  ON identity_email_verifications (user_id, created_at DESC);

-- Finds the live code for an address without scanning. Partial, because a
-- consumed or expired row is never a candidate.
CREATE INDEX identity_email_verifications_live_idx
  ON identity_email_verifications (lower(email), purpose)
  WHERE consumed_at IS NULL;

-- ---------------------------------------------------------------------------
-- Registration.
--
-- WHY THIS IS A FUNCTION AND NOT AN INSERT POLICY.
--
-- `identity_users` has no INSERT policy at all — before self-service sign-up,
-- every row was provisioned out of band and nothing needed one. Adding a policy
-- would have meant writing a rule permitting an unauthenticated caller to
-- insert a row into the table that decides everyone's access, and then relying
-- on the service layer to pass the right role every time.
--
-- A function is a stronger statement. `role` and `status` are not parameters:
-- they are literals in the body. There is no argument to this function, and no
-- combination of arguments, that produces a clinical account. The guarantee
-- holds against a caller who has read the source and is trying.
--
-- Returns NULL when the address or phone is already taken, so the caller can
-- answer identically either way rather than leaking which one collided.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION identity_register_account(
  p_keycloak_sub text,
  p_email        text,
  p_full_name    text,
  p_phone_e164   text,
  p_locale       text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO identity_users (keycloak_sub, role, phone_e164, full_name, email, locale, status)
  VALUES (
    p_keycloak_sub,
    -- NOT a parameter. See the note above.
    'applicant',
    p_phone_e164,
    p_full_name,
    lower(p_email),
    -- The user row's locale is CHECK (locale IN ('ar','fr')) — English is an
    -- admin presentation language and must never reach a column a patient
    -- reads (§4.2). A UI locale of 'en' is narrowed to the platform default
    -- here rather than rejected, because the sign-up form legitimately offers
    -- English and refusing the submission would be a baffling error.
    CASE WHEN p_locale IN ('ar','fr') THEN p_locale ELSE 'ar' END,
    'pending_verification'
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RETURN NULL;  -- address or phone already registered
  END IF;

  -- Preferences exist from the first moment, so every read path can assume a
  -- row and no screen has to invent defaults that drift from the schema's.
  INSERT INTO identity_user_preferences (user_id, locale)
  VALUES (v_id, CASE WHEN p_locale IN ('ar','fr','en') THEN p_locale ELSE 'ar' END);

  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Redemption, as a SECURITY DEFINER function.
--
-- WHY THE EMAIL IS A PARAMETER AND THE CLAIM FLOW'S IS NOT.
-- `patients_claim_with_token` derives the phone number from the AUTHENTICATED
-- user, so a caller can only ever claim against their own handset. There is no
-- authenticated user here — verifying the address is what turns a registration
-- into an account — so the address must be supplied. What keeps that safe is
-- that the code is the credential: the function reveals nothing to a caller who
-- does not already hold six correct digits, and every failure returns NULL
-- rather than saying which of the four reasons applied.
--
-- The attempt counter is why the address is needed at all. On a wrong code
-- there is no row to find by hash, so there would be nothing to increment and
-- the cap would not exist.
--
-- MAX ATTEMPTS IS HARDCODED, NOT A PARAMETER. A limit the caller supplies is a
-- limit the caller can raise. `VERIFICATION_MAX_ATTEMPTS` in
-- packages/contracts/src/account.ts must agree with the literal below, and
-- identity/internal/verification-limits.test.ts asserts that it does.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION identity_verify_email(p_email text, p_code_hash text)
RETURNS TABLE (user_id uuid, keycloak_sub text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_max_attempts constant integer := 5;
  v_id      uuid;
  v_user    uuid;
  v_hash    text;
  v_tries   integer;
BEGIN
  -- The newest live code for this address. Older ones are ignored rather than
  -- deleted, so re-sending does not invalidate a code already in flight to a
  -- slow mail relay — it simply stops being the one that works.
  -- Every column is table-qualified. `RETURNS TABLE (user_id …)` declares
  -- `user_id` as an OUT variable, and an unqualified reference to it here is
  -- ambiguous against this table's own column — plpgsql raises rather than
  -- guessing, which is the right call and a surprising one to meet at runtime.
  SELECT v.id, v.user_id, v.code_hash, v.attempts
    INTO v_id, v_user, v_hash, v_tries
  FROM identity_email_verifications v
  WHERE lower(v.email) = lower(p_email)
    AND v.purpose = 'signup'
    AND v.consumed_at IS NULL
    AND v.expires_at > now()
  ORDER BY v.created_at DESC
  LIMIT 1;

  IF v_id IS NULL THEN
    RETURN;  -- unknown address, or no live code
  END IF;

  IF v_tries >= v_max_attempts THEN
    RETURN;  -- burnt; a fresh code must be requested
  END IF;

  IF v_hash IS DISTINCT FROM p_code_hash THEN
    UPDATE identity_email_verifications SET attempts = attempts + 1 WHERE id = v_id;
    RETURN;
  END IF;

  -- Single-use enforced in the WHERE clause, so two concurrent redemptions
  -- cannot both succeed: exactly one flips consumed_at from NULL.
  UPDATE identity_email_verifications
  SET consumed_at = now()
  WHERE id = v_id AND consumed_at IS NULL;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Activating the account is part of the same statement pair. A verified code
  -- that left the user 'pending_verification' would be a silent dead end.
  UPDATE identity_users
  SET status = 'active'
  WHERE id = v_user AND status = 'pending_verification';

  /*
   * The Keycloak subject comes back with the id.
   *
   * The caller must also enable the account upstream — it was created disabled
   * so that registering against someone else's address grants no working login
   * — and it cannot look the subject up itself: that read would run under the
   * anonymous RLS context, where `users_self` matches nothing and the query
   * returns no rows. Returning it here is what keeps the two halves of
   * activation in one place instead of widening a policy to reach the second.
   */
  RETURN QUERY
    SELECT u.id, u.keycloak_sub FROM identity_users u WHERE u.id = v_user;
END;
$$;

-- ---------------------------------------------------------------------------
-- Issuing, also SECURITY DEFINER and for the same reason: registration and
-- resend are both unauthenticated.
--
-- It takes the address rather than a user id so the caller never learns whether
-- one exists. Returns true when a code was written, false when the address is
-- unknown — the ENDPOINT must answer identically either way, exactly as
-- /reset-password does, or this becomes an oracle for which clinicians have
-- accounts here.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION identity_issue_email_code(
  p_email text,
  p_code_hash text,
  p_ttl_minutes integer
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid;
BEGIN
  SELECT id INTO v_user
  FROM identity_users
  WHERE lower(email) = lower(p_email) AND status = 'pending_verification';

  IF v_user IS NULL THEN
    RETURN false;
  END IF;

  INSERT INTO identity_email_verifications (user_id, code_hash, email, purpose, expires_at)
  VALUES (v_user, p_code_hash, lower(p_email), 'signup',
          now() + make_interval(mins => p_ttl_minutes));

  RETURN true;
END;
$$;

-- ---------------------------------------------------------------------------
-- Access control.
--
-- PREFERENCES: a user reads and writes their own row and no other. There is no
-- admin policy — support staff have no business reading what theme someone
-- picked, and §1.1's support duties do not extend here.
--
-- VERIFICATIONS: NO POLICY AT ALL, deliberately. Nothing reads this table
-- through the application; both operations go through the functions above,
-- which run as the owner. With RLS forced and no policy, a direct query from
-- `mir_app` returns zero rows — which is the correct answer to every question
-- anyone could ask it through this application.
-- ---------------------------------------------------------------------------
ALTER TABLE identity_user_preferences      ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_user_preferences      FORCE  ROW LEVEL SECURITY;
ALTER TABLE identity_email_verifications   ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_email_verifications   FORCE  ROW LEVEL SECURITY;

CREATE POLICY preferences_own_select ON identity_user_preferences FOR SELECT
  USING (user_id = app_current_user_id());

CREATE POLICY preferences_own_insert ON identity_user_preferences FOR INSERT
  WITH CHECK (user_id = app_current_user_id());

CREATE POLICY preferences_own_update ON identity_user_preferences FOR UPDATE
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());

-- ---------------------------------------------------------------------------
-- Editing your own profile — and the guard that makes it safe.
--
-- `users_self` (0002) lets a user READ their own row; there was no way to
-- change it, because nothing needed one. A profile screen does.
--
-- THE PROBLEM WITH JUST ADDING AN UPDATE POLICY: PostgreSQL row-level security
-- is row-shaped, not column-shaped. A policy that permits "update the row whose
-- id is mine" permits updating EVERY column of it — including `role`, which is
-- what the auth guard and every other policy in this schema key on. That is a
-- self-service privilege escalation, and no amount of care in the service layer
-- makes it not one: ADR-6 exists precisely so an application bug is not enough.
--
-- So the policy is paired with a trigger. The trigger can see OLD and NEW,
-- which a WITH CHECK clause cannot, and it refuses any change to a privileged
-- column unless the caller is ops. It fires for every writer — this
-- application, a future one, a migration, a psql session as mir_app — so the
-- guarantee does not depend on going through the intended code path.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION identity_guard_privileged_columns() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  /*
   * TWO WRITERS ARE LEGITIMATE, AND THEY ARE TOLD APART DIFFERENTLY.
   *
   * 1. Ops, deciding a verification (§1.1). That is an application write by
   *    `mir_app`, distinguished by the RLS session role the request carries.
   *
   * 2. The SECURITY DEFINER functions in this schema — `identity_verify_email`
   *    activating an account it has just proven ownership of, and the
   *    verification decision in 0010 granting a clinical role. Those run as the
   *    table OWNER, so `current_user` is not the application role.
   *
   *    This distinction is unforgeable. `mir_app` cannot become the owner, and
   *    it cannot call a security-definer function that does not exist. A marker
   *    in a session variable would have been forgeable by the very code path
   *    this guards, which is the whole reason not to use one.
   *
   * Everything else — including a user PATCHing their own profile — is refused,
   * whatever the service layer intended. That is the point: ADR-6 exists so an
   * application bug is not sufficient on its own.
   */
  IF current_user <> 'mir_app' THEN
    RETURN NEW;
  END IF;

  IF app_current_role() = 'admin' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'role, status, keycloak_sub and email are not self-service'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

/*
 * SECURITY DEFINER is deliberately ABSENT: the function needs no privilege of
 * its own, and a trigger running as the owner would be a far more attractive
 * thing to find a bug in.
 */
CREATE TRIGGER identity_users_guard_privileged
  BEFORE UPDATE ON identity_users
  FOR EACH ROW
  -- Skipped entirely when nothing privileged is being touched, so an ordinary
  -- name change does not pay for the check.
  WHEN (
    NEW.role IS DISTINCT FROM OLD.role
    OR NEW.status IS DISTINCT FROM OLD.status
    OR NEW.keycloak_sub IS DISTINCT FROM OLD.keycloak_sub
    -- The address is the account identifier and the verification target;
    -- changing it is a flow (re-verify the new one), never a field edit.
    OR NEW.email IS DISTINCT FROM OLD.email
  )
  EXECUTE FUNCTION identity_guard_privileged_columns();

CREATE POLICY users_self_update ON identity_users FOR UPDATE
  USING (id = app_current_user_id())
  WITH CHECK (id = app_current_user_id());

-- No DELETE grant, here as everywhere (see 0002_rls.up.sql).
GRANT SELECT, INSERT, UPDATE ON identity_user_preferences TO mir_app;
GRANT SELECT, INSERT, UPDATE ON identity_email_verifications TO mir_app;

GRANT EXECUTE ON FUNCTION identity_register_account(text, text, text, text, text) TO mir_app;
GRANT EXECUTE ON FUNCTION identity_verify_email(text, text) TO mir_app;
GRANT EXECUTE ON FUNCTION identity_issue_email_code(text, text, integer) TO mir_app;

COMMIT;
