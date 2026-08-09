/**
 * Object storage abstraction — BUILD_SPEC ADR-4, P2.4, P7.
 *
 * Three buckets with genuinely different guarantees, and the interface keeps
 * them apart so the difference cannot be lost in a helper:
 *
 *   originals — the source of record. Object Lock, versioned, replicated.
 *               WRITE ONCE. There is deliberately no delete method and no
 *               overwrite: "a deletable original is a lost scan is a lawsuit".
 *   derived   — thumbnails and previews. Regenerable, so expiry is fine.
 *   staging   — in-flight upload chunks. Deleted after assembly.
 *
 * Original bytes are stored EXACTLY as received (ADR-4). Nothing in any
 * implementation may re-encode, normalise, or "repair" them.
 */

export interface OriginalObject {
  key: string;
  bytes: Uint8Array;
  sha256: string;
}

export interface BlobStore {
  // --- staging: mutable, short-lived --------------------------------------
  /** Append one chunk. Chunks arrive in order; index is for verification. */
  appendChunk(stagingKey: string, chunkIndex: number, data: Uint8Array): Promise<void>;
  /** Total bytes staged so far — the resume point after an interruption. */
  stagedSize(stagingKey: string): Promise<number>;
  readStaged(stagingKey: string): Promise<Uint8Array>;
  discardStaged(stagingKey: string): Promise<void>;

  // --- originals: immutable ------------------------------------------------
  /**
   * Write the original bytes. Implementations MUST NOT overwrite an existing
   * object: re-uploading the same instance is idempotent, not a replacement.
   */
  putOriginal(key: string, data: Uint8Array): Promise<void>;
  getOriginal(key: string): Promise<Uint8Array>;
  originalExists(key: string): Promise<boolean>;

  // --- derived: regenerable ------------------------------------------------
  putDerived(key: string, data: Uint8Array): Promise<void>;
  derivedExists(key: string): Promise<boolean>;
}

/**
 * Storage key for an original instance (BUILD_SPEC P7.4 step 4).
 *
 * `patients/{patient_id}/studies/{study_uid}/series/{series_uid}/{sop_uid}.dcm`
 *
 * Keyed on the PATIENT RECORD id, not on any identifier from inside the file.
 * File tags are metadata and are frequently wrong (P6.1); the doctor's chosen
 * record is authoritative, and the storage layout has to agree with that or a
 * study ends up filed under the wrong person.
 */
export function originalKey(params: {
  patientId: string;
  studyInstanceUid: string;
  seriesInstanceUid: string;
  sopInstanceUid: string;
}): string {
  return [
    'patients',
    params.patientId,
    'studies',
    sanitiseUid(params.studyInstanceUid),
    'series',
    sanitiseUid(params.seriesInstanceUid),
    `${sanitiseUid(params.sopInstanceUid)}.dcm`,
  ].join('/');
}

export function derivedThumbnailKey(params: {
  patientId: string;
  studyInstanceUid: string;
  sopInstanceUid: string;
}): string {
  return [
    'patients',
    params.patientId,
    'studies',
    sanitiseUid(params.studyInstanceUid),
    'thumbnails',
    `${sanitiseUid(params.sopInstanceUid)}.jpg`,
  ].join('/');
}

/**
 * DICOM UIDs are digits and dots by specification, but real-world files carry
 * malformed ones. An unvalidated UID goes straight into an object key and a
 * filesystem path, so `../` in a UID is a path-traversal write.
 */
export function sanitiseUid(uid: string): string {
  const cleaned = uid.trim().replace(/[^0-9.]/g, '');
  if (cleaned === '' || cleaned.includes('..')) {
    throw new Error(`Refusing to build a storage key from malformed UID: ${JSON.stringify(uid)}`);
  }
  return cleaned;
}

export class ObjectAlreadyExistsError extends Error {
  constructor(key: string) {
    super(`Original object already exists and is immutable: ${key}`);
    this.name = 'ObjectAlreadyExistsError';
  }
}

export class ObjectNotFoundError extends Error {
  constructor(key: string) {
    super(`Object not found: ${key}`);
    this.name = 'ObjectNotFoundError';
  }
}
