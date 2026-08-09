/**
 * Domain events — BUILD_SPEC §5.2.
 *
 * "Adding a feature should mean adding a subscriber, not editing an existing
 * module." That property only holds if events carry enough context for a new
 * subscriber to act without reaching back into the emitting module's tables —
 * which the boundary rules forbid anyway (§5.1).
 *
 * WHAT EVENTS MUST NOT CARRY:
 * no clinical detail, no image bytes, no patient names. Subscribers include
 * notifications (P12), which must never put clinical information into an SMS.
 * Keeping payloads to identifiers means a careless template cannot leak a
 * diagnosis, because the data was never in the event to begin with.
 */

export interface DomainEventBase {
  /** Who caused this. Absent only for system-initiated events. */
  actorId: string | undefined;
  actorRole: string | undefined;
  occurredAt: Date;
  requestId: string;
  ipAddress: string | undefined;
  userAgent: string | undefined;
}

export interface PatientCreated extends DomainEventBase {
  type: 'PatientCreated';
  patientId: string;
  createdByDoctor: string;
}

export interface ConsentGranted extends DomainEventBase {
  type: 'ConsentGranted';
  consentId: string;
  patientId: string;
  /** The named receiving doctor. Consent is never open-ended (P5.3). */
  grantedTo: string;
  termsVersion: string;
  termsLocale: string;
}

export interface ConsentRevoked extends DomainEventBase {
  type: 'ConsentRevoked';
  consentId: string;
  patientId: string;
  grantedTo: string;
}

export interface StudyUploadCompleted extends DomainEventBase {
  type: 'StudyUploadCompleted';
  studyId: string;
  patientId: string;
  fileCount: number;
  totalBytes: number;
  /** True if any instance used a lossy transfer syntax (P6.1). */
  containsLossy: boolean;
}

export interface AppointmentBooked extends DomainEventBase {
  type: 'AppointmentBooked';
  appointmentId: string;
  patientId: string;
  doctorId: string;
  startsAt: Date;
}

export interface PaymentSucceeded extends DomainEventBase {
  type: 'PaymentSucceeded';
  appointmentId: string;
  paymentId: string;
  amountMinor: number;
  currency: string;
}

export interface StudyAccessed extends DomainEventBase {
  type: 'StudyAccessed';
  /**
   * Internal study id. UNDEFINED when access was refused — the row was
   * invisible to the caller, so we genuinely do not know which study (if any)
   * they were reaching for. Modelling it as `string` forced a DICOM UID into a
   * uuid column, which made the audit INSERT fail and lost the very denial it
   * was recording.
   */
  studyId: string | undefined;
  /** The DICOM Study Instance UID the caller asked for. Always known. */
  studyInstanceUid: string;
  /** Undefined on a refusal, for the same reason as studyId. */
  patientId: string | undefined;
  /** What the actor did: metadata query, image retrieval, thumbnail. */
  accessKind: 'metadata' | 'pixel_data' | 'thumbnail';
  /** False when the attempt was refused — denied attempts are audited too. */
  granted: boolean;
}

export type DomainEvent =
  | PatientCreated
  | ConsentGranted
  | ConsentRevoked
  | StudyUploadCompleted
  | AppointmentBooked
  | PaymentSucceeded
  | StudyAccessed;

export type DomainEventType = DomainEvent['type'];
