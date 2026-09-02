'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError } from '../../lib/api/client';
import { api, type Appointment } from '../../lib/api/endpoints';
import { useDateFormat, useT } from '../../lib/i18n/provider';
import { useSession } from '../../lib/session/session';
import { appointmentKindLabel } from '../../lib/scheduling/labels';
import { isLiveAppointment } from '../../lib/scheduling/status';
import { addDays, startOfDay } from '../../lib/scheduling/week';
import { AppointmentStatusBadge } from '../../components/AppointmentStatusBadge';
import { BookAppointment } from '../../components/schedule/BookAppointment';
import { Alert, Button, Card, EmptyState, Spinner } from '../../components/ui';

/**
 * Today's agenda — the screen a practice opens in the morning.
 *
 * A LIST, NOT A GRID. The calendar tab answers "where are the gaps this week";
 * this answers "who is coming, and what do I do about the one in front of me",
 * which is a sequence rather than a shape. Every row therefore carries its
 * actions, and the next appointment is called out rather than left to be found
 * by reading times.
 */
export default function SchedulePage(): React.JSX.Element {
  const t = useT();
  const formatDate = useDateFormat();
  const { user } = useSession();

  const [appointments, setAppointments] = useState<Appointment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);

  const today = useMemo(() => startOfDay(new Date()), []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { appointments: rows } = await api.scheduling.listAppointments({
        from: today.toISOString(),
        to: addDays(today, 8).toISOString(),
      });
      setAppointments(rows);
    } catch {
      setError(t.genericError);
      setAppointments([]);
    }
  }, [t, today]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (id: string, action: () => Promise<unknown>): Promise<void> => {
    setBusyId(id);
    setError(null);
    try {
      await action();
      await load();
    } catch (err) {
      setError(err instanceof ApiError && err.isConflict ? t.scheduleSlotTaken : t.genericError);
    } finally {
      setBusyId(null);
    }
  };

  const tomorrow = addDays(today, 1);
  const todays = (appointments ?? []).filter((a) => {
    const at = new Date(a.startsAt);
    return at >= today && at < tomorrow;
  });
  const upcoming = (appointments ?? [])
    .filter((a) => new Date(a.startsAt) >= tomorrow && isLiveAppointment(a.status))
    .slice(0, 5);

  // The next one still to happen today — what "who's next" means at a desk.
  const nextId =
    todays.find((a) => isLiveAppointment(a.status) && new Date(a.endsAt) > new Date())?.id ?? null;

  return (
    <div className="space-y-6">
      {error !== null && <Alert tone="danger">{error}</Alert>}

      {booking && user !== null ? (
        <BookAppointment
          doctorId={user.userId}
          startsAt={new Date().toISOString()}
          endsAt={new Date(Date.now() + 30 * 60_000).toISOString()}
          onBooked={() => {
            setBooking(false);
            void load();
          }}
          onCancel={() => setBooking(false)}
        />
      ) : (
        <div className="flex justify-end">
          <Button variant="primary" data-testid="new-appointment" onClick={() => setBooking(true)}>
            {t.scheduleNewAppointment}
          </Button>
        </div>
      )}

      <Card title={t.scheduleAgendaTitle}>
        {appointments === null ? (
          <Spinner label={t.loading} />
        ) : todays.length === 0 ? (
          <EmptyState testId="agenda-empty">{t.scheduleAgendaEmpty}</EmptyState>
        ) : (
          <ul className="divide-y" data-testid="agenda-list">
            {todays.map((a) => (
              <li
                key={a.id}
                data-testid="agenda-row"
                data-status={a.status}
                className={
                  a.id === nextId
                    ? // The one piece of emphasis on the screen. A border on the
                      // leading edge reads correctly in both directions, which a
                      // left border would not.
                      'border-s-2 border-primary ps-3 py-3'
                    : 'ps-3 py-3'
                }
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-medium tabular-nums">{formatDate(a.startsAt)}</span>
                    <span className="ms-2">{a.patientName}</span>
                    {a.patientPhone !== undefined && (
                      <span className="ms-2 text-muted-foreground tabular-nums" dir="ltr">
                        {a.patientPhone}
                      </span>
                    )}
                  </div>
                  <AppointmentStatusBadge status={a.status} />
                </div>

                <p className="mt-1 text-muted-foreground">
                  {appointmentKindLabel(a.kind, t)}
                  {a.reason !== null && a.reason !== '' ? ` · ${a.reason}` : ''}
                </p>

                {isLiveAppointment(a.status) && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      variant="default"
                      data-testid="mark-completed"
                      disabled={busyId === a.id}
                      onClick={() => void act(a.id, () => api.scheduling.complete(a.id))}
                    >
                      {t.scheduleMarkCompleted}
                    </Button>
                    <Button
                      variant="default"
                      data-testid="mark-no-show"
                      disabled={busyId === a.id}
                      onClick={() => void act(a.id, () => api.scheduling.noShow(a.id))}
                    >
                      {t.scheduleMarkNoShow}
                    </Button>
                    <Button
                      variant="danger"
                      data-testid="cancel-appointment"
                      disabled={busyId === a.id}
                      onClick={() => void act(a.id, () => api.scheduling.cancelAsDoctor(a.id))}
                    >
                      {t.scheduleCancelAppointment}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={t.scheduleUpcoming}>
        {appointments === null ? (
          <Spinner label={t.loading} />
        ) : upcoming.length === 0 ? (
          <EmptyState testId="upcoming-empty">{t.scheduleNoUpcoming}</EmptyState>
        ) : (
          <ul className="divide-y" data-testid="upcoming-list">
            {upcoming.map((a) => (
              <li key={a.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span className="tabular-nums">{formatDate(a.startsAt)}</span>
                <span className="text-muted-foreground">{a.patientName}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
