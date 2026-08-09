-- BUILD_SPEC P3.1 — core schema.
--
-- Conventions (BUILD_SPEC §6):
--   * every timestamp is timestamptz, stored UTC
--   * every id is UUIDv7 (time-ordered) — never a sequential integer in a URL
--   * table names are prefixed with the owning module (§5.1 rule 1)
--
-- Note the deliberate ABSENCE of any uniqueness constraint on patient name.
-- Two different people may share a name; one person may be transliterated
-- three different ways across the Libya-Tunisia border. Enforcing uniqueness
-- there would merge two patients into one record, which is the worst failure
-- this system can produce (§17).

BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;  -- required by the exclusion constraint below
CREATE EXTENSION IF NOT EXISTS pgcrypto;    -- gen_random_bytes for uuid_generate_v7

-- ---------------------------------------------------------------------------
-- UUIDv7 generator.
--
-- PostgreSQL 16 has no native uuidv7() (that arrives in 18). IDs are normally
-- generated application-side; this exists so database-side defaults and test
-- fixtures produce the same time-ordered shape rather than random v4s, which
-- would fragment index locality on the large tables (imaging_instances).
--
-- Layout per RFC 9562: 48-bit big-endian unix_ts_ms, 4-bit version, 74 bits of
-- randomness with a 2-bit variant.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION uuid_generate_v7() RETURNS uuid
LANGUAGE plpgsql VOLATILE PARALLEL SAFE
AS $$
DECLARE
  ts_ms bigint := (extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  b bytea;
BEGIN
  -- int8send yields 8 bytes big-endian; take the low 6 for the 48-bit timestamp.
  b := substring(int8send(ts_ms) FROM 3 FOR 6) || gen_random_bytes(10);
  b := set_byte(b, 6, (get_byte(b, 6) & 15) | 112);   -- version 7
  b := set_byte(b, 8, (get_byte(b, 8) & 63) | 128);   -- variant 10xx
  RETURN encode(b, 'hex')::uuid;
END;
$$;

-- ---------------------------------------------------------------------------
-- identity
-- ---------------------------------------------------------------------------
CREATE TABLE identity_users (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  keycloak_sub  text UNIQUE NOT NULL,
  role          text NOT NULL CHECK (role IN ('libya_doctor','tunisia_doctor','patient','admin')),
  phone_e164    text UNIQUE NOT NULL,
  full_name     text NOT NULL,
  locale        text NOT NULL DEFAULT 'ar' CHECK (locale IN ('ar','fr')),
  status        text NOT NULL DEFAULT 'pending_verification'
                  CHECK (status IN ('pending_verification','active','suspended')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE identity_doctor_profiles (
  user_id        uuid PRIMARY KEY REFERENCES identity_users(id),
  country        text NOT NULL CHECK (country IN ('LY','TN')),
  license_number text NOT NULL,
  specialty      text NOT NULL,
  clinic_name    text,
  verified_at    timestamptz,
  verified_by    uuid REFERENCES identity_users(id)
);

-- ---------------------------------------------------------------------------
-- patients
-- ---------------------------------------------------------------------------
CREATE TABLE patients_patients (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  phone_e164        text NOT NULL,
  full_name         text NOT NULL,
  date_of_birth     date NOT NULL,
  sex               text NOT NULL CHECK (sex IN ('M','F','O')),
  national_id       text,
  national_id_type  text,
  created_by_doctor uuid NOT NULL REFERENCES identity_users(id),
  claimed_by_user   uuid REFERENCES identity_users(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Lookup is by phone only (P3.3). Deliberately NOT unique: two family members
-- sharing a handset is common, and a unique index here would silently block
-- the second patient's referral.
CREATE INDEX patients_patients_phone_idx ON patients_patients (phone_e164);
CREATE INDEX patients_patients_created_by_idx ON patients_patients (created_by_doctor);
CREATE INDEX patients_patients_claimed_by_idx ON patients_patients (claimed_by_user);

-- ---------------------------------------------------------------------------
-- consent
-- ---------------------------------------------------------------------------
CREATE TABLE consent_records (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  patient_id     uuid NOT NULL REFERENCES patients_patients(id),
  scope          text NOT NULL,
  granted_to     uuid REFERENCES identity_users(id),
  terms_version  text NOT NULL,
  terms_locale   text NOT NULL CHECK (terms_locale IN ('ar','fr')),
  granted_at     timestamptz NOT NULL DEFAULT now(),
  revoked_at     timestamptz,
  -- SHA-256 of the exact rendered text the patient saw. A boolean "consented"
  -- column is unprovable in a dispute (§17); this makes the evidence
  -- reconstructible.
  evidence_hash  text NOT NULL,
  ip_address     inet,
  user_agent     text
);

CREATE INDEX consent_records_patient_idx ON consent_records (patient_id);
CREATE INDEX consent_records_granted_to_idx ON consent_records (granted_to);

-- ---------------------------------------------------------------------------
-- imaging
-- ---------------------------------------------------------------------------
CREATE TABLE imaging_studies (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  patient_id          uuid NOT NULL REFERENCES patients_patients(id),
  uploaded_by         uuid NOT NULL REFERENCES identity_users(id),
  study_instance_uid  text NOT NULL,
  modality            text NOT NULL,
  study_date          date,
  description         text,
  file_count          int NOT NULL DEFAULT 0,
  total_bytes         bigint NOT NULL DEFAULT 0,
  status              text NOT NULL DEFAULT 'uploading'
                        CHECK (status IN ('uploading','processing','ready','failed','quarantined')),
  orthanc_study_id    text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (patient_id, study_instance_uid)
);

CREATE INDEX imaging_studies_patient_idx ON imaging_studies (patient_id);
CREATE INDEX imaging_studies_uploader_idx ON imaging_studies (uploaded_by);

CREATE TABLE imaging_instances (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  study_id       uuid NOT NULL REFERENCES imaging_studies(id),
  sop_uid        text NOT NULL,
  series_uid     text NOT NULL,
  storage_key    text NOT NULL,
  size_bytes     bigint NOT NULL,
  sha256         text NOT NULL,
  received_at    timestamptz NOT NULL DEFAULT now(),
  -- Idempotency for re-uploads (P7.4). Re-sending the same study must not
  -- duplicate instances.
  UNIQUE (study_id, sop_uid)
);

CREATE INDEX imaging_instances_study_idx ON imaging_instances (study_id);

-- ---------------------------------------------------------------------------
-- scheduling
-- ---------------------------------------------------------------------------
CREATE TABLE scheduling_availability (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  doctor_id    uuid NOT NULL REFERENCES identity_users(id),
  starts_at    timestamptz NOT NULL,
  ends_at      timestamptz NOT NULL,
  slot_minutes int NOT NULL DEFAULT 30,
  CHECK (ends_at > starts_at)
);

CREATE INDEX scheduling_availability_doctor_idx ON scheduling_availability (doctor_id, starts_at);

CREATE TABLE scheduling_appointments (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  patient_id   uuid NOT NULL REFERENCES patients_patients(id),
  doctor_id    uuid NOT NULL REFERENCES identity_users(id),
  starts_at    timestamptz NOT NULL,
  ends_at      timestamptz NOT NULL,
  -- DECISION D2: authorise at booking, capture on the doctor's acceptance.
  status       text NOT NULL DEFAULT 'pending_payment'
                 CHECK (status IN ('pending_payment','authorised','confirmed','cancelled','completed')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),

  -- The DATABASE prevents double-booking, not application logic (§17).
  -- Application-level checks lose to concurrency; this cannot.
  EXCLUDE USING gist (
    doctor_id WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  ) WHERE (status <> 'cancelled')
);

CREATE INDEX scheduling_appointments_patient_idx ON scheduling_appointments (patient_id);
CREATE INDEX scheduling_appointments_doctor_idx ON scheduling_appointments (doctor_id);

CREATE TABLE scheduling_appointment_studies (
  appointment_id uuid NOT NULL REFERENCES scheduling_appointments(id),
  study_id       uuid NOT NULL REFERENCES imaging_studies(id),
  PRIMARY KEY (appointment_id, study_id)
);

CREATE INDEX scheduling_appointment_studies_study_idx ON scheduling_appointment_studies (study_id);

-- ---------------------------------------------------------------------------
-- audit (append-only)
--
-- Immutability is enforced by GRANTs in 0002, not by this REVOKE alone.
-- REVOKE ... FROM PUBLIC does not restrict the table OWNER, so the append-only
-- property depends on the application role being a non-owner that is never
-- granted UPDATE or DELETE.
-- ---------------------------------------------------------------------------
CREATE TABLE audit_events (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  actor_id     uuid,
  actor_role   text,
  action       text NOT NULL,
  subject_type text NOT NULL,
  subject_id   uuid,
  patient_id   uuid,
  ip_address   inet,
  user_agent   text,
  metadata     jsonb NOT NULL DEFAULT '{}',
  occurred_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_events_patient_idx ON audit_events (patient_id, occurred_at DESC);
CREATE INDEX audit_events_actor_idx ON audit_events (actor_id, occurred_at DESC);
CREATE INDEX audit_events_action_idx ON audit_events (action, occurred_at DESC);

REVOKE UPDATE, DELETE ON audit_events FROM PUBLIC;

COMMIT;
