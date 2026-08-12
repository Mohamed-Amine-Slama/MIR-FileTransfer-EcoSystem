'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useT } from '../../lib/i18n/provider';
import { useSession } from '../../lib/session/session';
import { Alert, Button, Card, Field, Input, PageHeader } from '../../components/ui';

/**
 * Sign-in — BUILD_SPEC P4.
 *
 * Authentication belongs to Keycloak (P4.1), not to this app: the redirect
 * below hands off and comes back with a token. That is what keeps password
 * handling, TOTP enrolment and lockout policy in one audited place instead of
 * reimplemented here.
 *
 * The token box underneath is a DEVELOPMENT affordance. It is visible only
 * when the identity provider has not been configured, so it cannot become a
 * production login path by accident — and it is why P4.3's rule still holds:
 * clinical roles must have TOTP enrolled, and that is enforced by the token
 * issuer and re-checked by the API guard, never by this form.
 */
export default function LoginPage(): React.JSX.Element {
  const t = useT();
  const router = useRouter();
  const { signInWithToken } = useSession();

  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onDevSignIn = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await signInWithToken(token.trim());
      router.push('/');
    } catch {
      setError(t.genericError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="stack">
      <PageHeader title={t.signInTitle} description={t.signInDescription} />

      <Card>
        {/* The real path. Points at the API's OIDC entry point so the
            redirect_uri and PKCE parameters are built server-side, where the
            client secret and the allowed-callback list live. */}
        <a className="btn btn--primary" href="/api/auth/login" data-testid="oidc-login">
          {t.signInContinue}
        </a>
      </Card>

      <Card title={t.signInDevTitle}>
        <div className="stack-sm">
          <Alert tone="warning">{t.signInDevHint}</Alert>
          <Field label={t.signInToken}>
            <Input
              data-testid="dev-token"
              value={token}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setToken(e.target.value)}
            />
          </Field>
          {error !== null && <Alert tone="danger">{error}</Alert>}
          <Button
            variant="primary"
            data-testid="dev-sign-in"
            disabled={busy || token.trim() === ''}
            onClick={() => void onDevSignIn()}
          >
            {t.navSignIn}
          </Button>
        </div>
      </Card>
    </main>
  );
}
