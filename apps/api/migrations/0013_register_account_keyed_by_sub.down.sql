-- Restore 0009's body: id defaulted to uuid_generate_v7(), subject recorded
-- only in keycloak_sub. Reverting reinstates the mismatch described in the up
-- migration, so any account registered while this is reverted cannot read its
-- own row.
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
  INSERT INTO identity_users (keycloak_sub, role, phone_e164, full_name, email, locale, status)
  VALUES (
    p_keycloak_sub,
    'applicant',
    p_phone_e164,
    p_full_name,
    lower(p_email),
    CASE WHEN p_locale IN ('ar','fr') THEN p_locale ELSE 'ar' END,
    'pending_verification'
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO identity_user_preferences (user_id, locale)
  VALUES (v_id, CASE WHEN p_locale IN ('ar','fr','en') THEN p_locale ELSE 'ar' END);

  RETURN v_id;
END;
$$;

COMMIT;
