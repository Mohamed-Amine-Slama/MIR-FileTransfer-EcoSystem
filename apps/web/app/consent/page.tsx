'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, type ConsentTerms, type Doctor } from '../../lib/api/endpoints';
import { useDateFormat, useLocale, useT } from '../../lib/i18n/provider';
import { useSession } from '../../lib/session/session';
import { RoleGate } from '../../components/RoleGate';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Field,
  Main,
  PageHeader,
  Select,
  Spinner,
} from '../../components/ui';

/**
 * Cross-border transfer consent — BUILD_SPEC P5.3.
 *
 * WHAT IS BEING CONSENTED TO IS A RESTRICTED TRANSFER, and the decisions file
 * is blunt about why that matters: the business is incorporated in Estonia
 * (EU/EEA), Tunisia has no adequacy decision, so sending a patient's imaging to
 * a Tunisian doctor is a Chapter V transfer requiring its own legal basis.
 *
 * Two things follow for this screen:
 *
 *  1. The exact TEXT the patient agreed to is versioned and hashed server-side
 *     (consent_terms is immutable by trigger). This page renders whatever the
 *     API says the current published terms are — it never carries its own copy
 *     of the wording, because then the evidence and the display could drift.
 *  2. Consent is recorded with that version and hash, so "what did they agree
 *     to, exactly" is answerable years later. That is the whole point of the
 *     evidence hash.
 *
 * Consent is also revocable, and revocation must be as easy to reach as
 * granting was — which is why this page lists every ACTIVE consent with its
 * own revoke control, and is linked from the patient's navigation rather than
 * reachable only through a crafted URL.
 *
 * The recipient is always NAMED: granting requires choosing a doctor
 * explicitly (preselected when the page is opened with ?doctorId=…), because
 * consent to one Tunisian doctor is not consent to another.
 */
export default function ConsentPage(): React.JSX.Element {
  return (
    <RoleGate allow={['patient']}>
      <Suspense fallback={<Main><Spinner label="…" /></Main>}>
        <ConsentScreen />
      </Suspense>
    </RoleGate>
  );
}

interface ConsentRow {
  consentId: string;
  grantedTo: string;
  grantedAt: string;
}

