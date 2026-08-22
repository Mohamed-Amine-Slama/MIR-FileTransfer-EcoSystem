'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, type Appointment } from '../../lib/api/endpoints';
import { useDateFormat, useT } from '../../lib/i18n/provider';
import { RoleGate } from '../../components/RoleGate';
import { AppointmentStatusBadge } from '../../components/AppointmentStatusBadge';
import { Alert, EmptyState, PageHeader, Spinner } from '../../components/ui';

/** Appointment list for patients and referring doctors. */
export default function AppointmentsPage(): React.JSX.Element {
  return (
    <RoleGate allow={['patient', 'libya_doctor']}>
      <AppointmentsList />
    </RoleGate>
  );
}

function AppointmentsList(): React.JSX.Element {
  const t = useT();
  const formatDate = useDateFormat();

  const [appointments, setAppointments] = useState<Appointment[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const { appointments: rows } = await api.scheduling.listAppointments();
        setAppointments(rows);
      } catch {
        setError(t.genericError);
        setAppointments([]);
      }
    })();
  }, [t]);

  return (
    <main className="page--wide stack">
      <PageHeader
        title={t.appointmentsTitle}
        actions={
          <Link href="/appointments/new" className="btn btn--primary" data-testid="new-appointment">
            {t.bookingTitle}
          </Link>
        }
      />

      {error !== null && <Alert tone="danger">{error}</Alert>}

      {appointments === null ? (
        <Spinner label={t.loading} />
      ) : appointments.length === 0 ? (
        <EmptyState testId="appointments-empty">{t.appointmentsEmpty}</EmptyState>
      ) : (
        <ul className="list" data-testid="appointment-list">
          {appointments.map((a) => (
            <li key={a.id} className="list__item" data-testid="appointment-row" data-status={a.status}>
              <Link href={`/appointments/${a.id}`} style={{ flex: 1 }}>
                {formatDate(a.startsAt)}
              </Link>
              <span className="muted small">{a.doctorName ?? a.doctorId}</span>
              <AppointmentStatusBadge status={a.status} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
