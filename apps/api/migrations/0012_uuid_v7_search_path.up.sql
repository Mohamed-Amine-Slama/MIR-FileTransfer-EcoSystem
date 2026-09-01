-- Pin the search_path of uuid_generate_v7() so it resolves gen_random_bytes
-- wherever pgcrypto happens to live.
--
-- 0001 assumes `CREATE EXTENSION IF NOT EXISTS pgcrypto` installs into public,
-- which holds on a database we create ourselves. It does not hold on a managed
-- Postgres that ships pgcrypto pre-installed in a dedicated `extensions`
-- schema (Supabase does): there the IF NOT EXISTS is a no-op, public.
-- gen_random_bytes is never created, and the extension stays outside public.
--
-- uuid_generate_v7() is plpgsql, so `gen_random_bytes` is resolved at execution
-- time against the CALLER's search_path and then cached in the plan. Under the
-- session default it resolves; under the `search_path = public, pg_temp` that
-- every SECURITY DEFINER function here pins it does not, and the call fails
-- with "function gen_random_bytes(integer) does not exist".
--
-- That is not a theoretical edge: 15 tables default their id to
-- uuid_generate_v7(), and identity_register_account, identity_create_
-- organisation, identity_accept_invitation and identity_issue_email_code all
-- insert into them from behind a pinned search_path. Signup and organisation
-- onboarding fail outright.
--
-- Naming `extensions` here is safe on a database that has no such schema: a
-- missing schema in search_path is silently skipped, not an error, so this
-- stays correct in local, CI and managed environments alike. pg_temp is listed
-- last for the usual reason — a caller-created temp object must never shadow a
-- name this body resolves.
BEGIN;

ALTER FUNCTION uuid_generate_v7() SET search_path = public, extensions, pg_temp;

COMMENT ON FUNCTION uuid_generate_v7() IS
  'UUIDv7 generator (RFC 9562). search_path is pinned so gen_random_bytes resolves whether pgcrypto lives in public or in a dedicated extensions schema.';

COMMIT;
