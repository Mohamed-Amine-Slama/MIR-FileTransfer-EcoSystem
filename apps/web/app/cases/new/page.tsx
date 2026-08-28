'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { canSubmitCases, type Case } from '@mir/contracts';
import { api, type Patient } from '../../../lib/api/endpoints';
import { casesApi } from '../../../lib/api/mock';
import { getCorridor } from '../../../lib/corridor/registry';
import { useCurrentProvider } from '../../../lib/provider/current-provider';
import { useT } from '../../../lib/i18n/provider';
import { RoleGate } from '../../../components/RoleGate';
import { CorridorFields, validateFields } from '../../../components/case/CorridorFields';
import {
  Alert,
  Button,
  Card,
  Field,
  Main,
  PageHeader,
  Select,
  Spinner,
  buttonVariants,
} from '../../../components/ui';

/**
 * Case submission — brief §5.2.
 *
 * The form is not written here. It is rendered from the corridor's
 * `intakeFields` (§4.3), so this file contains no field that assumes a country
 * and adding a corridor does not mean editing this screen.
 *
 * DRAFTS ARE LOCAL AND DELIBERATELY NARROW (§5.2 P1). A draft holds the
 * structured intake answers and a patient id — never an uploaded file, and
 * never anything read out of a medical image. §4.4 forbids medical files
 * lingering in browser storage past the session, so the draft carries the form,
 * not the imaging.
 */
const DRAFT_KEY = 'mir.case-draft';

export default function NewCasePage(): React.JSX.Element {
  return (
    <RoleGate allow={['libya_doctor']}>
      <NewCaseForm />
    </RoleGate>
  );
}

function NewCaseForm(): React.JSX.Element {
  const t = useT();
  const { provider, providerId, loading: providerLoading } = useCurrentProvider();
  const [patients, setPatients] = useState<Patient[] | null>(null);
  const [patientId, setPatientId] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<Case | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const corridor = provider === null ? null : getCorridor(provider.corridorId);

  useEffect(() => {
    void api.patients
      .list()
      .then(({ patients: rows }) => setPatients(rows))
      .catch(() => setPatients([]));
  }, []);

  // Restore a draft once, after mount — localStorage is not available on the
  // server, and reading it during render would desynchronise hydration.
  useEffect(() => {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (raw === null) return;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) return;
      const draft = parsed as { patientId?: unknown; intake?: unknown };
      if (typeof draft.patientId === 'string') setPatientId(draft.patientId);
      if (typeof draft.intake === 'object' && draft.intake !== null) {
        setValues(draft.intake as Record<string, string>);
      }
      setNotice(t.caseNewDraftRestored);
    } catch {
      // A corrupt draft is discarded rather than blocking submission.
      window.localStorage.removeItem(DRAFT_KEY);
    }
  }, [t]);

  const setField = useCallback((key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      const { [key]: _removed, ...rest } = prev;
      return rest;
    });
  }, []);

  const saveDraft = (): void => {
    window.localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ patientId, intake: values, savedAt: new Date().toISOString() }),
    );
    setNotice(t.caseNewDraftSaved);
  };

  const discardDraft = (): void => {
    window.localStorage.removeItem(DRAFT_KEY);
    setPatientId('');
    setValues({});
    setNotice(null);
  };

  const submit = async (): Promise<void> => {
    if (corridor === null || providerId === null) return;
    const found = validateFields(corridor.intakeFields, values, t.required);
    if (patientId === '') found['patient'] = t.required;
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setError(t.caseNewValidationFailed);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const created = await casesApi.submitCase({
        providerId,
        corridorId: corridor.id,
        patientId,
        intake: values,
      });
      window.localStorage.removeItem(DRAFT_KEY);
      setSubmitted(created);
    } catch {
      setError(t.genericError);
    } finally {
      setSubmitting(false);
    }
  };

  if (providerLoading || patients === null) {
    return (
      <Main>
        <Spinner label={t.loading} />
      </Main>
    );
  }

  // §4.4: an unapproved provider is not shown the form at all, rather than
  // being allowed to fill it in and refused at the end.
  if (provider === null || !canSubmitCases(provider)) {
    return (
      <Main>
        <PageHeader title={t.caseNewTitle} />
        <Alert tone="warning" testId="not-approved">
          {t.caseNewNotApproved}
        </Alert>
        <Link href="/verification" className={buttonVariants({ variant: 'outline' })}>
          {t.verificationTitle}
        </Link>
      </Main>
    );
  }

  if (submitted !== null) {
    return (
      <Main>
        <PageHeader title={t.caseSubmittedTitle} />
        <Alert tone="success" testId="case-submitted">
          {t.caseSubmittedBody}
        </Alert>
        <Card>
          <p className="text-sm text-muted-foreground">{t.caseSubmittedRefLabel}</p>
          {/* The reference is the one thing the provider must be able to read
              back over the phone, so it is isolated and given room. */}
          <p className="mt-1 font-mono text-2xl font-bold tracking-wide" data-testid="case-ref">
            <bdi>{submitted.ref}</bdi>
          </p>
        </Card>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href={`/cases/${submitted.ref}`} className={buttonVariants()}>
            {t.viewDetails}
          </Link>
          <Link href="/cases" className={buttonVariants({ variant: 'outline' })}>
            {t.casesTitle}
          </Link>
        </div>
      </Main>
    );
  }

  return (
    <Main>
      <PageHeader title={t.caseNewTitle} description={t.caseNewDescription} />

      {notice !== null && <Alert tone="info">{notice}</Alert>}
      {error !== null && <Alert tone="danger">{error}</Alert>}

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label={`${t.caseNewPatient} *`} error={errors['patient'] ?? null}>
          <Select
            value={patientId}
            data-testid="field-patient"
            onChange={(e) => setPatientId(e.target.value)}
          >
            <option value="">{t.caseNewSelectPatient}</option>
            {patients.map((patient) => (
              <option key={patient.id} value={patient.id}>
                {patient.fullName}
              </option>
            ))}
          </Select>
        </Field>

        {corridor !== null && (
          <CorridorFields
            fields={corridor.intakeFields}
            values={values}
            errors={errors}
            onChange={setField}
          />
        )}

        <div className="flex flex-wrap gap-3 pt-2">
          <Button type="submit" disabled={submitting} data-testid="submit-case">
            {submitting ? t.loading : t.caseNewSubmit}
          </Button>
          <Button type="button" variant="default" onClick={saveDraft}>
            {t.caseNewSaveDraft}
          </Button>
          <Button type="button" variant="ghost" onClick={discardDraft}>
            {t.caseNewDiscardDraft}
          </Button>
        </div>
      </form>
    </Main>
  );
}
