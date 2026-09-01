-- Key a self-registered account by its Keycloak subject.
--
-- `identity_users.id` IS the subject everywhere else in this schema. RLS is
-- built on it directly — `users_self` and `users_self_update` are both
-- `(id = app_current_user_id())`, and app_current_user_id() is set from the
-- token's `sub` on every request. Nothing resolves one identifier into the
-- other; the system has exactly one id for a person and it comes from the
-- token.
--
-- 0009 let `id` take its default, uuid_generate_v7(), and recorded the subject
-- only in `keycloak_sub`. Every account created through self-service sign-up
-- therefore had an id that matched no token. The consequences are not confined
-- to one endpoint:
--
--   * /auth/me answers 404 "User record not found" for a perfectly valid token
--   * `users_self` matches nothing, so the account cannot read its own row
--   * `users_self_update` matches nothing, so it cannot edit its own profile
--
-- It reads as an authentication bug and is not one — the token verifies, and
-- the row exists. Out-of-band provisioning never hit it because those rows are
-- inserted with the subject as the id, which is what this makes the function do
-- too.
--
-- The cast is safe for the same reason the rest of the system is: app_current_
-- user_id() is uuid and is set from `sub`, so a non-uuid subject already fails
-- at request context setup, long before this function is reached.
--
-- Existing rows are deliberately NOT rewritten. `id` is referenced by fifteen
-- tables; rewriting it under live data is a data migration, not a function
-- change, and no such account can have accumulated anything — it could never
-- read its own row in the first place.
BEGIN;

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
  INSERT INTO identity_users (id, keycloak_sub, role, phone_e164, full_name, email, locale, status)
  VALUES (
    -- The subject, not a generated id. See the note on this migration.
    p_keycloak_sub::uuid,
    p_keycloak_sub,
    -- NOT a parameter. See 0009.
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
    RETURN NULL;  -- address, phone, or subject already registered
  END IF;

  -- Preferences exist from the first moment, so every read path can assume a
  -- row and no screen has to invent defaults that drift from the schema's.
  INSERT INTO identity_user_preferences (user_id, locale)
  VALUES (v_id, CASE WHEN p_locale IN ('ar','fr','en') THEN p_locale ELSE 'ar' END);

  RETURN v_id;
END;
$$;

COMMIT;
