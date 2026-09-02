'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type Appointment } from '../../../lib/api/endpoints';
import { useDateFormat, useT } from '../../../lib/i18n/provider';
import { isLiveAppointment } from '../../../lib/scheduling/status';
import { addDays, hourRangeFor, isSameDay, rowOffset, weekDays } from '../../../lib/scheduling/week';
import { Alert, Button, Card, Spinner } from '../../../components/ui';

/**
 * The week grid.
 *
 * WHY CSS GRID AND NOT ABSOLUTE POSITIONING. An appointment is placed with
 * `grid-row`, spanning as many quarter-hour rows as it lasts. The alternative —
 * a positioned overlay with `top` and `height` in pixels — has to be told which
 * way the days run, and in Arabic they run the other way. Here the grid places
 * columns along the inline axis, so the browser puts Monday on the right in RTL
 * and on the left in LTR from the same markup, with the hour gutter following
 * it. There is no direction-aware code in this file, which is the point: the
 * bug where a calendar mirrors everything except its own contents cannot happen.
 *
 * ALL TIME ARITHMETIC IS LOCAL. The API returns instants; the only place they
 * become "Tuesday at 09:00" is here, in the zone of the person reading it.
 */

/** Rows per hour. Quarter-hours place a :15 or :45 start without rounding. */
const ROWS_PER_HOUR = 4;

export default function CalendarPage(): React.JSX.Element {
  const t = useT();
  const formatDate = useDateFormat();

  const [anchor, setAnchor] = useState(() => new Date());
  const [appointments, setAppointments] = useState<Appointment[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const days = useMemo(() => weekDays(anchor), [anchor]);

  const load = useCallback(async () => {
    setError(null);
    setAppointments(null);
    const first = days[0];
    if (first === undefined) return;
    try {
      const { appointments: rows } = await api.scheduling.listAppointments({
        from: first.toISOString(),
        to: addDays(first, 7).toISOString(),
      });
      setAppointments(rows);
    } catch {
      setError(t.genericError);
      setAppointments([]);
    }
  }, [days, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = (appointments ?? []).filter((a) => isLiveAppointment(a.status));
  const range = hourRangeFor(visible.flatMap((a) => [new Date(a.startsAt), new Date(a.endsAt)]));
  const hours = Array.from({ length: range.end - range.start }, (_, i) => range.start + i);
  const totalRows = hours.length * ROWS_PER_HOUR;

  const firstDay = days[0];

  return (
    <div className="space-y-4">
      {error !== null && <Alert tone="danger">{error}</Alert>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">
          {t.scheduleWeekOf} {firstDay === undefined ? '' : formatDate(firstDay.toISOString())}
        </h2>
        <div className="flex gap-2">
          <Button
            variant="default"
            data-testid="week-previous"
            onClick={() => setAnchor((d) => addDays(d, -7))}
          >
            {t.schedulePrevious}
          </Button>
          <Button variant="default" data-testid="week-today" onClick={() => setAnchor(new Date())}>
            {t.scheduleThisWeek}
          </Button>
          <Button
            variant="default"
            data-testid="week-next"
            onClick={() => setAnchor((d) => addDays(d, 7))}
          >
            {t.scheduleNext}
          </Button>
        </div>
      </div>

      <Card>
        {appointments === null ? (
          <Spinner label={t.loading} />
        ) : (
          // The grid scrolls inside its own container: a week of columns cannot
          // be made narrow enough for a phone, and the page body must never
          // scroll sideways.
          <div className="overflow-x-auto">
            <div className="min-w-[44rem]" data-testid="week-grid">
              {/* Day headings. The leading cell is the hour gutter's width. */}
              <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] border-b">
                <div />
                {days.map((d) => (
                  <div
                    key={d.toISOString()}
                    data-testid="week-day-heading"
                    className={`px-1 py-2 text-center ${
                      isSameDay(d, new Date()) ? 'font-semibold text-primary' : ''
                    }`}
                  >
                    {formatDate(d.toISOString())}
                  </div>
                ))}
              </div>

              <div
                className="relative grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]"
                style={{ gridTemplateRows: `repeat(${totalRows}, 1rem)` }}
              >
                {/* Hour labels, one per hour, in the gutter column. */}
                {hours.map((h, i) => (
                  <div
                    key={h}
                    className="border-t pe-2 text-end text-xs text-muted-foreground tabular-nums"
                    style={{ gridColumn: 1, gridRow: `${i * ROWS_PER_HOUR + 1} / span ${ROWS_PER_HOUR}` }}
                  >
                    {String(h).padStart(2, '0')}:00
                  </div>
                ))}

                {/* One background cell per day per hour, for the rules. */}
                {days.map((d, dayIndex) =>
                  hours.map((h, i) => (
                    <div
                      key={`${d.toISOString()}-${h}`}
                      className="border-s border-t"
                      style={{
                        gridColumn: dayIndex + 2,
                        gridRow: `${i * ROWS_PER_HOUR + 1} / span ${ROWS_PER_HOUR}`,
                      }}
                    />
                  )),
                )}

                {/* The appointments themselves, on top of the cells. */}
                {days.map((d, dayIndex) =>
                  visible
                    .filter((a) => isSameDay(new Date(a.startsAt), d))
                    .map((a) => {
                      const start = new Date(a.startsAt);
                      const end = new Date(a.endsAt);
                      const from = Math.max(0, Math.round(rowOffset(start, range) * ROWS_PER_HOUR));
                      const to = Math.min(
                        totalRows,
                        Math.max(from + 1, Math.round(rowOffset(end, range) * ROWS_PER_HOUR)),
                      );
                      return (
                        <a
                          key={a.id}
                          href={`/appointments/${a.id}`}
                          data-testid="calendar-appointment"
                          data-status={a.status}
                          className="z-10 m-px overflow-hidden rounded-sm bg-primary/15 px-1 py-0.5 text-xs leading-tight ring-1 ring-primary/30 hover:bg-primary/25"
                          style={{ gridColumn: dayIndex + 2, gridRow: `${from + 1} / ${to + 1}` }}
                        >
                          <span className="block truncate font-medium">{a.patientName}</span>
                          {a.reason !== null && a.reason !== '' && (
                            <span className="block truncate text-muted-foreground">{a.reason}</span>
                          )}
                        </a>
                      );
                    }),
                )}
              </div>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
