import { describe, expect, it } from 'vitest';
import { UI_LOCALES } from '@mir/contracts';
import { DICTIONARIES, LOCALE_NAMES } from './dictionary';

describe('dictionaries', () => {
  it('ships one dictionary per UI locale, including English for admin (§4.2)', () => {
    for (const locale of UI_LOCALES) {
      expect(DICTIONARIES[locale]).toBeDefined();
    }
    expect(DICTIONARIES.en).toBeDefined();
  });

  it('gives every locale exactly the same keys, so none can ship half-translated', () => {
    const reference = Object.keys(DICTIONARIES.ar).sort();
    for (const locale of UI_LOCALES) {
      expect(Object.keys(DICTIONARIES[locale]).sort()).toEqual(reference);
    }
  });

  it('leaves no value empty', () => {
    for (const locale of UI_LOCALES) {
      for (const [key, value] of Object.entries(DICTIONARIES[locale])) {
        expect(value, `${locale}.${key}`).not.toBe('');
      }
    }
  });

  it('names every locale in its own language, for the language switcher', () => {
    for (const locale of UI_LOCALES) {
      expect(LOCALE_NAMES[locale]).toBeTruthy();
    }
    expect(LOCALE_NAMES.en).toBe('English');
  });
});
