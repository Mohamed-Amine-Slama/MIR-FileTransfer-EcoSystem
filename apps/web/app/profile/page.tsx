'use client';

import { useEffect, useState } from 'react';
import { Save, ShieldCheck } from 'lucide-react';
import { phoneE164Schema, type AccountStatus, type Role } from '@mir/contracts';
import { api, type UserProfile } from '../../lib/api/endpoints';
import { useDateFormat, useT } from '../../lib/i18n/provider';
import type { Dictionary } from '../../lib/i18n/dictionary';
import { useSession } from '../../lib/session/session';
import { EVERY_ROLE } from '../../lib/corridor/registry';
import { RoleGate } from '../../components/RoleGate';
import { roleLabel } from '../../components/case/labels';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  Field,
  Input,
  Main,
  PageHeader,
  Separator,
  Spinner,
} from '../../components/ui';

/**
 * The signed-in user's own record — brief §5.1.
 *
 * WHAT IS EDITABLE AND WHAT IS NOT is the substance of this screen. Name, job
 * title, and phone are the user's. Email, role, and account status are not —
 * and they are shown READ-ONLY WITH A REASON rather than hidden, because a
 * clinician who cannot find where to change their email should be told why it
 * is not there, not left hunting through settings.
 *
 * The restriction is not enforced here. A database trigger refuses a change to
 * role, status, keycloak_sub, or email from any writer that is not ops
 * (migration 0009); this screen simply declines to offer what would be refused.
 */
export default function ProfilePage(): React.JSX.Element {
  return (
    <RoleGate allow={EVERY_ROLE}>
      <ProfileScreen />
    </RoleGate>
  );
}

function statusLabel(t: Dictionary, status: AccountStatus): string {
  const labels: Record<AccountStatus, string> = {
    pending_verification: t.statusPendingVerification,
    active: t.statusActive,
    suspended: t.statusSuspended,
  };
  return labels[status];
}

function statusTone(status: AccountStatus): 'success' | 'warning' | 'danger' {
  const tones: Record<AccountStatus, 'success' | 'warning' | 'danger'> = {
    pending_verification: 'warning',
    active: 'success',
    suspended: 'danger',
  };
  return tones[status];
}

function ProfileScreen(): React.JSX.Element {
  const t = useT();
  const formatDate = useDateFormat();
  const { user } = useSession();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [fullName, setFullName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [phone, setPhone] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [state, setState] = useState<'loading' | 'idle' | 'busy'>('loading');
  const [saved, setSaved] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await api.account.profile();
        if (cancelled) return;
        setProfile(loaded);
        setFullName(loaded.fullName);
        setJobTitle(loaded.jobTitle ?? '');
        setPhone(loaded.phoneE164);
      } catch {
        // A flag rather than a translated string: capturing `t` here would make
        // the locale a dependency of the effect, and switching language would
        // refetch the profile for no reason. The sentence is chosen at render.
        if (!cancelled) setLoadFailed(true);
      } finally {
        if (!cancelled) setState('idle');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async (): Promise<void> => {
    const found: Record<string, string> = {};
    if (fullName.trim() === '') found['fullName'] = t.required;
    if (!phoneE164Schema.safeParse(phone.trim()).success) found['phone'] = t.signUpInvalidPhone;
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setState('busy');
    setSaved(false);
    setError(null);
    try {
      setProfile(
        await api.account.updateProfile({
          fullName: fullName.trim(),
          jobTitle: jobTitle.trim(),
          phoneE164: phone.trim(),
        }),
      );
      setSaved(true);
    } catch {
      setError(t.genericError);
    } finally {
      setState('idle');
    }
  };

  if (state === 'loading') {
    return (
      <Main>
        <Spinner label={t.loading} />
      </Main>
    );
  }

  const displayName = profile?.fullName ?? user?.displayName ?? '';

  return (
    <Main>
      <PageHeader title={t.profileTitle} description={t.profileDescription} />

      {(error !== null || loadFailed) && <Alert tone="danger">{error ?? t.genericError}</Alert>}
      {saved && (
        <Alert tone="success" testId="profile-saved">
          {t.profileSaved}
        </Alert>
      )}

      <Card>
        <div className="flex flex-wrap items-center gap-4">
          <Avatar name={displayName} size="lg" />
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold">{displayName}</p>
            {/* bdi: a Latin-script address inside Arabic text reorders without it. */}
            <p className="truncate text-sm text-muted-foreground">
              <bdi>{profile?.email ?? '—'}</bdi>
            </p>
          </div>
          {profile !== null && (
            <div className="ms-auto flex flex-wrap items-center gap-2">
              <Badge tone={statusTone(profile.status)} testId="profile-status">
                {statusLabel(t, profile.status)}
              </Badge>
            </div>
          )}
        </div>

        <Separator className="my-4" />

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Field label={t.signUpFullName} error={errors['fullName'] ?? null}>
            <Input
              data-testid="profile-name"
              value={fullName}
              autoComplete="name"
              invalid={errors['fullName'] !== undefined}
              onChange={(e) => {
                setFullName(e.target.value);
                setSaved(false);
              }}
            />
          </Field>

          <Field label={t.profileJobTitle}>
            <Input
              data-testid="profile-job-title"
              value={jobTitle}
              onChange={(e) => {
                setJobTitle(e.target.value);
                setSaved(false);
              }}
            />
          </Field>

          <Field label={t.signUpPhone} hint={t.signUpPhoneHint} error={errors['phone'] ?? null}>
            <Input
              data-testid="profile-phone"
              type="tel"
              value={phone}
              dir="ltr"
              inputMode="tel"
              invalid={errors['phone'] !== undefined}
              onChange={(e) => {
                setPhone(e.target.value);
                setSaved(false);
              }}
            />
          </Field>

          {/* Shown, disabled, and explained — see the note at the top. */}
          <Field label={t.signInEmail} hint={t.profileEmailLocked}>
            <Input value={profile?.email ?? ''} dir="ltr" disabled readOnly />
          </Field>

          <Button
            type="submit"
            variant="primary"
            data-testid="profile-save"
            disabled={state === 'busy'}
          >
            <Save aria-hidden="true" />
            {state === 'busy' ? t.loading : t.profileSave}
          </Button>
        </form>
      </Card>

      <Card title={t.profileAccountStatus}>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">{t.profileRole}</dt>
            <dd className="text-sm">
              {profile === null ? '—' : roleLabel(t, profile.role as Role)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t.profileMemberSince}</dt>
            <dd className="text-sm">
              {profile === null ? '—' : formatDate(profile.createdAt)}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs text-muted-foreground">{t.profileMfa}</dt>
            <dd className="flex flex-wrap items-center gap-2 text-sm">
              <ShieldCheck
                className={user?.mfaEnrolled === true ? 'size-4 text-success' : 'size-4 text-muted-foreground'}
                aria-hidden="true"
              />
              {user?.mfaEnrolled === true ? t.profileMfaOn : t.profileMfaOff}
              <span className="text-muted-foreground">· {t.profileMfaNote}</span>
            </dd>
          </div>
        </dl>
      </Card>
    </Main>
  );
}
