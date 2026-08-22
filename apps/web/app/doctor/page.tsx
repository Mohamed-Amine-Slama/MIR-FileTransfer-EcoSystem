'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, type Appointment } from '../../lib/api/endpoints';
import { useDateFormat, useT } from '../../lib/i18n/provider';
import { RoleGate } from '../../components/RoleGate';
import { AppointmentStatusBadge } from '../../components/AppointmentStatusBadge';
import { Alert, Button, EmptyState, PageHeader, Spinner } from '../../components/ui';

/**
 * Receiving doctor's inbox — the Tunisian side of the referral.
 *
 * ACCEPTING IS WHAT TAKES THE MONEY (D2: capture on acceptance), so the button
 * says so. A doctor who thinks "accept" merely acknowledges the referral will
 * accept everything to triage it, and the patient is charged for consultations
 * that were never going to happen.
 *
 * Declining is not destructive: the authorisation is released and the patient
 * can book elsewhere. That asymmetry is why decline is a plain button and
 * accept is the primary one.
 */
export default function DoctorInboxPage(): React.JSX.Element {
  return (
    <RoleGate allow={['tunisia_doctor']}>
      <Inbox />
    </RoleGate>
  );
}

function Inbox(): React.JSX.Element {
  const t = useT();
  const formatDate = useDateFormat();

  const [appointments, setAppointments] = useState<Appointment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { appointments: rows } = await api.scheduling.listAppointments();
      setAppointments(rows);
    } catch {
      setError(t.genericError);
      setAppointments([]);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (id: string, action: 'accept' | 'decline'): Promise<void> => {
    setBusyId(id);
    setError(null);
    try {
      if (action === 'accept') {
        await api.scheduling.accept(id);
        setNotice(t.inboxAccepted);
      } else {
        await api.scheduling.decline(id);
        setNotice(null);
      }
      await load();
    } catch {
      setError(t.genericError);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <main className="page--wide stack">
      <PageHeader title={t.inboxTitle} />

      {notice !== null && <Alert tone="success">{notice}</Alert>}
      {error !== null && <Alert tone="danger">{error}</Alert>}

      {appointments === null ? (
        <Spinner label={t.loading} />
      ) : appointments.length === 0 ? (
        <EmptyState testId="inbox-empty">{t.inboxEmpty}</EmptyState>
      ) : (
        <ul className="list" data-testid="inbox-list">
          {appointments.map((a) => (
            <li key={a.id} className="list__item" data-testid="inbox-row" data-status={a.status}>
              <div style={{ flex: 1 }}>
                <Link href={`/appointments/${a.id}`}>{a.patientName ?? a.patientId}</Link>
                <div className="muted small">{formatDate(a.startsAt)}</div>
              </div>
              <AppointmentStatusBadge status={a.status} />
              {a.status === 'authorised' && (
                <>
                  <Button
                    variant="primary"
                    size="sm"
                    data-testid="accept-referral"
                    disabled={busyId === a.id}
                    onClick={() => void act(a.id, 'accept')}
                  >
                    {t.inboxAccept}
                  </Button>
                  <Button
                    size="sm"
                    data-testid="decline-referral"
                    disabled={busyId === a.id}
                    onClick={() => void act(a.id, 'decline')}
                  >
                    {t.inboxDecline}
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
