import type { UiLocale } from '@mir/contracts';

/**
 * A country's name, in the reader's language, from its ISO-3166 code.
 *
 * WHY NOT A DICTIONARY KEY. §4.3 forbids UI copy that assumes Libya and Tunisia
 * specifically, and `lib/corridor/no-hardcoded-corridor.test.ts` enforces it by
 * scanning for those words. Writing `countryLibya: 'ليبيا'` into the dictionary
 * would satisfy the letter of that test — the scan only covers `app/` and
 * `components/` — while breaking exactly what it protects: adding a corridor
 * would mean adding country strings in three languages, which is the sweep the
 * rule exists to prevent.
 *
 * `Intl.DisplayNames` already knows every country in every locale the platform
 * speaks. The corridor registry supplies the CODE, the platform supplies the
 * name, and a new corridor labels itself with no new copy at all.
 *
 * Falls back to the raw code. A two-letter code is a poor label but an honest
 * one, and it is better than a blank where a country should be.
 */
export function countryName(code: string, locale: UiLocale): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}
