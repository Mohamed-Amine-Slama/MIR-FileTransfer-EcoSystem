import { z } from 'zod';

/**
 * Validated application configuration (BUILD_SPEC P1.6).
 *
 * The app refuses to boot on missing or invalid config. The alternative —
 * booting with `undefined` and discovering it at request time — means a
 * misconfigured deployment can serve traffic while, say, pointing at the wrong
 * S3 bucket or skipping token audience validation. Fail at boot, loudly.
 *
 * Values arrive as environment variables. In deployed environments those are
 * injected from AWS Secrets Manager (BUILD_SPEC §6); nothing here is read from
 * a committed file. `.env` is for local development only and is gitignored.
 *
 * Anything a lawyer might later change is configuration, not a constant —
 * retention periods (L5) and the consent/payment windows especially, so legal
 * answers can be applied without a code change (§2).
 */

const nonEmpty = (label: string) => z.string().min(1, `${label} must not be empty`);

/** Accepts "true"/"false"/"1"/"0"; rejects anything ambiguous rather than guessing. */
const boolFromEnv = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const intFromEnv = (label: string, min: number, max: number) =>
  z
    .string()
    .regex(/^\d+$/, `${label} must be a whole number`)
    .transform(Number)
    .refine((n) => n >= min && n <= max, `${label} must be between ${min} and ${max}`);

