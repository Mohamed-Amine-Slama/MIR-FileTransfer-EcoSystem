import { z } from 'zod';

/**
 * The roles from BUILD_SPEC P3.1, plus `applicant`. This list is the single
 * source of truth shared by the API, the web app, the Keycloak realm config,
 * and the database CHECK constraint. Adding a role means changing this, the
 * realm, and a migration — deliberately awkward, because a new role is a new
 * access path.
 *
 * WHY `applicant` EXISTS.
 * Brief §5.1 P0 requires an organisation to see its verification decision
 * "with no need to contact the platform team", which means the applicant must
 * be able to sign in BEFORE anyone has approved them. The alternative designs
 * are both worse: granting a clinical role at sign-up would let a stranger
 * assert `libya_doctor` about themselves, and an unauthenticated status page
 * keyed by some reference would be an oracle for which clinics have applied.
 *
 * It is safe because it is granted NOTHING. No row-level security policy names
 * `applicant`, so every policy evaluates false and every query returns zero
 * rows — the account is fail-closed by construction rather than by a reviewer
 * remembering to restrict it. The clinical role is assigned only when ops
 * approves the verification.
 */
export const ROLES = ['libya_doctor', 'tunisia_doctor', 'patient', 'admin', 'applicant'] as const;

export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

/**
 * Roles that must have TOTP enrolled before login completes (P4.3).
 *
 * `applicant` is absent on purpose. Requiring a second factor to read one's own
 * "pending review" screen would block the exact person §5.1 says must not need
 * to phone anyone — and the account can reach no patient data to protect. TOTP
 * enrolment is required at the moment the clinical role is granted, which is
 * where it starts guarding something.
 */
export const CLINICAL_ROLES: readonly Role[] = ['libya_doctor', 'tunisia_doctor', 'admin'];

export function isClinicalRole(role: Role): boolean {
  return CLINICAL_ROLES.includes(role);
}

/**
 * Locales for v1, per DECISION D4. Arabic and French only, RTL from day one.
 * `dir` is carried alongside the code so the frontend never has to infer
 * direction from a language tag.
 */
export const LOCALES = ['ar', 'fr'] as const;
export const localeSchema = z.enum(LOCALES);
export type Locale = z.infer<typeof localeSchema>;

export const LOCALE_DIRECTION: Record<Locale, 'rtl' | 'ltr'> = {
  ar: 'rtl',
  fr: 'ltr',
};
