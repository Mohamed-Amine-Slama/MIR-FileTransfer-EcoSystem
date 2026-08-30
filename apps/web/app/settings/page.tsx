'use client';

import { useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { THEMES, uiLocaleSchema, type Theme } from '@mir/contracts';
import { usePreferences } from '../../lib/account/preferences';
import { LOCALE_NAMES } from '../../lib/i18n/dictionary';
import { useLocale, useT } from '../../lib/i18n/provider';
import { useTheme } from '../../lib/theme/theme';
import {
  Alert,
  Card,
  Field,
  Segmented,
  Select,
  Spinner,
  type SegmentedOption,
} from '../../components/ui';

/**
 * Appearance — theme, language, and time zone.
 *
 * EVERY CHANGE APPLIES IMMEDIATELY AND SAVES IN THE BACKGROUND. There is no
 * Save button, because there is nothing to lose by a mistimed click: the effect
 * of each control is visible the instant it is touched, which is its own
 * confirmation. A save that fails says so and leaves the local change standing
 * — the page still looks the way the user asked, and the account catches up
 * next time.
 *
 * The theme is applied through `useTheme`, not through the saved preferences.
 * The device's choice is what governs this browser; the account copy is a
 * default for a device that has none. See `usePreferences`.
 */
export default function AppearanceSettings(): React.JSX.Element {
  const t = useT();
  const { locale, setLocale } = useLocale();
  const { theme, setTheme } = useTheme();
  const { preferences, loading, save } = usePreferences();
  const [failed, setFailed] = useState(false);

  const themeOptions: SegmentedOption<Theme>[] = THEMES.map((value) => ({
    value,
    label: { light: t.themeLight, dark: t.themeDark, system: t.themeSystem }[value],
    icon: {
      light: <Sun className="size-4" aria-hidden="true" />,
      dark: <Moon className="size-4" aria-hidden="true" />,
      system: <Monitor className="size-4" aria-hidden="true" />,
    }[value],
  }));

  /** Persists whatever is being changed, merged onto what is already stored. */
  const persist = (patch: Partial<{ theme: Theme; locale: typeof locale }>): void => {
    if (preferences === null) return;
    void save({ ...preferences, ...patch }).then((ok) => setFailed(!ok));
  };

  if (loading) return <Spinner label={t.loading} />;

  return (
    <div className="space-y-4">
      {failed && <Alert tone="danger">{t.settingsSaveFailed}</Alert>}

      <Card title={t.themeLabel}>
        <p className="text-sm text-muted-foreground">{t.themeDescription}</p>
        <Segmented
          legend={t.themeLabel}
          name="theme"
          value={theme}
          options={themeOptions}
          testId="theme-choice"
          onChange={(next) => {
            setTheme(next);
            persist({ theme: next });
          }}
        />
      </Card>

      <Card title={t.settingsLanguage}>
        <Field label={t.navLanguage}>
          <Select
            data-testid="settings-locale"
            className="max-w-xs"
            value={locale}
            onChange={(e) => {
              const parsed = uiLocaleSchema.safeParse(e.target.value);
              if (!parsed.success) return;
              setLocale(parsed.data);
              persist({ locale: parsed.data });
            }}
          >
            {Object.entries(LOCALE_NAMES).map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </Select>
        </Field>
      </Card>

      <Card title={t.settingsTimezone}>
        {/*
          Read-only for now, and shown rather than hidden. P10.1 requires the
          zone to be visible wherever an instant is, and a clinician comparing
          an appointment against a colleague's needs to know which zone the
          screen is speaking. Editing it is a settings change the scheduling
          screens do not read yet, and offering a control that changes nothing
          would be worse than stating the value.
        */}
        <p className="text-sm text-muted-foreground">{t.settingsTimezoneHint}</p>
        <p className="font-medium tabular-nums" data-testid="settings-timezone">
          {preferences?.timezone ?? 'UTC'}
        </p>
      </Card>
    </div>
  );
}
