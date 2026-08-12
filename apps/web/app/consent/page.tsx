'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, type ConsentTerms } from '../../lib/api/endpoints';
import { useLocale, useT } from '../../lib/i18n/provider';
import { useSession } from '../../lib/session/session';
import { RoleGate } from '../../components/RoleGate';
import { Alert, Button, Card, PageHeader, Spinner } from '../../components/ui';

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
 * granting was.
 */
export default function ConsentPage(): React.JSX.Element {
  return (
    <RoleGate allow={['patient']}>
      <Suspense fallback={<main><Spinner label="…" /></main>}>
        <ConsentForm />
      </Suspense>
    </RoleGate>
  );
}

function ConsentForm(): React.JSX.Element {
  const t = useT();
  const { locale } = useLocale();
  const { user } = useSession();
  const searchParams = useSearchParams();

  const patientId = searchParams.get('patientId') ?? user?.patientId ?? null;
  // Consent names its recipient. Without a doctor there is nothing to consent
  // TO, so the screen says so rather than offering a button that cannot work.
  const grantedTo = searchParams.get('doctorId');

  const [terms, setTerms] = useState<ConsentTerms | null>(null);
  const [consentId, setConsentId] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'busy' | 'granted' | 'revoked'>('idle');
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

  const loadExisting = useCallback(async () => {
    if (patientId === null) return;
    try {
      const { consents } = await api.consent.forPatient(patientId);
      // Only consent for THIS doctor counts. A patient who consented to one
      // Tunisian doctor has not consented to another.
      const match = consents.find((c) => c.grantedTo === grantedTo);
      if (match !== undefined) {
        setConsentId(match.consentId);
        setState('granted');
      }
    } catch {
      // No existing consent is the normal first-visit case.
    }
  }, [patientId, grantedTo]);

  useEffect(() => {
    void loadExisting();
  }, [loadExisting]);

  const grant = async (): Promise<void> => {
    if (patientId === null || terms === null || grantedTo === null) return;
    setState('busy');
    setError(null);
    try {
      const result = await api.consent.grant({
        patientId,
        grantedTo,
        version: terms.version,
        locale: terms.locale,
        // The exact text rendered above. The server re-hashes it and refuses
        // if it does not match the published wording.
        renderedText: terms.body,
      });
      setConsentId(result.consentId);
      setState('granted');
    } catch {
      setError(t.genericError);
      setState('idle');
    }
  };

  const revoke = async (): Promise<void> => {
    if (consentId === null) return;
    setState('busy');
    try {
      await api.consent.revoke(consentId);
      setState('revoked');
      setConsentId(null);
    } catch {
      setError(t.genericError);
      setState('granted');
    }
  };

  return (
    <main className="stack">
      <PageHeader title={t.consentTitle} description={t.consentDescription} />

      {error !== null && <Alert tone="danger">{error}</Alert>}
      {grantedTo === null && (
        <Alert tone="warning" testId="consent-no-doctor">
          {t.consentRequired}
        </Alert>
      )}
      {state === 'granted' && (
        <Alert tone="success" testId="consent-granted">
          {t.consentGranted}
        </Alert>
      )}
      {state === 'revoked' && (
        <Alert tone="warning" testId="consent-revoked">
          {t.consentRevoked}
        </Alert>
      )}

      {terms === null ? (
        <Spinner label={t.loading} />
      ) : (
        <Card>
          <div className="stack-sm">
            {/* The published text, verbatim. Never paraphrased in the UI. */}
            <p data-testid="consent-body" style={{ whiteSpace: 'pre-wrap' }}>
              {terms.body}
            </p>
            <p className="muted small" data-testid="consent-version">
              {terms.version} · {terms.contentHash.slice(0, 12)}
            </p>

            {state === 'granted' ? (
              <Button variant="danger" data-testid="revoke-consent" onClick={() => void revoke()}>
                {t.consentRevoke}
              </Button>
            ) : (
              <Button
                variant="primary"
                data-testid="grant-consent"
                disabled={state === 'busy' || patientId === null || grantedTo === null}
                onClick={() => void grant()}
              >
                {t.consentAgree}
              </Button>
            )}
          </div>
        </Card>
      )}
    </main>
  );
}
