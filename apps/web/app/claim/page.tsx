'use client';

import { useState } from 'react';
import { ApiError } from '../../lib/api/client';
import { api } from '../../lib/api/endpoints';
import { useT } from '../../lib/i18n/provider';
import { useSession } from '../../lib/session/session';
import { RoleGate } from '../../components/RoleGate';
import { Alert, Button, Card, Field, Input, PageHeader } from '../../components/ui';

/**
 * Patient account claim — BUILD_SPEC P5.2.
 *
 * The six-digit code arrives by SMS, NOT in the response to the doctor who
 * issued it. That separation is the point of the whole flow: holding the
 * doctor's session must not be enough to take over a patient's record, so
 * possession of the phone is the second factor.
 *
 * Failures are deliberately indistinguishable. "Wrong code" and "expired code"
 * and "already used" all render the same sentence, because telling them apart
 * turns the form into an oracle for guessing codes.
 */
export default function ClaimPage(): React.JSX.Element {
  return (
    <RoleGate allow={['patient']}>
      <ClaimForm />
    </RoleGate>
  );
}

function ClaimForm(): React.JSX.Element {
  const t = useT();
  const { refresh } = useSession();

  const [code, setCode] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);

  const valid = /^\d{6}$/.test(code);

  const submit = async (): Promise<void> => {
    setState('busy');
    setError(null);
    try {
      await api.patients.claim(code);
      // The session now carries a patientId, which unlocks the rest of the app.
      await refresh();
      setState('done');
    } catch (err) {
      setError(err instanceof ApiError && err.status < 500 ? t.claimInvalid : t.genericError);
      setState('idle');
    }
  };

  return (
    <main className="stack">
      <PageHeader title={t.claimTitle} description={t.claimDescription} />

      {state === 'done' ? (
        <Alert tone="success" testId="claim-success">
          {t.claimSuccess}
        </Alert>
      ) : (
        <Card>
          <div className="stack-sm">
            <Field label={t.claimCode} error={error}>
              <Input
                data-testid="claim-code"
                value={code}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                invalid={error !== null}
                // Strip non-digits as typed: an SMS pasted with spaces or a
                // trailing full stop should not be a validation error.
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              />
            </Field>
            <Button
              variant="primary"
              data-testid="claim-submit"
              disabled={!valid || state === 'busy'}
              onClick={() => void submit()}
            >
              {t.claimSubmit}
            </Button>
          </div>
        </Card>
      )}
    </main>
  );
}
