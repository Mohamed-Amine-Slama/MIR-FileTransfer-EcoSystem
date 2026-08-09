import { z } from 'zod';

/**
 * The four roles from BUILD_SPEC P3.1. This list is the single source of truth
 * shared by the API, the web app, the Keycloak realm config, and the database
 * CHECK constraint. Adding a role means changing this, the realm, and a
 * migration — deliberately awkward, because a new role is a new access path.
 */
export const ROLES = ['libya_doctor', 'tunisia_doctor', 'patient', 'admin'] as const;

export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

/** Roles that must have TOTP enrolled before login completes (P4.3). */
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
