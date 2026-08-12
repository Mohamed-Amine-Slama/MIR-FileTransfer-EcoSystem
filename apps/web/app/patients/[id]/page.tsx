'use client';

import Link from 'next/link';
import { use, useCallback, useEffect, useState } from 'react';
import { ApiError } from '../../../lib/api/client';
import { api, type Patient, type Study } from '../../../lib/api/endpoints';
import { useDateFormat, useT } from '../../../lib/i18n/provider';
import { RoleGate } from '../../../components/RoleGate';
import { Alert, Button, Card, EmptyState, PageHeader, Spinner } from '../../../components/ui';

/**
 * Patient record — studies, and the actions a referring doctor takes.
 *
 * A 404 here means "not available to you" and never "does not exist". §6
 * requires the two to be indistinguishable, so the copy must not tell the
 * doctor a record is absent when RLS simply filtered it — otherwise the page
 * becomes a way to test whether a given patient id exists.
 */
export default function PatientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): React.JSX.Element {
  const { id } = use(params);
  return (
    <RoleGate allow={['libya_doctor', 'tunisia_doctor']}>
      <PatientDetail patientId={id} />
    </RoleGate>
  );
}

function PatientDetail({ patientId }: { patientId: string }): React.JSX.Element {
  const t = useT();
  const formatDate = useDateFormat();

  const [patient, setPatient] = useState<Patient | null>(null);
  const [studies, setStudies] = useState<Study[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const record = await api.patients.getById(patientId);
      setPatient(record);
    } catch (err) {
      setError(err instanceof ApiError && err.isNotFound ? t.notAuthorised : t.genericError);
      return;
    }
    try {
      const { studies: rows } = await api.imaging.studiesForPatient(patientId);
      setStudies(rows);
    } catch {
      // The record loaded; imaging did not. Show the record rather than
      // failing the whole page — the doctor can still act on it.
      setStudies([]);
    }
  }, [patientId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const issueClaim = async (): Promise<void> => {
    setBusy(true);
    setNotice(null);
    try {
      await api.patients.issueClaimToken(patientId);
      // Deliberately does NOT display the code: it goes to the patient's phone,
      // so that holding this session is not holding the claim credential.
      setNotice(t.patientClaimSent);
    } catch {
      setError(t.genericError);
    } finally {
      setBusy(false);
    }
  };

  if (error !== null && patient === null) {
    return (
      <main>
        <Alert tone="danger" testId="patient-error">
          {error}
        </Alert>
      </main>
    );
  }

  if (patient === null) {
    return (
      <main>
        <Spinner label={t.loading} />
      </main>
    );
  }

  return (
    <main className="page--wide stack" data-testid="patient-detail" data-patient-id={patient.id}>
      <PageHeader
        title={patient.fullName}
        description={`${patient.phoneE164} · ${patient.dateOfBirth}`}
        actions={
          <div className="row">
            <Button data-testid="issue-claim" disabled={busy} onClick={() => void issueClaim()}>
              {t.patientIssueClaim}
            </Button>
            <Link
              href={`/appointments/new?patientId=${patient.id}`}
              className="btn btn--primary"
              data-testid="book-for-patient"
            >
              {t.bookingTitle}
            </Link>
          </div>
        }
      />

      {notice !== null && (
        <Alert tone="success" testId="claim-sent">
          {notice}
        </Alert>
      )}
      {error !== null && <Alert tone="danger">{error}</Alert>}

      <Card title={t.patientStudies}>
        {studies.length === 0 ? (
          <EmptyState testId="studies-empty">{t.none}</EmptyState>
        ) : (
          <ul className="list" data-testid="study-list">
            {studies.map((s) => (
              <li key={s.id} className="list__item" data-testid="study-row">
                <span style={{ flex: 1 }}>{s.description ?? s.studyInstanceUid}</span>
                <span className="muted small">
                  {s.studyDate === null ? '—' : formatDate(s.studyDate)}
                </span>
                <span className="muted small">{s.instanceCount}</span>
                <Link className="btn btn--sm" href={`/viewer/${s.studyInstanceUid}`}>
                  {t.inboxViewStudies}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </main>
  );
}
