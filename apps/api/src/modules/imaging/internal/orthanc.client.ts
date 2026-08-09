/**
 * Orthanc DICOMweb client — BUILD_SPEC ADR-3, P8.
 *
 * Orthanc is the DICOM server (ADR-3: do not hand-roll DICOM storage,
 * indexing, or DICOMweb). It lives in a private subnet and is reachable only
 * from the API — the browser never talks to it directly (P8.2).
 *
 * Orthanc is an INDEX, not the source of record. The source of record is the
 * object in the originals bucket (ADR-4). If Orthanc's database is lost it can
 * be rebuilt by re-STOWing the originals; if the originals are lost, nothing
 * rebuilds them. That asymmetry is why an Orthanc failure during ingestion is
 * logged rather than treated as an ingest failure.
 */

export const ORTHANC_CLIENT = Symbol('ORTHANC_CLIENT');

export interface OrthancClient {
  /** STOW-RS: store one instance. Idempotent — Orthanc dedupes by SOP UID. */
  storeInstance(dicomBytes: Uint8Array): Promise<void>;
  /** QIDO-RS: study metadata, proxied through the API only (P8.2). */
  findStudy(studyInstanceUid: string): Promise<unknown>;
}

/**
 * No-op implementation for development and tests.
 *
 * Records what it was asked to store so tests can assert the pipeline reached
 * step 6, without requiring an Orthanc container. The real HTTP client is
 * written in PHASE 8, where it can be tested against an actual Orthanc.
 */
export class InMemoryOrthancClient implements OrthancClient {
  readonly stored: Uint8Array[] = [];
  /** Set to make storeInstance throw, to prove ingestion survives it. */
  failNext = false;

  async storeInstance(dicomBytes: Uint8Array): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('simulated Orthanc outage');
    }
    this.stored.push(dicomBytes);
  }

  async findStudy(): Promise<unknown> {
    return null;
  }
}
