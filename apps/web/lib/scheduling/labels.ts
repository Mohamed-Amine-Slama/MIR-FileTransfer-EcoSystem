import type { AppointmentKind } from '../api/endpoints';
import type { Dictionary } from '../i18n/dictionary';

/**
 * Enum-to-label maps, spelled as exhaustive `Record`s.
 *
 * The pattern `components/case/labels.ts` established: adding a kind or a
 * weekday becomes a COMPILE ERROR here rather than a raw `follow_up` leaking
 * into the interface in three languages.
 */

export function appointmentKindLabel(kind: AppointmentKind, t: Dictionary): string {
  const map: Record<AppointmentKind, string> = {
    consultation: t.scheduleKindConsultation,
    follow_up: t.scheduleKindFollowUp,
    imaging: t.scheduleKindImaging,
    other: t.scheduleKindOther,
  };
  return map[kind];
}

export const APPOINTMENT_KINDS: readonly AppointmentKind[] = [
  'consultation',
  'follow_up',
  'imaging',
  'other',
];

/** ISO-8601 weekday numbering: 1 = Monday .. 7 = Sunday, as the API stores. */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const ISO_WEEKDAYS: readonly IsoWeekday[] = [1, 2, 3, 4, 5, 6, 7];

export function weekdayLabel(day: IsoWeekday, t: Dictionary): string {
  const map: Record<IsoWeekday, string> = {
    1: t.scheduleMon,
    2: t.scheduleTue,
    3: t.scheduleWed,
    4: t.scheduleThu,
    5: t.scheduleFri,
    6: t.scheduleSat,
    7: t.scheduleSun,
  };
  return map[day];
}
