import { describe, expect, it } from 'vitest';
import {
  PLACEHOLDER_CATALOGUE,
  PLAN_CODES,
  findTier,
  hasEntitlement,
  planTierSchema,
  subscriptionSchema,
  usageRatio,
  withinLimit,
} from './plan';
import { toMajorUnits } from './ledger';

describe('the placeholder catalogue', () => {
  it('parses — a tier that cannot be validated cannot be rendered', () => {
    for (const tier of PLACEHOLDER_CATALOGUE) {
      expect(() => planTierSchema.parse(tier)).not.toThrow();
    }
  });

  it('covers every plan code exactly once', () => {
    expect(PLACEHOLDER_CATALOGUE.map((t) => t.code).sort()).toEqual([...PLAN_CODES].sort());
  });

  /**
   * §4.2: a tier carrying its own translated name would ship an Arabic user an
   * English feature list. The schema's regex enforces the shape; this asserts
   * nobody has smuggled a sentence through it.
   */
  it('names tiers by dictionary key, never by copy', () => {
    for (const tier of PLACEHOLDER_CATALOGUE) {
      expect(tier.labelKey).not.toContain(' ');
      expect(tier.blurbKey).not.toContain(' ');
    }
  });

  it('offers at least one priced-on-application tier', () => {
    expect(PLACEHOLDER_CATALOGUE.some((t) => t.priceMonthly === null)).toBe(true);
  });
});

describe('limits', () => {
  it('treats null as unlimited rather than as a very large number', () => {
    expect(withinLimit(1_000_000, null)).toBe(true);
    expect(withinLimit(9, 10)).toBe(true);
    expect(withinLimit(10, 10)).toBe(false);
  });

  it('has no ratio to draw for an unlimited allowance', () => {
    // A meter rendered at 0% implies a ceiling that does not exist.
    expect(usageRatio(42, null)).toBeNull();
    expect(usageRatio(5, 10)).toBe(0.5);
  });

  it('clamps an over-limit ratio rather than overflowing the meter', () => {
    expect(usageRatio(15, 10)).toBe(1);
  });
});

describe('entitlements and lookup', () => {
  it('answers from the tier, so two screens cannot disagree about a feature', () => {
    const clinic = findTier(PLACEHOLDER_CATALOGUE, 'clinic');
    expect(clinic).not.toBeNull();
    if (clinic === null) return;
    expect(hasEntitlement(clinic, 'prioritySupport')).toBe(true);
    expect(hasEntitlement(clinic, 'multiCorridor')).toBe(false);
  });

  it('returns null for an unknown tier rather than a partially-built object', () => {
    expect(findTier([], 'solo')).toBeNull();
  });
});

describe('subscriptions', () => {
  const valid = {
    id: '00000000-0000-4000-8000-000000000001',
    organisationId: 'org-1',
    planCode: 'clinic' as const,
    status: 'active' as const,
    seats: 10,
    periodStart: '2026-08-01T00:00:00.000Z',
    periodEnd: '2026-09-01T00:00:00.000Z',
  };

  it('refuses a period that ends before it starts', () => {
    expect(() => subscriptionSchema.parse(valid)).not.toThrow();
    expect(() =>
      subscriptionSchema.parse({ ...valid, periodEnd: '2026-07-01T00:00:00.000Z' }),
    ).toThrow();
  });
});

describe('money', () => {
  /**
   * §5.7 P0 forbids merging coordination fees with subscription charges into
   * one "amount owed". A plan's price is what a tier COSTS; nothing here may
   * grow a field that looks summable against a ledger entry.
   */
  it('carries no balance, total, or amount-owed field', () => {
    for (const tier of PLACEHOLDER_CATALOGUE) {
      expect(tier).not.toHaveProperty('total');
      expect(tier).not.toHaveProperty('balance');
      expect(tier).not.toHaveProperty('amountOwed');
    }
  });

  it('divides through toMajorUnits, which knows each currency exponent', () => {
    const solo = findTier(PLACEHOLDER_CATALOGUE, 'solo');
    expect(solo?.priceMonthly).not.toBeNull();
    if (solo?.priceMonthly == null) return;
    expect(toMajorUnits(solo.priceMonthly)).toBe(49);
    // The trap this guards: a dinar tier priced the same way. TND has an ISO
    // exponent of 3, so a hardcoded /100 would overstate it tenfold.
    expect(toMajorUnits({ amountMinor: 4900, currency: 'TND' })).toBe(4.9);
  });
});
