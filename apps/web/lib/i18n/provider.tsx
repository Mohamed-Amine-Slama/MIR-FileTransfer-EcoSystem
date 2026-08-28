'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  isContentLocale,
  UI_LOCALE_DIRECTION,
  uiLocaleSchema,
  type Locale,
  type UiLocale,
} from '@mir/contracts';
import { DICTIONARIES, type Dictionary } from './dictionary';

/**
 * Locale context — DECISION D4.
 *
 * Direction is never inferred from the language tag; it comes from
 * LOCALE_DIRECTION in @mir/contracts, the same table the API and the Keycloak
 * realm read. That is what makes it impossible to ship a locale with the wrong
 * direction: adding one to the shared table forces a direction to be chosen.
 *
 * The chosen locale is applied to <html lang dir> imperatively. Next renders
 * the document element on the server, where the user's stored preference is
 * not available, so setting it in an effect after mount is the honest option —
 * the alternative is a cookie read on every request for a preference that
 * changes about twice per user, ever.
 */

const STORAGE_KEY = 'mir.locale';
const DEFAULT_LOCALE: UiLocale = 'ar';

interface LocaleContextValue {
  locale: UiLocale;
  dir: 'rtl' | 'ltr';
  setLocale: (next: UiLocale) => void;
  t: Dictionary;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [locale, setLocaleState] = useState<UiLocale>(DEFAULT_LOCALE);

  // Restore the stored preference after mount. Server and first client render
  // therefore agree on DEFAULT_LOCALE, which is what avoids a hydration
  // mismatch on a value the server cannot know.
  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const parsed = uiLocaleSchema.safeParse(stored);
    if (parsed.success) setLocaleState(parsed.data);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = UI_LOCALE_DIRECTION[locale];
  }, [locale]);

  const setLocale = useCallback((next: UiLocale) => {
    setLocaleState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }, []);

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, dir: UI_LOCALE_DIRECTION[locale], setLocale, t: DICTIONARIES[locale] }),
    [locale, setLocale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (ctx === null) throw new Error('useLocale must be used inside LocaleProvider');
  return ctx;
}

/** Shorthand for the common case of only needing strings. */
export function useT(): Dictionary {
  return useLocale().t;
}

/**
 * Format an instant in the user's locale.
 *
 * P10.1 is emphatic that timezone handling is explicit. Instants cross three
 * zones here — the scanner's, Tripoli, and Tunis — so the zone is always shown
 * rather than left for the reader to assume.
 */
const DATE_LOCALE: Record<UiLocale, string> = { ar: 'ar-LY', fr: 'fr-TN', en: 'en-GB' };

export function useDateFormat(): (value: Date | string) => string {
  const { locale } = useLocale();
  return useCallback(
    (value: Date | string) => {
      const date = typeof value === 'string' ? new Date(value) : value;
      if (Number.isNaN(date.getTime())) return '—';
      // Explicit components rather than dateStyle/timeStyle: the spec forbids
      // mixing the styles with timeZoneName, and compliant engines throw. The
      // zone stays visible — that requirement (P10.1) is the whole point.
      return new Intl.DateTimeFormat(DATE_LOCALE[locale], {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short',
      }).format(date);
    },
    [locale],
  );
}

/**
 * The locale that is safe to PERSIST.
 *
 * English is presentation-only: the user row and the consent terms table both
 * declare CHECK (locale IN ('ar','fr')), so a request carrying 'en' would be
 * rejected by Postgres. Admin screens therefore run in English while still
 * writing Arabic — the platform default — to content rows.
 */
export function useContentLocale(): Locale {
  const { locale } = useLocale();
  return isContentLocale(locale) ? locale : 'ar';
}
