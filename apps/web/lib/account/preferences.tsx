'use client';

import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_PREFERENCES, type UserPreferences } from '@mir/contracts';
import { api } from '../api/endpoints';
import { useLocale } from '../i18n/provider';
import { useSession } from '../session/session';
import { useTheme } from '../theme/theme';

/**
 * The signed-in user's stored preferences.
 *
 * WHY THE ACCOUNT COPY DOES NOT WIN. Theme and language are applied from this
 * browser's own storage before the page paints, long before the session is
 * known. Having the server's copy overwrite that on arrival would mean every
 * page load flickers from the local choice to the account one — and would make
 * the toggle look broken to anyone whose devices disagree.
 *
 * So the account copy is a DEFAULT FOR A DEVICE THAT HAS NONE. A new laptop
 * picks it up; a device where someone has already chosen keeps its choice, and
 * the next save from the settings screen brings the account into line.
 */
export function usePreferences(): {
  preferences: UserPreferences | null;
  loading: boolean;
  save: (next: UserPreferences) => Promise<boolean>;
} {
  const { status } = useSession();
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status !== 'authenticated') {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await api.account.preferences();
        if (!cancelled) setPreferences(loaded);
      } catch {
        // A settings screen that cannot load is worse than one showing the
        // defaults it is about to write, so this fails soft.
        if (!cancelled) setPreferences(DEFAULT_PREFERENCES);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status]);

  const save = useCallback(async (next: UserPreferences): Promise<boolean> => {
    try {
      setPreferences(await api.account.savePreferences(next));
      return true;
    } catch {
      return false;
    }
  }, []);

  return { preferences, loading, save };
}

/**
 * Applies account-level appearance to a device that has expressed no choice.
 *
 * Rendered once inside the application chrome. It has no markup — it exists to
 * run an effect at a point in the tree where both the session and the theme
 * are available, which a provider could not do without the session becoming a
 * dependency of the theme.
 */
export function AccountPreferencesSync(): null {
  const { status } = useSession();
  const { adoptAccountDefault } = useTheme();
  const { adoptAccountDefault: adoptLocale } = useLocale();
  const [applied, setApplied] = useState(false);

  useEffect(() => {
    if (status !== 'authenticated' || applied) return;
    let cancelled = false;
    void (async () => {
      try {
        const preferences = await api.account.preferences();
        if (cancelled) return;
        // Both calls are no-ops on a browser that already holds a choice —
        // the precedence rule lives in the providers, not here, so there is one
        // place to read it and no way for a caller to bypass it.
        adoptAccountDefault(preferences.theme);
        adoptLocale(preferences.locale);
      } catch {
        // Nothing to apply. The local choice, or the default, stands.
      } finally {
        if (!cancelled) setApplied(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, applied, adoptAccountDefault, adoptLocale]);

  return null;
}
