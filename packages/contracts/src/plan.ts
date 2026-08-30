import { z } from 'zod';
import { moneySchema } from './ledger';

/**
 * Subscription tiers — brief §2 and §5.7.
 *
 * ⚠ ALL PRICES, LIMITS, AND TIER NAMES BELOW ARE PLACEHOLDERS. See
 * PLACEHOLDER_CATALOGUE at the bottom of this file. They exist so the screens
 * and the entitlement plumbing can be built and reviewed; every number is a
 * guess and must be replaced before anyone is shown it as a real offer.
 *
 * THREE THINGS THIS MODULE IS CAREFUL ABOUT:
 *
 * 1. **It does not touch the ledger's separation.** §5.7 P0 forbids merging
 *    coordination fees with subscription charges into one "amount owed", and
 *    `LedgerSummary` has no total field so the ambiguous line cannot be built.
 *    A plan's price is what a tier COSTS, never what an account OWES; nothing
 *    here sums against a ledger entry, and nothing should learn how.
 *
 * 2. **Copy is dictionary keys, not strings.** Same rule as
 *    `corridor.documentRequirements`: a tier that carried its own translated
 *    name would smuggle untranslatable copy past the §4.2 string catalogue and
 *    ship an Arabic user an English feature list.
 *
 * 3. **`null` means unlimited, and it is deliberate.** Encoding "unlimited" as
 *    a very large number means every comparison silently works and every
 *    display says "9,999 seats". A null forces each call site to decide what
 *    unlimited looks like.
 */

export const PLAN_CODES = ['solo', 'clinic', 'network'] as const;
export const planCodeSchema = z.enum(PLAN_CODES);
export type PlanCode = z.infer<typeof planCodeSchema>;

/** A dictionary key, matching the shape `fieldSpecSchema.labelKey` requires. */
const dictionaryKeySchema = z
  .string()
  .regex(/^[a-z][A-Za-z0-9]*$/, 'must be a dictionary key, not translated copy');

/**
 * Feature entitlements, as keys.
 *
 * A closed enum rather than free strings: the pricing table and the places
 * that GATE on an entitlement have to agree, and a typo that silently grants
 * nothing is the kind of bug nobody notices until a customer does.
 */
export const ENTITLEMENTS = [
  'prioritySupport',
  'csvExport',
  'auditTrailRetention',
  'multiCorridor',
  'dedicatedOnboarding',
] as const;
export const entitlementSchema = z.enum(ENTITLEMENTS);
export type Entitlement = z.infer<typeof entitlementSchema>;

export const planTierSchema = z.object({
  code: planCodeSchema,
  labelKey: dictionaryKeySchema,
  blurbKey: dictionaryKeySchema,
  /**
   * `null` means "priced on application" — a real tier state, not a missing
   * value. The pricing page renders a contact action rather than a number.
   */
  priceMonthly: moneySchema.nullable(),
  /** `null` = unlimited. */
  seatLimit: z.number().int().positive().nullable(),
  /** `null` = unlimited. Cases submitted per billing period. */
  monthlyCaseLimit: z.number().int().positive().nullable(),
  entitlements: z.array(entitlementSchema),
  /** Display order on the pricing table. Lowest first. */
  sort: z.number().int().nonnegative(),
});
export type PlanTier = z.infer<typeof planTierSchema>;

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

/**
 * `past_due` exists even though nothing charges a card yet.
 *
 * BLOCKING ITEM L7 is unresolved — whether a Libyan payer can lawfully pay a
 * Tunisian-facing platform, and where the receiving entity must be
 * incorporated. Until it is answered, changing a plan records INTENT and takes
 * no money (see migration 0007's header, which makes the same commitment about
 * the payments schema). The status is modelled now so that wiring a rail later
 * is a service change rather than a migration against live subscriptions.
 */
export const SUBSCRIPTION_STATUSES = ['trialing', 'active', 'past_due', 'cancelled'] as const;
export const subscriptionStatusSchema = z.enum(SUBSCRIPTION_STATUSES);
export type SubscriptionStatus = z.infer<typeof subscriptionStatusSchema>;

export const subscriptionSchema = z
  .object({
    id: z.string().uuid(),
    organisationId: z.string().min(1),
    planCode: planCodeSchema,
    status: subscriptionStatusSchema,
    /** Seats PAID FOR, which is not the same as seats filled. */
    seats: z.number().int().positive(),
    periodStart: z.string().datetime(),
    periodEnd: z.string().datetime(),
  })
  .refine((s) => s.periodEnd > s.periodStart, {
    message: 'a billing period must end after it starts',
    path: ['periodEnd'],
  });
export type Subscription = z.infer<typeof subscriptionSchema>;

/** What a settings screen needs to render usage without a second round trip. */
export interface PlanUsage {
  seatsUsed: number;
  casesThisPeriod: number;
}

// ---------------------------------------------------------------------------
// Predicates — one place each, so two screens cannot disagree
// ---------------------------------------------------------------------------

/** `null` limit is unlimited, so it is always within. */
export function withinLimit(used: number, limit: number | null): boolean {
  return limit === null || used < limit;
}

/**
 * How full a limit is, 0..1, or `null` when there is no limit to be full of.
 * A meter has nothing to render for an unlimited allowance, and drawing an
 * empty bar implies a ceiling that does not exist.
 */
export function usageRatio(used: number, limit: number | null): number | null {
  if (limit === null || limit <= 0) return null;
  return Math.min(used / limit, 1);
}

export function hasEntitlement(tier: PlanTier, entitlement: Entitlement): boolean {
  return tier.entitlements.includes(entitlement);
}

export function findTier(tiers: readonly PlanTier[], code: PlanCode): PlanTier | null {
  return tiers.find((t) => t.code === code) ?? null;
}

// ---------------------------------------------------------------------------
// PLACEHOLDER CATALOGUE
// ---------------------------------------------------------------------------

/**
 * TODO(pricing): every value in this object is invented.
 *
 * Replace the amounts, the seat and case limits, and the entitlement
 * assignments with the real commercial terms. The corresponding copy lives
 * under the `plan*` keys in apps/web/lib/i18n/dictionary.ts and is marked with
 * the same TODO.
 *
 * Amounts are MINOR UNITS. USD has an exponent of 2, so 4900 is $49.00 — but
 * do not carry that assumption to a dinar tier: TND and LYD have an exponent
 * of 3 (`CURRENCY_MINOR_UNITS`), and `toMajorUnits` is the only correct way to
 * divide.
 */
export const PLACEHOLDER_CATALOGUE: readonly PlanTier[] = [
  {
    code: 'solo',
    labelKey: 'planSoloName',
    blurbKey: 'planSoloBlurb',
    priceMonthly: { amountMinor: 4900, currency: 'USD' },
    seatLimit: 1,
    monthlyCaseLimit: 10,
    entitlements: ['csvExport'],
    sort: 0,
  },
  {
    code: 'clinic',
    labelKey: 'planClinicName',
    blurbKey: 'planClinicBlurb',
    priceMonthly: { amountMinor: 19900, currency: 'USD' },
    seatLimit: 10,
    monthlyCaseLimit: 100,
    entitlements: ['csvExport', 'prioritySupport', 'auditTrailRetention'],
    sort: 1,
  },
  {
    code: 'network',
    labelKey: 'planNetworkName',
    blurbKey: 'planNetworkBlurb',
    priceMonthly: null,
    seatLimit: null,
    monthlyCaseLimit: null,
    entitlements: [
      'csvExport',
      'prioritySupport',
      'auditTrailRetention',
      'multiCorridor',
      'dedicatedOnboarding',
    ],
    sort: 2,
  },
];
