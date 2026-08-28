import { describe, expect, it } from 'vitest';
import { LOCALES, LOCALE_DIRECTION } from './roles';
import {
  ADMIN_LOCALE,
  isContentLocale,
  UI_LOCALES,
  UI_LOCALE_DIRECTION,
  uiLocaleSchema,
} from './ui-locale';

describe('ui locales', () => {
  it('is a superset of the content locales, plus English for admin (§4.2)', () => {
    for (const locale of LOCALES) {
      expect(UI_LOCALES).toContain(locale);
    }
    expect(UI_LOCALES).toContain('en');
    expect(UI_LOCALES).toHaveLength(LOCALES.length + 1);
  });

  it('gives every UI locale a direction, agreeing with the content table', () => {
    for (const locale of LOCALES) {
      expect(UI_LOCALE_DIRECTION[locale]).toBe(LOCALE_DIRECTION[locale]);
    }
    expect(UI_LOCALE_DIRECTION.ar).toBe('rtl');
    expect(UI_LOCALE_DIRECTION.en).toBe('ltr');
  });

  it('accepts every UI locale and rejects anything else', () => {
    expect(uiLocaleSchema.parse('en')).toBe('en');
    expect(uiLocaleSchema.parse('ar')).toBe('ar');
    expect(() => uiLocaleSchema.parse('de')).toThrow();
  });

  it('distinguishes locales that may be persisted from ones that may not', () => {
    // The database CHECK constraint accepts only ar and fr. Writing 'en' to a
    // consent or user row would be rejected by Postgres, so the type guard is
    // the frontend's only defence against constructing that write.
    expect(isContentLocale('ar')).toBe(true);
    expect(isContentLocale('fr')).toBe(true);
    expect(isContentLocale(ADMIN_LOCALE)).toBe(false);
  });
});
