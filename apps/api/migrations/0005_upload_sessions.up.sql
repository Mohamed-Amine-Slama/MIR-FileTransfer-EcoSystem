-- BUILD_SPEC P7 — resumable upload state.
--
-- "Libyan connectivity is intermittent with limited upstream bandwidth. A
-- study can be 200 MB-1 GB across hundreds of files. A naive single POST will
-- fail constantly and doctors will abandon the product."
--
-- The state that makes resume possible has to be DURABLE, not in memory: the
-- interruption being designed for may last hours, and may outlive the server
-- process that started the upload. Resume information kept in Redis or in
-- process memory turns a deploy into data loss for every doctor mid-upload.

BEGIN;

CREATE TABLE imaging_upload_sessions (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  patient_id          uuid NOT NULL REFERENCES patients_patients(id),
  created_by          uuid NOT NULL REFERENCES identity_users(id),
  expected_file_count int NOT NULL CHECK (expected_file_count > 0),
  status              text NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open','assembling','completed','expired','aborted')),
  -- Populated once the first file reveals the StudyInstanceUID. A session maps
  -- to exactly one study; files disagreeing about it are flagged, never split
  -- silently (P7.4).
  study_id            uuid REFERENCES imaging_studies(id),
  study_instance_uid  text,
  expires_at          timestamptz NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX imaging_upload_sessions_patient_idx ON imaging_upload_sessions (patient_id);
CREATE INDEX imaging_upload_sessions_creator_idx ON imaging_upload_sessions (created_by);
CREATE INDEX imaging_upload_sessions_expiry_idx ON imaging_upload_sessions (expires_at)
  WHERE status = 'open';

CREATE TABLE imaging_upload_files (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  session_id        uuid NOT NULL REFERENCES imaging_upload_sessions(id),
  -- Stable client-side identity (a hash of the file's path within the chosen
  -- folder). Lets a client that lost all local state re-register the same file
  -- and be told where to resume from, rather than starting over.
  client_file_id    text NOT NULL,
  file_name         text NOT NULL,
  size_bytes        bigint NOT NULL CHECK (size_bytes >= 0),
  -- What the CLIENT says the content hashes to. Never trusted on its own —
  -- the server recomputes over the assembled bytes and compares (P7.2).
  client_sha256     text NOT NULL,
  server_sha256     text,
  chunk_size_bytes  int NOT NULL CHECK (chunk_size_bytes > 0),
  -- The resume point. Chunks must arrive in order, so one integer is enough
  -- and cannot get out of step with the bytes actually on disk.
  received_bytes    bigint NOT NULL DEFAULT 0 CHECK (received_bytes >= 0),
  next_chunk_index  int NOT NULL DEFAULT 0 CHECK (next_chunk_index >= 0),
  status            text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','uploading','received','ingested','failed','rejected')),
  failure_reason    text,
  storage_key       text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  -- Re-registering the same file is idempotent; it returns the existing resume
  -- offset instead of creating a second row (P7.4 idempotency).
  UNIQUE (session_id, client_file_id)
);

CREATE INDEX imaging_upload_files_session_idx ON imaging_upload_files (session_id, status);

-- ---------------------------------------------------------------------------
-- Access control. Upload state is patient data by association: knowing that a
-- study is being uploaded for a patient is itself disclosure.
-- ---------------------------------------------------------------------------
ALTER TABLE imaging_upload_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE imaging_upload_sessions FORCE  ROW LEVEL SECURITY;
ALTER TABLE imaging_upload_files    ENABLE ROW LEVEL SECURITY;
ALTER TABLE imaging_upload_files    FORCE  ROW LEVEL SECURITY;

-- Only the uploading doctor. Not the patient, not the receiving doctor: an
-- in-flight upload is not yet a study, and a half-transferred scan must never
-- be readable as though it were complete (§17 — a doctor reading an incomplete
-- study misses a finding).
CREATE POLICY upload_sessions_owner ON imaging_upload_sessions FOR ALL
  USING (app_current_role() = 'libya_doctor' AND created_by = app_current_user_id())
  WITH CHECK (
    app_current_role() = 'libya_doctor'
    AND created_by = app_current_user_id()
    AND app_created_patient(patient_id)
  );

CREATE OR REPLACE FUNCTION app_owns_upload_session(p_session uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM imaging_upload_sessions
    WHERE id = p_session AND created_by = app_current_user_id()
  );
$$;

CREATE POLICY upload_files_owner ON imaging_upload_files FOR ALL
  USING (app_current_role() = 'libya_doctor' AND app_owns_upload_session(session_id))
  WITH CHECK (app_current_role() = 'libya_doctor' AND app_owns_upload_session(session_id));

GRANT SELECT, INSERT, UPDATE ON imaging_upload_sessions, imaging_upload_files TO mir_app;
GRANT EXECUTE ON FUNCTION app_owns_upload_session(uuid) TO mir_app;

COMMIT;