function ConsentScreen(): React.JSX.Element {
  const t = useT();
  const { locale } = useLocale();
  const { user } = useSession();
  const formatDate = useDateFormat();
  const searchParams = useSearchParams();

  const patientId = searchParams.get('patientId') ?? user?.patientId ?? null;

  const [terms, setTerms] = useState<ConsentTerms | null>(null);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [consents, setConsents] = useState<ConsentRow[] | null>(null);
  // Consent names its recipient. The query param preselects; the patient can
  // always change it, and granting is impossible until one is chosen.
  const [doctorId, setDoctorId] = useState<string>(searchParams.get('doctorId') ?? '');
  const [notice, setNotice] = useState<'granted' | 'revoked' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Terms are fetched per locale: the patient must read what they sign in a
  // language they actually speak, and each translation is separately published
  // and hashed.
  useEffect(() => {
    void (async () => {
      try {
        setTerms(await api.consent.currentTerms(locale));
      } catch {
        setError(t.genericError);
      }
    })();
  }, [locale, t]);

  // The doctors list exists to NAME recipients — both in the select below and
  // beside each active consent, so "revoke" is never aimed at a bare UUID.
  useEffect(() => {
    void (async () => {
      try {
        const { doctors: rows } = await api.scheduling.doctors();
        setDoctors(rows);
      } catch {
        setDoctors([]); // Names degrade to ids; the flow still works.
      }
    })();
  }, []);

  const loadConsents = useCallback(async () => {
    if (patientId === null) {
      setConsents([]);
      return;
    }
    try {
      const { consents: rows } = await api.consent.forPatient(patientId);
      setConsents(rows);
    } catch {
      setConsents([]);
    }
  }, [patientId]);

  useEffect(() => {
    void loadConsents();
  }, [loadConsents]);

  const doctorName = (id: string): string =>
    doctors.find((d) => d.id === id)?.displayName ?? id;

  const alreadyGranted =
    doctorId !== '' && (consents ?? []).some((c) => c.grantedTo === doctorId);

  const grant = async (): Promise<void> => {
    if (patientId === null || terms === null || doctorId === '') return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.consent.grant({
        patientId,
        grantedTo: doctorId,
        version: terms.version,
        locale: terms.locale,
        // The exact text rendered above. The server re-hashes it and refuses
        // if it does not match the published wording.
        renderedText: terms.body,
      });
      setNotice('granted');
      await loadConsents();
    } catch {
      setError(t.genericError);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (consentId: string): Promise<void> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.consent.revoke(consentId);
      setNotice('revoked');
      await loadConsents();
    } catch {
      setError(t.genericError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Main>
      <PageHeader title={t.consentTitle} description={t.consentDescription} />

      {error !== null && <Alert tone="danger">{error}</Alert>}
      {notice === 'granted' && (
        <Alert tone="success" testId="consent-granted">
          {t.consentGranted}
        </Alert>
      )}
      {notice === 'revoked' && (
        <Alert tone="warning" testId="consent-revoked">
          {t.consentRevoked}
        </Alert>
      )}

      {/* Every active consent, each with its own revoke control. */}
      <Card title={t.consentActiveTitle}>
        {consents === null ? (
          <Spinner label={t.loading} />
        ) : consents.length === 0 ? (
          <EmptyState testId="consent-list-empty">{t.consentNoneActive}</EmptyState>
        ) : (
          <ul className="divide-y rounded-md border" data-testid="consent-list">
            {consents.map((c) => (
              <li
                key={c.consentId}
                className="flex flex-wrap items-center gap-3 px-3 py-2"
                data-testid="consent-list-row"
              >
                <span className="flex-1 text-sm font-medium">{doctorName(c.grantedTo)}</span>
                <span className="text-sm tabular-nums text-muted-foreground">
                  {formatDate(c.grantedAt)}
                </span>
                <Button
                  variant="danger"
                  size="sm"
                  data-testid="revoke-consent"
                  disabled={busy}
                  onClick={() => void revoke(c.consentId)}
                >
                  {t.consentRevoke}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Granting: a NAMED doctor, the verbatim published text, one action. */}
      <Card title={t.consentGrantTitle}>
        <Field label={t.consentSelectDoctor}>
          <Select
            data-testid="consent-doctor-select"
            value={doctorId}
            onChange={(e) => setDoctorId(e.target.value)}
          >
            <option value="">—</option>
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.displayName}
                {d.city === null || d.city === '' ? '' : ` · ${d.city}`}
              </option>
            ))}
          </Select>
        </Field>

        {doctorId === '' && (
          <Alert tone="warning" testId="consent-no-doctor">
            {t.consentRequired}
          </Alert>
        )}

        {terms === null ? (
          <Spinner label={t.loading} />
        ) : (
          <>
            {/* The published text, verbatim. Never paraphrased in the UI, and
                framed as a document: bordered, scrollable, self-contained. */}
            <div className="max-h-96 overflow-y-auto rounded-md border bg-muted/40 p-4">
              <p data-testid="consent-body" className="whitespace-pre-wrap text-sm leading-relaxed">
                {terms.body}
              </p>
            </div>
            <p className="text-xs text-muted-foreground" data-testid="consent-version">
              {terms.version} · {terms.contentHash.slice(0, 12)}
            </p>

            {alreadyGranted ? (
              <Alert tone="info" testId="consent-already-granted">
                {t.consentGranted}
              </Alert>
            ) : (
              <Button
                variant="primary"
                className="h-11 w-full sm:w-auto"
                data-testid="grant-consent"
                disabled={busy || patientId === null || doctorId === ''}
                onClick={() => void grant()}
              >
                {t.consentAgree}
              </Button>
            )}
          </>
        )}
      </Card>
    </Main>
  );
}
