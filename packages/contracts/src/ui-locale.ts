import { z } from 'zod';
import { LOCALES, LOCALE_DIRECTION, type Locale } from './roles';

/**
 * UI locales — brief §4.2 (English for admin/internal use).
 *
 * WHY THIS IS NOT JUST `LOCALES + 'en'`.
 * `LOCALES` is mirrored by `CHECK (locale IN ('ar','fr'))` in two migrations:
 * the user row (0001_init) and the consent terms table (0003_consent_terms).
 * Adding English there would let the type system hand Postgres a value it
 * rejects at write time. So the content locale set stays exactly as the
 * database defines it, and the presentation set is DERIVED from it. The
 * superset relationship is structural — a content locale cannot be added
 * without appearing here too.
 */

/** English is internal-facing only: admin and ops, never provider content. */
export const ADMIN_LOCALE = 'en' as const;

export const UI_LOCALES = [...LOCALES, ADMIN_LOCALE] as const;
export const uiLocaleSchema = z.enum(UI_LOCALES);
export type UiLocale = z.infer<typeof uiLocaleSchema>;

/**
 * Direction for every UI locale. `LOCALE_DIRECTION` is left untouched because
 * the API and the Keycloak realm read it; this spreads it rather than
 * restating it, so the two tables cannot disagree about Arabic.
 */
export const UI_LOCALE_DIRECTION: Record<UiLocale, 'rtl' | 'ltr'> = {
  ...LOCALE_DIRECTION,
  [ADMIN_LOCALE]: 'ltr',
};

/**
 * Narrows a UI locale to one that may be persisted. Call this before sending a
 * locale to any endpoint that stores it.
 */
export function isContentLocale(locale: UiLocale): locale is Locale {
  return (LOCALES as readonly string[]).includes(locale);
}
