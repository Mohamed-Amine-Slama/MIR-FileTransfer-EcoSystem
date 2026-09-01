BEGIN;
ALTER FUNCTION uuid_generate_v7() RESET search_path;
COMMIT;
