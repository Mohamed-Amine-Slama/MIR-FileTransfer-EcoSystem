import type { CaseSide, CaseStatus, PaymentStatus, ProviderKind, VerificationStatus } from '@mir/contracts';
import type { Dictionary } from '../../lib/i18n/dictionary';

/**
 * Enum-to-label maps, in one place.
 *
 * §5.3 requires status labels be shown "consistently across provider and admin
 * views". These are exhaustive `Record`s rather than switch statements or
 * lookups with a fallback, so adding a status to the contract is a compile
 * error here rather than a screen that quietly renders a raw enum value like
 * `under_review` to a clinic receptionist.
 */

export function caseStatusLabel(t: Dictionary, status: CaseStatus): string {
  const labels: Record<CaseStatus, string> = {
    submitted: t.caseStatusSubmitted,
    under_review: t.caseStatusUnderReview,
    matched: t.caseStatusMatched,
    in_progress: t.caseStatusInProgress,
    completed: t.caseStatusCompleted,
    rejected: t.caseStatusRejected,
    cancelled: t.caseStatusCancelled,
  };
  return labels[status];
}

/**
 * Mirrors the (unexported) Tone union in components/ui. `undefined` is the
 * neutral default Badge and Alert already render, so a neutral state is
 * expressed by having no tone rather than by inventing one.
 */
export type Tone = 'info' | 'warning' | 'danger' | 'success';

export function caseStatusTone(status: CaseStatus): Tone | undefined {
  const tones: Record<CaseStatus, Tone | undefined> = {
    submitted: undefined,
    under_review: 'info',
    matched: 'info',
    in_progress: 'warning',
    completed: 'success',
    rejected: 'danger',
    cancelled: undefined,
  };
  return tones[status];
}

export function sideLabel(t: Dictionary, side: CaseSide): string {
  const labels: Record<CaseSide, string> = {
    source: t.sideSource,
    destination: t.sideDestination,
    ops: t.sideOps,
  };
  return labels[side];
}

export function verificationLabel(t: Dictionary, status: VerificationStatus): string {
  const labels: Record<VerificationStatus, string> = {
    pending: t.verificationPending,
    approved: t.verificationApproved,
    rejected: t.verificationRejected,
  };
  return labels[status];
}

export function verificationTone(status: VerificationStatus): Tone {
  const tones: Record<VerificationStatus, Tone> = {
    pending: 'warning',
    approved: 'success',
    rejected: 'danger',
  };
  return tones[status];
}

export function providerKindLabel(t: Dictionary, kind: ProviderKind): string {
  const labels: Record<ProviderKind, string> = {
    clinic: t.signUpKindClinic,
    laboratory: t.signUpKindLaboratory,
    doctor: t.signUpKindDoctor,
  };
  return labels[kind];
}

export function paymentStatusLabel(t: Dictionary, status: PaymentStatus): string {
  const labels: Record<PaymentStatus, string> = {
    paid: t.payStatusPaid,
    pending: t.payStatusPending,
    overdue: t.payStatusOverdue,
  };
  return labels[status];
}

export function paymentStatusTone(status: PaymentStatus): Tone {
  const tones: Record<PaymentStatus, Tone> = {
    paid: 'success',
    pending: 'warning',
    overdue: 'danger',
  };
  return tones[status];
}

/**
 * What the viewer is expected to do next — brief §5.3 P1.
 *
 * Keyed by status AND by which side is asking, because the same case demands
 * different things of the two parties: while the referring clinic is uploading
 * imaging, the receiving clinic is waiting, and telling both "upload the
 * imaging" would be worse than saying nothing.
 */
export function nextActionLabel(t: Dictionary, status: CaseStatus, side: CaseSide): string {
  if (side === 'ops') {
    return status === 'submitted' ? t.nextActionAwaitReview : t.nextActionNone;
  }
  if (side === 'source') {
    const bySource: Record<CaseStatus, string> = {
      submitted: t.nextActionUploadFiles,
      under_review: t.nextActionAwaitReview,
      matched: t.nextActionAwaitMatch,
      in_progress: t.nextActionNone,
      completed: t.nextActionNone,
      rejected: t.nextActionNone,
      cancelled: t.nextActionNone,
    };
    return bySource[status];
  }
  const byDestination: Record<CaseStatus, string> = {
    submitted: t.nextActionNone,
    under_review: t.nextActionNone,
    matched: t.nextActionSchedule,
    in_progress: t.nextActionSchedule,
    completed: t.nextActionNone,
    rejected: t.nextActionNone,
    cancelled: t.nextActionNone,
  };
  return byDestination[status];
}

/** Minor units to a localised amount. Never floats until the final format. */
export function formatMoney(locale: string, amountMinor: number, currency: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amountMinor / 100);
}
