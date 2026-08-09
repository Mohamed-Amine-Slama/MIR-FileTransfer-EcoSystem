import { Injectable } from '@nestjs/common';
import { DatabaseService, type Tx } from '../../../shared/db/database.service';
import type { DomainEvent } from '../../../shared/events/domain-events';

/**
 * Append-only audit log — BUILD_SPEC P4.4.
 *
 * THERE IS NO UPDATE OR DELETE PATH IN THIS CLASS. That is not an oversight to
 * be filled in later; it is the design. Immutability is enforced at three
 * levels, because any one of them can be bypassed:
 *
 *   1. Here — no method exists to modify a row.
 *   2. Database GRANTs — `mir_app` holds SELECT and INSERT on audit_events and
 *      nothing else, so even SQL injection cannot erase history (P3.2).
 *   3. Object storage — rows are archived to an Object Lock bucket, so a full
 *      database compromise still cannot rewrite the past (P2.4).
 *
 * Level 1 alone is a comment. Level 2 is the one the P3.2 tests prove.
 */

export interface AuditRecord {
  actorId: string | undefined;
  actorRole: string | undefined;
  action: string;
  subjectType: string;
  subjectId: string | undefined;
  patientId: string | undefined;
  ipAddress: string | undefined;
  userAgent: string | undefined;
  metadata: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Write one audit row.
   *
   * Takes an optional transaction so an audit write can be made part of the
   * same atomic unit as the action it records, where that is what we want. For
   * ACCESS events it deliberately is not: see `recordAccess`.
   */
  async record(record: AuditRecord, tx?: Tx): Promise<void> {
    const run = async (client: Tx): Promise<void> => {
      await client.query(
        `INSERT INTO audit_events
           (actor_id, actor_role, action, subject_type, subject_id,
            patient_id, ip_address, user_agent, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          record.actorId ?? null,
          record.actorRole ?? null,
          record.action,
          record.subjectType,
          record.subjectId ?? null,
          record.patientId ?? null,
          record.ipAddress ?? null,
          record.userAgent ?? null,
          JSON.stringify(scrub(record.metadata)),
        ],
      );
    };

    if (tx !== undefined) {
      await run(tx);
      return;
    }
    await this.db.tx(run);
  }

  /** Translate a domain event into an audit row. */
  async recordEvent(event: DomainEvent, tx?: Tx): Promise<void> {
    await this.record(
      {
        actorId: event.actorId,
        actorRole: event.actorRole,
        action: event.type,
        subjectType: subjectTypeFor(event),
        subjectId: subjectIdFor(event),
        patientId: patientIdFor(event),
        ipAddress: event.ipAddress,
        userAgent: event.userAgent,
        metadata: metadataFor(event),
      },
      tx,
    );
  }
}

/**
 * Fields that must never reach the audit log.
 *
 * The audit log is read by support staff and exported for compliance review —
 * a wider audience than the clinical data itself. Metadata is a free-form
 * jsonb column, which makes it the most likely place for someone to
 * accidentally park a patient name or a token while debugging.
 */
const FORBIDDEN_METADATA_KEYS = new Set([
  'patientname',
  'patient_name',
  'fullname',
  'full_name',
  'dateofbirth',
  'date_of_birth',
  'dob',
  'nationalid',
  'national_id',
  'phone',
  'phonee164',
  'phone_e164',
  'token',
  'accesstoken',
  'access_token',
  'authorization',
  'password',
  'diagnosis',
  'findings',
  'pixeldata',
  'pixel_data',
]);

export function scrub(metadata: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (FORBIDDEN_METADATA_KEYS.has(key.toLowerCase().replace(/[\s-]/g, ''))) {
      out[key] = '[redacted]';
      continue;
    }
    out[key] =
      value !== null && typeof value === 'object' && !Array.isArray(value)
        ? scrub(value as Record<string, unknown>)
        : value;
  }
  return out;
}

function subjectTypeFor(event: DomainEvent): string {
  switch (event.type) {
    case 'PatientCreated':
      return 'patient';
    case 'ConsentGranted':
    case 'ConsentRevoked':
      return 'consent';
    case 'StudyUploadCompleted':
    case 'StudyAccessed':
      return 'study';
    case 'AppointmentBooked':
      return 'appointment';
    case 'PaymentSucceeded':
      return 'payment';
  }
}

function subjectIdFor(event: DomainEvent): string | undefined {
  switch (event.type) {
    case 'PatientCreated':
      return event.patientId;
    case 'ConsentGranted':
    case 'ConsentRevoked':
      return event.consentId;
    case 'StudyUploadCompleted':
    case 'StudyAccessed':
      return event.studyId;
    case 'AppointmentBooked':
      return event.appointmentId;
    case 'PaymentSucceeded':
      return event.paymentId;
  }
}

function patientIdFor(event: DomainEvent): string | undefined {
  return 'patientId' in event ? event.patientId : undefined;
}

function metadataFor(event: DomainEvent): Record<string, unknown> {
  switch (event.type) {
    case 'StudyAccessed':
      return { accessKind: event.accessKind, granted: event.granted };
    case 'StudyUploadCompleted':
      return {
        fileCount: event.fileCount,
        totalBytes: event.totalBytes,
        containsLossy: event.containsLossy,
      };
    case 'ConsentGranted':
      return {
        grantedTo: event.grantedTo,
        termsVersion: event.termsVersion,
        termsLocale: event.termsLocale,
      };
    case 'ConsentRevoked':
      return { grantedTo: event.grantedTo };
    case 'AppointmentBooked':
      return { doctorId: event.doctorId, startsAt: event.startsAt.toISOString() };
    case 'PaymentSucceeded':
      return {
        appointmentId: event.appointmentId,
        amountMinor: event.amountMinor,
        currency: event.currency,
      };
    case 'PatientCreated':
      return { createdByDoctor: event.createdByDoctor };
  }
}
