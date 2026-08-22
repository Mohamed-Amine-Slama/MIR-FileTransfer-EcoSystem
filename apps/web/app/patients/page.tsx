'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, type Patient } from '../../lib/api/endpoints';
import { useT } from '../../lib/i18n/provider';
import { RoleGate } from '../../components/RoleGate';
import { Alert, Button, EmptyState, Field, Input, PageHeader, Spinner } from '../../components/ui';

/**
 * Patient worklist — BUILD_SPEC P5.1 / P3.3.
 *
 * SEARCH IS BY PHONE ONLY, and that is a privacy control rather than a
 * simplification. Name search over a cross-border patient index lets anyone
 * with a clinician account enumerate who has been referred — which is exactly
 * the Article 9 exposure the design is trying to avoid. A phone number has to
 * be known in advance.
 *
 * The list itself is not filtered client-side by owner. It arrives already
 * filtered by row-level security, so a doctor sees their own patients because
 * the database said so, not because this component omitted rows.
 */
export default function PatientsPage(): React.JSX.Element {
  return (
    <RoleGate allow={['libya_doctor']}>
      <PatientsList />
    </RoleGate>
  );
}

function PatientsList(): React.JSX.Element {
  const t = useT();
  const [patients, setPatients] = useState<Patient[] | null>(null);
  const [phone, setPhone] = useState('');
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setError(null);
    try {
      const { patients: rows } = await api.patients.list();
      setPatients(rows);
      setSearched(false);
    } catch {
      setError(t.genericError);
      setPatients([]);
    }
  }, [t]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const search = async (): Promise<void> => {
    const trimmed = phone.trim();
    if (trimmed === '') {
      void loadAll();
      return;
    }
    setSearching(true);
    setError(null);
    try {
      const { candidates } = await api.patients.searchByPhone(trimmed);
      setPatients(candidates);
      setSearched(true);
    } catch {
      setError(t.genericError);
    } finally {
      setSearching(false);
    }
  };

  return (
    <main className="page--wide stack">
      <PageHeader
        title={t.patientsTitle}
        description={t.patientsDescription}
        actions={
          <Link href="/patients/new" className="btn btn--primary" data-testid="new-patient">
            {t.patientsNew}
          </Link>
        }
      />

      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <div style={{ flex: 1, minInlineSize: '14rem' }}>
          <Field label={t.patientsSearchPhone}>
            <Input
              data-testid="phone-search"
              value={phone}
              inputMode="tel"
              placeholder="+218…"
              onChange={(e) => setPhone(e.target.value)}
            />
          </Field>
        </div>
        <Button type="submit" data-testid="phone-search-submit" disabled={searching}>
          {t.search}
        </Button>
      </form>

      {error !== null && <Alert tone="danger">{error}</Alert>}

      {patients === null ? (
        <Spinner label={t.loading} />
      ) : patients.length === 0 ? (
        <EmptyState testId="patients-empty">
          {searched ? t.patientsNoMatch : t.patientsEmpty}
        </EmptyState>
      ) : (
        <ul className="list" data-testid="patient-list">
          {patients.map((p) => (
            <li key={p.id} className="list__item" data-testid="patient-row">
              <Link href={`/patients/${p.id}`} style={{ flex: 1 }}>
                {p.fullName}
              </Link>
              <span className="muted small">{p.phoneE164}</span>
              <span className="muted small">{p.dateOfBirth}</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
