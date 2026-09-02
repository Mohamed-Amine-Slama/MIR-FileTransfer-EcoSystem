/**
 * Week arithmetic for the calendar grid.
 *
 * ALL OF THIS IS LOCAL-TIME ARITHMETIC ON PURPOSE. The API stores and returns
 * instants (P10.1), and the only place they become a day-of-the-week and an
 * hour-of-the-day is here, in the viewer's own zone — which is the zone the
 * person reading the calendar is standing in. Doing it any earlier would put a
 * server's idea of "Tuesday" on a doctor's screen.
 *
 * Weeks start on MONDAY, matching the ISO numbering the availability rules use.
 * A calendar whose week starts on a different day from the rules that fill it
 * is a bug generator.
 */

export const DAYS_IN_WEEK = 7;

/** Midnight local on the Monday of the week containing `date`. */
export function startOfWeek(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  // getDay() is 0=Sunday; shift so Monday is 0.
  const fromMonday = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - fromMonday);
  return d;
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** The seven local midnights of the week containing `date`, Monday first. */
export function weekDays(date: Date): Date[] {
  const monday = startOfWeek(date);
  return Array.from({ length: DAYS_IN_WEEK }, (_, i) => addDays(monday, i));
}

export interface HourRange {
  /** First hour shown, 0-23. */
  start: number;
  /** Last hour shown, exclusive. */
  end: number;
}

/**
 * The hours worth drawing.
 *
 * A grid running 00:00-24:00 is mostly empty and pushes the working day off
 * the screen, so the range is derived from what is actually booked, widened to
 * a plausible clinic day and clamped. An appointment at 06:00 pulls the grid
 * open rather than being hidden above the top edge — silently cropping an
 * appointment is the one thing a calendar must never do.
 */
export function hourRangeFor(times: readonly Date[], fallback: HourRange = { start: 8, end: 19 }): HourRange {
  if (times.length === 0) return fallback;

  let min = fallback.start;
  let max = fallback.end;
  for (const t of times) {
    min = Math.min(min, t.getHours());
    // Round the end hour up so an appointment ending at 17:30 still fits.
    max = Math.max(max, t.getMinutes() > 0 ? t.getHours() + 1 : t.getHours());
  }
  return { start: Math.max(0, min), end: Math.min(24, Math.max(max, min + 1)) };
}

/** Where a time falls in the grid, as a fraction of an hour row. */
export function rowOffset(date: Date, range: HourRange): number {
  return date.getHours() - range.start + date.getMinutes() / 60;
}
