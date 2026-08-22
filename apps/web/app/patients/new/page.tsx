'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, type Patient } from '../../../lib/api/endpoints';
import { useT } from '../../../lib/i18n/provider';
import { RoleGate } from '../../../components/RoleGate';
import { Alert, Button, Card, Field, Input, PageHeader, Select } from '../../../components/ui';

/**
 * Create a patient — BUILD_SPEC P5.1, P3.3.
 *
 * THE DUPLICATE STEP IS THE WHOLE SCREEN.
 * When the phone number already exists the API answers 200 with
 * `confirmation_required` and the matching records — not an error, because the
 * doctor has a real decision to make and only they can make it. Two people
 * genuinely do share a phone: a mother booking for her child, two brothers on
 * one household line.
 *
 * Neither automatic behaviour is acceptable. Auto-merging attaches one
 * person's imaging to another's record. Auto-creating silently splits a
 * patient's history across two records, so the Tunisian doctor sees half the
 * prior scans and has no way to know the other half exists. So the doctor is
 * shown the candidates and must assert "this is a different person", which is
 * recorded as `confirmedDistinctFrom`.
 */
export default function NewPatientPage(): React.JSX.Element {
  return (
    <RoleGate allow={['libya_doctor']}>
      <NewPatientForm />
    </RoleGate>
  );
}

interface FormState {
  phoneE164: string;
  fullName: string;
  dateOfBirth: string;
  sex: 'M' | 'F' | 'O';
  nationalId: string;
}

const EMPTY: FormState = {
  phoneE164: '',
  fullName: '',
  dateOfBirth: '',
  sex: 'M',
  nationalId: '',
};

function NewPatientForm(): React.JSX.Element {
  const t = useT();
  const router = useRouter();

  const [form, setForm] = useState<FormState>(EMPTY);
  const [duplicates, setDuplicates] = useState<Patient[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]): void =>
    setForm((f) => ({ ...f, [key]: value }));

  const complete =
    form.phoneE164.trim() !== '' &&
    form.fullName.trim() !== '' &&
    /^\d{4}-\d{2}-\d{2}$/.test(form.dateOfBirth);

  const submit = async (confirmedDistinctFrom?: string[]): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.patients.create({
        phoneE164: form.phoneE164.trim(),
        fullName: form.fullName.trim(),
        dateOfBirth: form.dateOfBirth,
        sex: form.sex,
        nationalId: form.nationalId.trim() === '' ? undefined : form.nationalId.trim(),
        confirmedDistinctFrom,
      });

      if (result.status === 'confirmation_required') {
        setDuplicates(result.candidates ?? []);
        return;
      }
      if (result.patientId !== undefined) router.push(`/patients/${result.patientId}`);
    } catch {
      setError(t.genericError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="stack">
      <PageHeader title={t.patientsNew} />

      {duplicates !== null && (
        <Card title={t.patientDuplicateTitle}>
          <div className="stack-sm">
            <Alert tone="warning" testId="duplicate-warning">
              {t.patientDuplicateBody}
            </Alert>

            <ul className="list" data-testid="duplicate-list">
              {duplicates.map((d) => (
                <li key={d.id} className="list__item">
                  <span style={{ flex: 1 }}>{d.fullName}</span>
                  <span className="muted small">{d.dateOfBirth}</span>
                  <a className="btn btn--sm" href={`/patients/${d.id}`}>
                    {t.patientStudies}
                  </a>
                </li>
              ))}
            </ul>

            <div className="row">
              <Button
                variant="primary"
                data-testid="confirm-distinct"
                disabled={busy}
                // Naming every candidate we were shown is what makes the
                // assertion specific. A bare "yes, create it" would also
                // suppress a duplicate that appeared between the two requests.
                onClick={() => void submit(duplicates.map((d) => d.id))}
              >
                {t.patientDuplicateConfirm}
              </Button>
              <Button data-testid="cancel-duplicate" onClick={() => setDuplicates(null)}>
                {t.cancel}
              </Button>
            </div>
          </div>
        </Card>
      )}

      <Card>
        <form
          className="stack-sm"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field label={t.patientsSearchPhone}>
            <Input
              data-testid="patient-phone"
              value={form.phoneE164}
              inputMode="tel"
              placeholder="+2189…"
              onChange={(e) => set('phoneE164', e.target.value)}
            />
          </Field>

          <Field label={t.patientName}>
            <Input
              data-testid="patient-name"
              value={form.fullName}
              onChange={(e) => set('fullName', e.target.value)}
            />
          </Field>

          {/* type=date submits YYYY-MM-DD regardless of display locale, which
              is what the API validates. Parsing a localised string here would
              reintroduce the day/month ambiguity the DATE type parser already
              had to fix once. */}
          <Field label={t.patientDob}>
            <Input
              data-testid="patient-dob"
              type="date"
              value={form.dateOfBirth}
              onChange={(e) => set('dateOfBirth', e.target.value)}
            />
          </Field>

          <Field label={t.patientSex}>
            <Select
              data-testid="patient-sex"
              value={form.sex}
              onChange={(e) => set('sex', e.target.value as FormState['sex'])}
            >
              <option value="M">{t.patientSexM}</option>
              <option value="F">{t.patientSexF}</option>
              <option value="O">{t.patientSexO}</option>
            </Select>
          </Field>

          <Field label={t.patientNationalId}>
            <Input
              data-testid="patient-national-id"
              value={form.nationalId}
              onChange={(e) => set('nationalId', e.target.value)}
            />
          </Field>

          {error !== null && <Alert tone="danger">{error}</Alert>}

          <Button type="submit" variant="primary" data-testid="create-patient" disabled={!complete || busy}>
            {t.patientCreate}
          </Button>
        </form>
      </Card>
    </main>
  );
}
