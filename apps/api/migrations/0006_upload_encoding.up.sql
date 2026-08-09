-- BUILD_SPEC P7.3 step 4 — client-side gzip.
--
-- The client compresses each file before transfer. This is CONTAINER-level
-- compression only (ADR-5): the gzip wraps the DICOM file as a byte stream and
-- is undone on arrival. Pixel data is never touched, and no DICOM transfer
-- syntax is changed.
--
-- INTEGRITY IMPLICATION: client_sha256 is the digest of the ORIGINAL,
-- UNCOMPRESSED file — because that is what gets stored and what a doctor
-- eventually reads (ADR-4). The server therefore has to decompress before it
-- verifies. Hashing the compressed bytes instead would verify only that the
-- gzip arrived intact, which says nothing about whether the DICOM inside it
-- did: two different gzip encoders produce different bytes for identical
-- input, so the digest would not even be reproducible.
BEGIN;

ALTER TABLE imaging_upload_files
  ADD COLUMN content_encoding text NOT NULL DEFAULT 'identity'
    CHECK (content_encoding IN ('identity', 'gzip'));

COMMENT ON COLUMN imaging_upload_files.content_encoding IS
  'Transfer encoding of the staged bytes. client_sha256 always refers to the decoded original.';

COMMIT;
