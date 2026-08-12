import type { Role } from '@mir/contracts';
import { apiFetch, newIdempotencyKey } from './client';

/**
 * Typed view of the API surface.
 *
 * One declaration per route, so a change to the API surface is a change to one
 * file rather than a hunt through components. The shapes here mirror the
 * controllers exactly; where they disagreed, the controller won — notably
 * consent, which requires the named recipient and the exact rendered text.
 */

export interface SessionUser {
  userId: string;
  role: Role;
  displayName: string;
  /** Patients only: set once the account is linked to a medical record (P5.2). */
  patientId?: string;
  mfaEnrolled: boolean;
}

export interface Patient {
  id: string;
  fullName: string;
  phoneE164: string;
  dateOfBirth: string;
  sex: 'M' | 'F' | 'O';
  nationalId?: string;
}

export interface CreatePatientResult {
  status: 'created' | 'confirmation_required';
  patientId?: string;
  candidates?: Patient[];
}

export interface Study {
  id: string;
  studyInstanceUid: string;
  description: string | null;
  studyDate: string | null;
  modality: string;
  instanceCount: number;
}

export interface Doctor {
  id: string;
  displayName: string;
  specialty: string | null;
  city: string | null;
}

export interface Slot {
  startsAt: string;
  endsAt: string;
}

export interface Appointment {
  id: string;
  patientId: string;
  patientName?: string;
  doctorId: string;
  doctorName?: string;
  startsAt: string;
  endsAt: string;
  status: 'pending_payment' | 'authorised' | 'confirmed' | 'cancelled' | 'expired';
  studyIds: string[];
}

export interface ConsentTerms {
  version: string;
  locale: string;
  scope: string;
  body: string;
  contentHash: string;
}

export interface AuditEvent {
  id: string;
  occurredAt: string;
  actorUserId: string | null;
  action: string;
  outcome: 'allowed' | 'denied';
  resourceType: string | null;
}

// ---------------------------------------------------------------------------

export const api = {
  session: {
    me: () => apiFetch<SessionUser>('/auth/me'),
  },

  patients: {
    list: () => apiFetch<{ patients: Patient[] }>('/patients'),
    searchByPhone: (phone: string) =>
      apiFetch<{ candidates: Patient[] }>(`/patients/search?phone=${encodeURIComponent(phone)}`),
    getById: (id: string) => apiFetch<Patient>(`/patients/${id}`),
    create: (input: {
      phoneE164: string;
      fullName: string;
      dateOfBirth: string;
      sex: 'M' | 'F' | 'O';
      nationalId?: string;
      confirmedDistinctFrom?: string[];
    }) => apiFetch<CreatePatientResult>('/patients', { method: 'POST', body: input }),
    issueClaimToken: (id: string) =>
      apiFetch<{ status: 'sent'; expiresAt: string }>(`/patients/${id}/claim-token`, {
        method: 'POST',
      }),
    claim: (token: string) =>
      apiFetch<{ patientId: string }>('/patients/claim', { method: 'POST', body: { token } }),
  },

  imaging: {
    studiesForPatient: (patientId: string) =>
      apiFetch<{ studies: Study[] }>(`/studies?patientId=${encodeURIComponent(patientId)}`),
    studiesForAppointment: (appointmentId: string) =>
      apiFetch<{ studies: Study[] }>(
        `/studies?appointmentId=${encodeURIComponent(appointmentId)}`,
      ),
  },

  consent: {
    currentTerms: (locale: string) =>
      apiFetch<ConsentTerms>(`/consent/terms?locale=${encodeURIComponent(locale)}`),
    /**
     * Consent names the receiving doctor and echoes the exact text displayed.
     *
     * `grantedTo` is required by the API because consent is never open-ended —
     * a patient agrees to a NAMED doctor, which is what makes revocation
     * meaningful. `renderedText` is hashed server-side and compared against the
     * published wording, so a stale tab showing superseded terms is rejected
     * rather than filed as agreement to text the patient never saw.
     */
    grant: (input: {
      patientId: string;
      grantedTo: string;
      version: string;
      locale: string;
      renderedText: string;
    }) =>
      apiFetch<{ consentId: string; evidenceHash: string }>('/consent', {
        method: 'POST',
        body: input,
        idempotencyKey: newIdempotencyKey(),
      }),
    revoke: (consentId: string) =>
      apiFetch<void>(`/consent/${consentId}`, { method: 'DELETE' }),
    forPatient: (patientId: string) =>
      apiFetch<{ consents: { consentId: string; grantedTo: string; grantedAt: string }[] }>(
        `/consent?patientId=${encodeURIComponent(patientId)}`,
      ),
  },

  scheduling: {
    doctors: () => apiFetch<{ doctors: Doctor[] }>('/doctors'),
    openSlots: (doctorId: string, from: string, to: string) =>
      apiFetch<{ slots: Slot[] }>(
        `/doctors/${doctorId}/slots?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      ),
    listAppointments: () => apiFetch<{ appointments: Appointment[] }>('/appointments'),
    getAppointment: (id: string) => apiFetch<Appointment>(`/appointments/${id}`),
    book: (input: {
      patientId: string;
      doctorId: string;
      startsAt: string;
      endsAt: string;
      studyIds: string[];
    }) =>
      apiFetch<Appointment>('/appointments', {
        method: 'POST',
        body: input,
        // Double-tap on a bad link must not produce two appointments.
        idempotencyKey: newIdempotencyKey(),
      }),
    cancel: (id: string) => apiFetch<void>(`/appointments/${id}`, { method: 'DELETE' }),
    /** Accepting CAPTURES the held payment (D2) — see the billing controller. */
    accept: (id: string) =>
      apiFetch<{ status: string }>(`/appointments/${id}/accept`, {
        method: 'POST',
        idempotencyKey: newIdempotencyKey(),
      }),
    decline: (id: string) =>
      apiFetch<{ status: 'declined' }>(`/appointments/${id}/decline`, { method: 'POST' }),
    addAvailability: (input: { startsAt: string; endsAt: string; slotMinutes: number }) =>
      apiFetch<{ id: string }>('/availability', { method: 'POST', body: input }),
    listAvailability: () =>
      apiFetch<{ windows: { id: string; startsAt: string; endsAt: string; slotMinutes: number }[] }>(
        '/availability',
      ),
  },

  billing: {
    /**
     * Authorise, never capture. DECISION D2: the money is held when the
     * patient books and taken only when the doctor accepts, so a referral
     * nobody answers costs the patient nothing.
     */
    authorise: (appointmentId: string) =>
      apiFetch<{ status: string; clientSecret?: string }>(
        `/appointments/${appointmentId}/payment`,
        { method: 'POST', idempotencyKey: newIdempotencyKey() },
      ),
    status: (appointmentId: string) =>
      apiFetch<{ status: string; amountMinor: number | null; currency: string | null }>(
        `/appointments/${appointmentId}/payment`,
      ),
  },

  audit: {
    recent: (limit = 100) => apiFetch<{ events: AuditEvent[] }>(`/audit?limit=${limit}`),
  },
};
