'use client';

import { useState } from 'react';
import { usePreferences } from '../../../lib/account/preferences';
import { useT } from '../../../lib/i18n/provider';
import { Alert, Card, Separator, Spinner, Switch } from '../../../components/ui';

/**
 * Notification channels — brief §5.6 P2.
 *
 * THERE IS NO IN-APP SWITCH, and its absence is the design. §5.6 P0 makes
 * case-level notification a requirement, and the in-app centre is where a
 * provider discovers a status change they must act on. A toggle for it would be
 * a way to silently opt out of the thing the platform exists to tell you — so
 * the contract's `NotificationChannels` has two fields, the database has two
 * columns, and there is nothing here to render for a third.
 *
 * Email and SMS are reminders ABOUT that centre, and those are the user's to
 * refuse. The notice below says which is which, because "turn off
 * notifications" means different things to different people and one of those
 * meanings is not on offer.
 */
export default function NotificationSettings(): React.JSX.Element {
  const t = useT();
  const { preferences, loading, save } = usePreferences();
  const [failed, setFailed] = useState(false);

  if (loading || preferences === null) return <Spinner label={t.loading} />;

  const toggle = (channel: 'email' | 'sms', value: boolean): void => {
    void save({
      ...preferences,
      notify: { ...preferences.notify, [channel]: value },
    }).then((ok) => setFailed(!ok));
  };

  return (
    <div className="space-y-4">
      {failed && <Alert tone="danger">{t.settingsSaveFailed}</Alert>}

      <Card title={t.settingsNotifications}>
        <label className="flex items-start justify-between gap-4 py-2">
          <span className="min-w-0">
            <span className="block text-sm font-semibold">{t.notifyEmail}</span>
            <span className="block text-sm text-muted-foreground">{t.notifyEmailHint}</span>
          </span>
          <Switch
            data-testid="notify-email"
            checked={preferences.notify.email}
            onChange={(e) => toggle('email', e.target.checked)}
          />
        </label>

        <Separator />

        <label className="flex items-start justify-between gap-4 py-2">
          <span className="min-w-0">
            <span className="block text-sm font-semibold">{t.notifySms}</span>
            <span className="block text-sm text-muted-foreground">{t.notifySmsHint}</span>
          </span>
          <Switch
            data-testid="notify-sms"
            checked={preferences.notify.sms}
            onChange={(e) => toggle('sms', e.target.checked)}
          />
        </label>
      </Card>

      <Alert tone="info" testId="notify-in-app-note">
        {t.notifyInAppNote}
      </Alert>
    </div>
  );
}
