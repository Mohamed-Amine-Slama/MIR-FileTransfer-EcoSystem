-- BUILD_SPEC P5.3 — versioned consent content.
--
-- "Storing consent as a boolean is unprovable in a dispute" (§17). The row in
-- consent_records proves WHEN consent was given and BY WHOM; this table is
-- what makes it possible to prove WHAT they agreed to, months later, after the
-- wording has changed twice.
--
-- The gate is: given a consent row, reproduce the exact text the patient saw.
-- That requires (a) the text to be immutable once published, and (b) a hash
-- binding the consent row to that exact text.
--
-- BLOCKING L4: the actual wording, and whether Libyan/Tunisian law requires it
-- to be written, witnessed, or in a specific language, is unresolved. This
-- schema deliberately makes the content data rather than code so counsel's
-- answer is a new row, not a deployment.

BEGIN;

CREATE TABLE consent_terms (
  version       text NOT NULL,
  locale        text NOT NULL CHECK (locale IN ('ar','fr')),
  scope         text NOT NULL DEFAULT 'cross_border_transfer',
  body          text NOT NULL,
  -- SHA-256 of `body`, computed at publish time. consent_records.evidence_hash
  -- must match this for the consent to be reconstructible.
  content_hash  text NOT NULL,
  published_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (version, locale, scope)
);

-- ---------------------------------------------------------------------------
-- Immutability, enforced by the database.
--
-- A published version can never be edited or removed. Application-level
-- discipline is not sufficient here: the whole evidentiary value of a consent
-- record rests on the text behind it being the text that was shown, and a
-- well-meaning "fix a typo in the Arabic" UPDATE silently destroys that for
-- every consent already granted against it.
--
-- Unpublished drafts remain editable, which is where wording review happens.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION consent_terms_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.published_at IS NOT NULL THEN
      RAISE EXCEPTION
        'consent_terms % (%/%) is published and cannot be deleted',
        OLD.version, OLD.locale, OLD.scope
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.published_at IS NOT NULL THEN
    -- Once published, nothing may change. Not the body, not the hash, and not
    -- the publication timestamp.
    IF NEW.body IS DISTINCT FROM OLD.body
       OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
       OR NEW.published_at IS DISTINCT FROM OLD.published_at
       OR NEW.version IS DISTINCT FROM OLD.version
       OR NEW.locale IS DISTINCT FROM OLD.locale
       OR NEW.scope IS DISTINCT FROM OLD.scope THEN
      RAISE EXCEPTION
        'consent_terms % (%/%) is published and immutable',
        OLD.version, OLD.locale, OLD.scope
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER consent_terms_immutable_trg
  BEFORE UPDATE OR DELETE ON consent_terms
  FOR EACH ROW EXECUTE FUNCTION consent_terms_immutable();

-- ---------------------------------------------------------------------------
-- Bind consent_records to the terms it was granted against.
--
-- Nullable because existing rows predate this column; new writes always set it.
-- ---------------------------------------------------------------------------
ALTER TABLE consent_records
  ADD COLUMN IF NOT EXISTS terms_scope text NOT NULL DEFAULT 'cross_border_transfer';

ALTER TABLE consent_records
  ADD CONSTRAINT consent_records_terms_fk
  FOREIGN KEY (terms_version, terms_locale, terms_scope)
  REFERENCES consent_terms (version, locale, scope);

-- ---------------------------------------------------------------------------
-- Access. Terms text is not patient data — it is the published wording, and
-- every authenticated user may read it. Only migrations insert it.
-- ---------------------------------------------------------------------------
ALTER TABLE consent_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_terms FORCE  ROW LEVEL SECURITY;

CREATE POLICY consent_terms_readable ON consent_terms FOR SELECT
  USING (app_current_role() IS NOT NULL);

GRANT SELECT ON consent_terms TO mir_app;

COMMIT;
