import { createHash } from 'node:crypto';

/**
 * Content hash used for end-to-end upload integrity (P7.2) and stored on
 * `imaging_instances.sha256` (P3.1).
 *
 * Computed over the ORIGINAL bytes, never over a re-encoded or normalised
 * form (ADR-4). If this hash and the client's disagree, the transfer is
 * rejected — we do not "repair" the file.
 */
export function sha256(buffer: Uint8Array): string {
  return createHash('sha256').update(buffer).digest('hex');
}

// isDicom / readHeader / isLossyTransferSyntax are implemented in PHASE 6.
// They are deliberately absent rather than stubbed: a stub that returns `true`
// is a validation bypass waiting to be shipped.
