/**
 * Patient identity matching — BUILD_SPEC P3.3.
 *
 * Two failure modes, and they are NOT symmetric:
 *
 *   Duplicate patient records    — annoying, visible, fixable by an admin.
 *   Two people merged into one   — catastrophic, invisible, and discovered
 *                                  when a doctor reads the wrong person's scan.
 *
 * Everything here is biased toward the first. When in doubt, create a second
 * record and make a human decide.
 *
 * WHY THERE IS NO NAME MATCHING AT ALL (§17):
 * Arabic/French/English transliteration across the Libya-Tunisia border is not
 * stable. محمد is Mohamed, Mohammed, Muhammad, Mohamad. A fuzzy matcher tuned
 * to catch those also merges genuinely different people who share a common
 * name and a birth year. There is no threshold that gets both right, so we do
 * not try: lookup is by phone number only.
 */

export interface PatientCandidate {
  id: string;
  fullName: string;
  dateOfBirth: string;
  phoneE164: string;
  sex: 'M' | 'F' | 'O';
}

export type MatchOutcome =
  | { kind: 'no_match' }
  | { kind: 'confirmation_required'; candidates: PatientCandidate[] };

/**
 * Decide what happens when a doctor tries to create a patient whose phone
 * number already exists.
 *
 * Never returns "matched — reuse this record" on its own authority. A phone
 * match is a prompt for a human, not a conclusion: shared handsets are common,
 * and numbers get recycled between people.
 */
export function evaluatePhoneMatch(existing: PatientCandidate[]): MatchOutcome {
  if (existing.length === 0) return { kind: 'no_match' };
  return { kind: 'confirmation_required', candidates: existing };
}

/** E.164: leading '+', country code 1-9, then up to 14 more digits. */
const E164 = /^\+[1-9]\d{7,14}$/;

export function isValidE164(phone: string): boolean {
  return E164.test(phone);
}

/**
 * Normalise a phone number for LOOKUP only.
 *
 * Strips spaces, dashes, parentheses and dots. Deliberately does NOT attempt
 * country-code inference: guessing that a 9-digit number is Libyan would
 * silently match a Tunisian patient with the same trailing digits.
 */
export function normalisePhoneForLookup(input: string): string {
  const trimmed = input.trim().replace(/[\s\-().]/g, '');
  return trimmed.startsWith('00') ? `+${trimmed.slice(2)}` : trimmed;
}

/**
 * The exact name the doctor typed, preserved verbatim.
 *
 * BUILD_SPEC P3.3 rule 4: store the transliteration variants the doctor
 * entered rather than normalising them away. The variant is itself clinical
 * evidence — it may be the only thing that distinguishes two records later,
 * and it is what appears on the paperwork the patient carries across the
 * border. Collapsing case or stripping diacritics destroys that.
 */
export function preserveEnteredName(input: string): string {
  // Collapse only runs of whitespace, which are typing artefacts rather than
  // meaningful variation. Nothing else is touched.
  return input.replace(/\s+/g, ' ').trim();
}
