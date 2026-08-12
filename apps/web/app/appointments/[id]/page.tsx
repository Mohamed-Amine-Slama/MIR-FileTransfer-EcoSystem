'use client';

import Link from 'next/link';
import { use, useCallback, useEffect, useState } from 'react';
import { ApiError } from '../../../lib/api/client';
import { api, type Appointment, type Study } from '../../../lib/api/endpoints';
import { useDateFormat, useT } from '../../../lib/i18n/provider';
import { RoleGate } from '../../../components/RoleGate';
import { AppointmentStatusBadge } from '../../../components/AppointmentStatusBadge';
import { Alert, Button, Card, EmptyState, PageHeader, Spinner } from '../../../components/ui';

/**
 * Appointment detail, including payment authorisation.
 *
 * DECISION D2 in one screen: the patient AUTHORISES here and is charged only
 * when the Tunisian doctor accepts. The copy has to make that explicit, because
 * "pay now" for a consultation that may never be accepted is precisely the
 * trust problem the manual-capture flow exists to solve — and a patient who
 * believes they have already been charged will not book again.
 */
export default function AppointmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): React.JSX.Element {
  const { id } = use(params);
  return (
    <RoleGate allow={['patient', 'libya_doctor', 'tunisia_doctor']}>
      <AppointmentDetail appointmentId={id} />
    </RoleGate>
  );
}

function AppointmentDetail({ appointmentId }: { appointmentId: string }): React.JSX.Element {
  const t = useT();
  const formatDate = useDateFormat();

  const [appointment, setAppointment] = useState<Appointment | null>(null);
  const [studies, setStudies] = useState<Study[]>([]);
  const [payment, setPayment] = useState<{
    status: string;
    amountMinor: number | null;
    currency: string | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const record = await api.scheduling.getAppointment(appointmentId);
      setAppointment(record);
    } catch (err) {
      setError(err instanceof ApiError && err.isNotFound ? t.notAuthorised : t.genericError);
      return;
    }
    // The fee is resolved server-side; the client never proposes an amount.
    try {
      setPayment(await api.billing.status(appointmentId));
    } catch {
      setPayment(null);
    }
    try {
      const { studies: rows } = await api.imaging.studiesForAppointment(appointmentId);
      setStudies(rows);
    } catch {
      // D3: imaging is not visible before payment. An empty list here is a
      // legitimate state, not a failure — the notice below explains it.
      setStudies([]);
    }
  }, [appointmentId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const authorise = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.billing.authorise(appointmentId);
      setNotice(t.checkoutAuthorised);
      await load();
    } catch {
      setError(t.checkoutFailed);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.scheduling.cancel(appointmentId);
      await load();
    } catch {
      setError(t.genericError);
    } finally {
      setBusy(false);
    }
  };

  if (error !== null && appointment === null) {
    return (
      <main>
        <Alert tone="danger" testId="appointment-error">
          {error}
        </Alert>
      </main>
    );
  }

  if (appointment === null) {
    return (
      <main>
        <Spinner label={t.loading} />
      </main>
    );
  }

  const awaitingPayment = appointment.status === 'pending_payment';
  const imagingLocked = appointment.status === 'pending_payment' || appointment.status === 'expired';

  return (
    <main className="stack" data-testid="appointment-detail" data-status={appointment.status}>
      <PageHeader
        title={formatDate(appointment.startsAt)}
        description={appointment.doctorName ?? appointment.doctorId}
        actions={<AppointmentStatusBadge status={appointment.status} />}
      />

      {notice !== null && <Alert tone="success">{notice}</Alert>}
      {error !== null && <Alert tone="danger">{error}</Alert>}

      {awaitingPayment && (
        <Card title={t.checkoutTitle}>
          <div className="stack-sm">
            <Alert tone="info" testId="capture-explanation">
              {t.checkoutDescription}
            </Alert>
            {payment?.amountMinor != null && (
              <p data-testid="payment-amount">
                <strong>{t.checkoutAmount}:</strong>{' '}
                {/* Minor units throughout, converted only for display. */}
                {(payment.amountMinor / 100).toFixed(2)} {payment.currency ?? ''}
              </p>
            )}
            <Button
              variant="primary"
              data-testid="authorise-payment"
              disabled={busy}
              onClick={() => void authorise()}
            >
              {t.checkoutPay}
            </Button>
          </div>
        </Card>
      )}

      <Card title={t.patientStudies}>
        {imagingLocked ? (
          <Alert tone="warning" testId="imaging-locked">
            {t.inboxLockedUntilPayment}
          </Alert>
        ) : studies.length === 0 ? (
          <EmptyState>{t.none}</EmptyState>
        ) : (
          <ul className="list" data-testid="appointment-studies">
            {studies.map((s) => (
              <li key={s.id} className="list__item">
                <span style={{ flex: 1 }}>{s.description ?? s.studyInstanceUid}</span>
                <Link className="btn btn--sm" href={`/viewer/${s.studyInstanceUid}`}>
                  {t.inboxViewStudies}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {appointment.status !== 'cancelled' && appointment.status !== 'expired' && (
        <Button variant="danger" data-testid="cancel-appointment" disabled={busy} onClick={() => void cancel()}>
          {t.cancel}
        </Button>
      )}
    </main>
  );
}
