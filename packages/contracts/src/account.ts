import { z } from 'zod';
import { roleSchema } from './roles';
import { uiLocaleSchema } from './ui-locale';

/**
 * User accounts, profiles, and preferences — brief §5.1.
 *
 * WHAT THIS MODULE IS NOT. It holds no password, no password hash, and no
 * password policy. Keycloak owns credentials (ADR-2, P4.1); `passwordSchema`
 * below exists only so an obviously-too-short password is refused in the
 * browser instead of costing a round trip, and its minimum is a MIRROR of the
 * realm's `passwordPolicy`, never the authority for it. If the two ever
 * disagree, Keycloak wins and this constant is the bug.
 */

/**
 * E.164, as stored in `identity_users.phone_e164`.
 *
 * Required at registration and not optional, because `patients_claim_with_token`
 * (migration 0004) derives the claiming patient's phone number from this column.
 * An account with no phone would make that function unable to match a token to
 * a handset, which is the second factor the whole claim flow rests on.
 */
export const phoneE164Schema = z
  .string()
  .regex(/^\+[1-9]\d{7,14}$/, 'phone must be in E.164 form, e.g. +218911234567');

/**
 * The realm's minimum. Keycloak's `passwordPolicy` is the enforcement point;
 * this is the mirror, so the form can say so before submitting.
 */
export const PASSWORD_MIN_LENGTH = 12;

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(256);

/**
 * A six-digit code, same shape as the patient claim token (P5.2).
 *
 * Six digits is a million possibilities, which is only adequate alongside the
 * expiry, the attempt cap, and the `otpRequest` rate-limit budget. None of the
 * three is optional; see `identity_email_verifications`.
 */
export const verificationCodeSchema = z
  .string()
  .regex(/^\d{6}$/, 'code must be six digits');

export const VERIFICATION_PURPOSES = ['signup', 'email_change'] as const;
export const verificationPurposeSchema = z.enum(VERIFICATION_PURPOSES);
export type VerificationPurpose = z.infer<typeof verificationPurposeSchema>;

// ---------------------------------------------------------------------------
// Appearance
// ---------------------------------------------------------------------------

/**
 * `system` is a real value, not the absence of one.
 *
 * Storing null-for-system loses the difference between "follow my OS" and
 * "never asked", and those want different behaviour the day a default changes.
 */
export const THEMES = ['light', 'dark', 'system'] as const;
export const themeSchema = z.enum(THEMES);
export type Theme = z.infer<typeof themeSchema>;

export const DEFAULT_THEME: Theme = 'system';

// ---------------------------------------------------------------------------
// Profile and preferences
// ---------------------------------------------------------------------------

export const ACCOUNT_STATUSES = ['pending_verification', 'active', 'suspended'] as const;
export const accountStatusSchema = z.enum(ACCOUNT_STATUSES);
export type AccountStatus = z.infer<typeof accountStatusSchema>;

export const userProfileSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  fullName: z.string().min(1).max(200),
  phoneE164: phoneE164Schema,
  jobTitle: z.string().max(120).optional(),
  role: roleSchema,
  status: accountStatusSchema,
  emailVerified: z.boolean(),
  mfaEnrolled: z.boolean(),
  createdAt: z.string().datetime(),
});
export type UserProfile = z.infer<typeof userProfileSchema>;

/** The subset a user may change about themselves. Role and status are absent by design. */
export const updateProfileSchema = z.object({
  fullName: z.string().min(1).max(200).optional(),
  jobTitle: z.string().max(120).optional(),
  phoneE164: phoneE164Schema.optional(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/**
 * Notification channels — brief §5.6 P2 ("notification preferences per user").
 *
 * In-app is not listed as a togglable channel. §5.6 P0 makes case-level
 * notification a requirement, and the notification centre is where a provider
 * discovers a status change they must act on; letting someone switch that off
 * would let them silently opt out of the thing the platform exists to tell them.
 * Email and SMS are reminders about the centre, and those are theirs to refuse.
 */
export const notificationChannelsSchema = z.object({
  email: z.boolean(),
  sms: z.boolean(),
});
export type NotificationChannels = z.infer<typeof notificationChannelsSchema>;

export const userPreferencesSchema = z.object({
  theme: themeSchema,
  /**
   * A UI locale, not a content locale: English is presentation-only and must
   * never reach a `CHECK (locale IN ('ar','fr'))` column. The API narrows with
   * `isContentLocale` before writing anything a patient will read.
   */
  locale: uiLocaleSchema,
  /** IANA zone. Instants cross three zones here (P10.1), so it is never implicit. */
  timezone: z.string().min(1).max(64),
  notify: notificationChannelsSchema,
});
export type UserPreferences = z.infer<typeof userPreferencesSchema>;

export const DEFAULT_PREFERENCES: UserPreferences = {
  theme: DEFAULT_THEME,
  locale: 'ar',
  timezone: 'UTC',
  notify: { email: true, sms: true },
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * What `POST /auth/register` accepts.
 *
 * THERE IS NO ROLE FIELD, AND THERE MUST NEVER BE ONE. Every account created
 * here is an `applicant`; the clinical role is granted when ops approves the
 * organisation's verification. A role on this schema would be a stranger
 * asserting `libya_doctor` about themselves over the public internet.
 */
export const registrationSchema = z.object({
  fullName: z.string().min(1).max(200),
  email: z.string().email().max(254),
  password: passwordSchema,
  phoneE164: phoneE164Schema,
  locale: uiLocaleSchema,
});
export type RegistrationInput = z.infer<typeof registrationSchema>;

/**
 * How long a code is good for, and how many guesses it survives.
 *
 * Ten minutes is long enough for a slow mail relay and short enough that a
 * code left in an unattended inbox stops working. Five attempts against a
 * six-digit code leaves a 1-in-200,000 chance per issued code, and the
 * `otpRequest` budget bounds how many can be issued.
 */
export const VERIFICATION_CODE_TTL_MINUTES = 10;
export const VERIFICATION_MAX_ATTEMPTS = 5;
/** Client-side resend cooldown. The server's rate limit is the real control. */
export const VERIFICATION_RESEND_COOLDOWN_SECONDS = 60;