export const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']),
  PORT: intFromEnv('PORT', 1, 65535).prefault('3000'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // --- database ------------------------------------------------------------
  // Must be the non-superuser application role. It must NOT have BYPASSRLS
  // (ADR-6, P3.2). There is deliberately no second "admin" connection string:
  // an admin bypass connection defeats the entire second layer of defence
  // (§17 anti-patterns).
  DATABASE_URL: nonEmpty('DATABASE_URL').refine(
    (v) => v.startsWith('postgres://') || v.startsWith('postgresql://'),
    'DATABASE_URL must be a postgres:// or postgresql:// connection string',
  ),
  DATABASE_POOL_MAX: intFromEnv('DATABASE_POOL_MAX', 1, 200).prefault('10'),

  // --- cache / queue -------------------------------------------------------
  REDIS_URL: nonEmpty('REDIS_URL').refine(
    (v) => v.startsWith('redis://') || v.startsWith('rediss://'),
    'REDIS_URL must be a redis:// or rediss:// connection string',
  ),

  // --- observability (P13) -------------------------------------------------
  // OPTIONAL by design. Unset means spans are built and dropped rather than
  // exported, so a developer with no collector running is not blocked and a
  // deployment with no endpoint configured degrades to silence instead of
  // failing every request on a dead exporter. The trade is that a missing
  // endpoint in production is invisible; alerting on span volume is the
  // detection for that, and it is not built (P4.5 has no delivery channel).
  OTEL_EXPORTER_OTLP_ENDPOINT: z
    .string()
    .url('OTEL_EXPORTER_OTLP_ENDPOINT must be a URL')
    .optional(),

  // --- identity (P4.1) -----------------------------------------------------
  KEYCLOAK_ISSUER_URL: z.string().url('KEYCLOAK_ISSUER_URL must be a URL'),
  KEYCLOAK_AUDIENCE: nonEmpty('KEYCLOAK_AUDIENCE'),
  KEYCLOAK_JWKS_URL: z.string().url('KEYCLOAK_JWKS_URL must be a URL'),

  // --- object storage (P2.4) ----------------------------------------------
  AWS_REGION: nonEmpty('AWS_REGION'),
  S3_BUCKET_ORIGINALS: nonEmpty('S3_BUCKET_ORIGINALS'),
  S3_BUCKET_DERIVED: nonEmpty('S3_BUCKET_DERIVED'),
  S3_BUCKET_AUDIT_LOGS: nonEmpty('S3_BUCKET_AUDIT_LOGS'),

  // --- local storage (development only) ------------------------------------
  // Root directory for the filesystem BlobStore. Ignored outside development:
  // StorageModule refuses to start in staging or production without a real
  // S3-backed store, because originals on a container filesystem are one
  // restart away from being lost (ADR-4, P2.4).
  LOCAL_STORAGE_ROOT: z.string().optional(),

  // --- DICOM server (P8.1) -------------------------------------------------
  ORTHANC_URL: z.string().url('ORTHANC_URL must be a URL'),
  ORTHANC_USERNAME: nonEmpty('ORTHANC_USERNAME'),
  ORTHANC_PASSWORD: nonEmpty('ORTHANC_PASSWORD'),

  // --- upload (P7.2) -------------------------------------------------------
  UPLOAD_CHUNK_SIZE_BYTES: intFromEnv('UPLOAD_CHUNK_SIZE_BYTES', 256 * 1024, 64 * 1024 * 1024)
    .prefault(String(5 * 1024 * 1024)),
  UPLOAD_SESSION_TTL_HOURS: intFromEnv('UPLOAD_SESSION_TTL_HOURS', 1, 720).prefault('72'),

  // --- signed URLs (P8.2) --------------------------------------------------
  // Spec requires 5-15 minutes. The bounds are enforced here so a deployment
  // cannot quietly widen the window to hours.
  SIGNED_URL_TTL_SECONDS: intFromEnv('SIGNED_URL_TTL_SECONDS', 300, 900).prefault('600'),
  // Dedicated key for URL signing. Separate from any session secret so the two
  // can be rotated independently — rotating session keys must not silently
  // invalidate every in-flight image request, and vice versa.
  SIGNED_URL_SECRET: z
    .string()
    .min(32, 'SIGNED_URL_SECRET must be at least 32 characters'),

  // --- scheduling (DECISION D3) -------------------------------------------
  // Default OFF: the Tunisian doctor sees imaging only after payment succeeds.
  // Consent is required in BOTH modes; this toggle never bypasses consent.
  SCHEDULING_TRIAGE_BEFORE_PAYMENT: boolFromEnv.prefault('false'),

  // --- billing (DECISION D2) ----------------------------------------------
  // Authorise at booking, capture on acceptance. An authorisation that is
  // never captured must expire and release the slot.
  PAYMENT_AUTHORIZATION_WINDOW_HOURS: intFromEnv(
    'PAYMENT_AUTHORIZATION_WINDOW_HOURS',
    1,
    720,
  ).prefault('72'),

  // --- billing (DECISION D2a: Stripe) -------------------------------------
  // Secret key and webhook secret come from AWS Secrets Manager (§6) and are
  // never in the bundle — scripts/check-bundle-secrets.mjs fails the build if
  // either appears in client output.
  //
  // Optional so the app boots in development without a Stripe account; the
  // billing module refuses to authorise a payment when they are absent, rather
  // than failing at the moment a patient tries to pay.
  STRIPE_SECRET_KEY: z.string().startsWith('sk_').optional(),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith('whsec_').optional(),
  PAYMENT_CURRENCY: z.string().regex(/^[A-Z]{3}$/, 'PAYMENT_CURRENCY must be ISO-4217').default('TND'),

  // The consultation fee, in MINOR units of PAYMENT_CURRENCY (so 15000 = 150.00
  // TND). Minor units throughout, never a decimal: floating-point money is how
  // a rounding difference ends up between what the patient was shown and what
  // the card was charged.
  //
  // Config rather than a per-doctor column because v1 charges one price. When
  // doctors set their own fees this moves to the doctor profile, and the API
  // shape here does not have to change — the amount is already resolved
  // server-side, never sent by the client. A client-supplied amount would let
  // a patient authorise one dinar for a consultation.
  CONSULTATION_FEE_MINOR: intFromEnv('CONSULTATION_FEE_MINOR', 1, 100_000_000).prefault('15000'),

  // --- retention (BLOCKING L5) --------------------------------------------
  // These values are placeholders until counsel answers L5. They are config
  // precisely so the legal answer is a deployment change, not a rewrite.
  // Object Lock retention on the originals bucket must be set to match.
  IMAGING_RETENTION_DAYS: intFromEnv('IMAGING_RETENTION_DAYS', 1, 36_500).prefault('3650'),
  AUDIT_RETENTION_DAYS: intFromEnv('AUDIT_RETENTION_DAYS', 1, 36_500).prefault('3650'),

  // --- consent (BLOCKING L4) ----------------------------------------------
  CONSENT_TERMS_VERSION: nonEmpty('CONSENT_TERMS_VERSION').default('v1'),
});

export type AppConfig = z.infer<typeof configSchema>;

export class ConfigValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(
      `Invalid application configuration — refusing to start.\n\n` +
        issues.map((i) => `  - ${i}`).join('\n') +
        `\n\nSee .env.example for the full list of required variables.\n` +
        `In deployed environments these come from AWS Secrets Manager, not a file.`,
    );
    this.name = 'ConfigValidationError';
  }
}

/**
 * Parse and validate configuration.
 *
 * Reports EVERY problem at once. Reporting only the first turns fixing a fresh
 * environment into a guessing loop of boot-fail-fix-repeat.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = configSchema.safeParse(env);

  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const key = issue.path.join('.') || '(root)';
      return `${key}: ${issue.message}`;
    });
    throw new ConfigValidationError(issues);
  }

  return result.data;
}
