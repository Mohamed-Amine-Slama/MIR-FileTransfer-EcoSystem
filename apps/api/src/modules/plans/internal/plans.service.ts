import { Injectable, NotFoundException } from '@nestjs/common';
import {
  entitlementSchema,
  planCodeSchema,
  type Entitlement,
  type PlanCode,
  type PlanTier,
  type PlanUsage,
  type Subscription,
} from '@mir/contracts';
import { requireContext } from '../../../shared/context/request-context';
import { DatabaseService } from '../../../shared/db/database.service';

/**
 * Subscription tiers — brief §2, §5.7.
 *
 * ⚠ THE SEEDED CATALOGUE IS PLACEHOLDER DATA. See migration 0011 and
 * PLACEHOLDER_CATALOGUE in the contract.
 *
 * NOTHING HERE TAKES MONEY. Blocking item L7 is unresolved — whether a Libyan
 * payer can lawfully pay a Tunisian-facing platform, and where the receiving
 * entity must be incorporated. Changing a plan records intent. There is no rail
 * and no card, and `changePlan` says so rather than implying a charge happened.
 *
 * NOTHING HERE PRODUCES A TOTAL. §5.7 P0 forbids merging coordination fees with
 * subscription charges into one ambiguous "amount owed", which `LedgerEntry`
 * enforces by having no common amount field. A tier's price is what it COSTS;
 * this service never reads a ledger entry and must not learn how.
 */

interface DbPlan {
  code: string;
  price_minor: string | null;
  currency: string | null;
  seat_limit: number | null;
  monthly_case_limit: number | null;
  entitlements: string[];
  sort: number;
}

/** Dictionary keys, derived from the code — copy never lives in the database (§4.2). */
function labelKeys(code: PlanCode): { labelKey: string; blurbKey: string } {
  const capitalised = code.charAt(0).toUpperCase() + code.slice(1);
  return { labelKey: `plan${capitalised}Name`, blurbKey: `plan${capitalised}Blurb` };
}

function toTier(row: DbPlan): PlanTier | null {
  const code = planCodeSchema.safeParse(row.code);
  if (!code.success) return null;

  // An entitlement the contract does not know about is DROPPED, not passed
  // through. The pricing table and the places that gate on an entitlement have
  // to agree; a string that reaches the UI and matches nothing would render as
  // a feature nobody can explain.
  const entitlements = row.entitlements
    .map((e) => entitlementSchema.safeParse(e))
    .filter((r): r is { success: true; data: Entitlement } => r.success)
    .map((r) => r.data);

  const { labelKey, blurbKey } = labelKeys(code.data);
  return {
    code: code.data,
    labelKey,
    blurbKey,
    priceMonthly:
      row.price_minor === null || row.currency === null
        ? null
        : // bigint arrives as a string from pg; Number is exact well past any
          // plausible monthly price in minor units.
          { amountMinor: Number(row.price_minor), currency: row.currency as never },
    seatLimit: row.seat_limit,
    monthlyCaseLimit: row.monthly_case_limit,
    entitlements,
    sort: row.sort,
  };
}

@Injectable()
export class PlansService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * The public catalogue.
   *
   * Read through `billing_public_plans()` because `/pricing` is served to
   * visitors with no session at all, so there is no RLS context for the
   * table's policy to evaluate. The function returns the catalogue and nothing
   * else — no subscription, no organisation, no count of who is on which tier.
   */
  async catalogue(): Promise<PlanTier[]> {
    return this.db.txAs(
      {
        userId: '00000000-0000-7000-8000-000000000000',
        // Granted nothing by any policy; the definer function is all that runs.
        role: 'applicant',
        triageBeforePayment: false,
        ipAddress: undefined,
        userAgent: 'public-pricing',
        requestId: 'public-pricing',
      },
      async (tx) => {
        const res = await tx.query<DbPlan>('SELECT * FROM billing_public_plans()');
        return res.rows
          .map(toTier)
          .filter((tier): tier is PlanTier => tier !== null)
          .sort((a, b) => a.sort - b.sort);
      },
    );
  }

  /**
   * The caller's subscription and what it is using.
   *
   * `seatsUsed` is COUNTED from memberships rather than stored on the
   * subscription. A stored count is a second source of truth that drifts the
   * first time somebody is removed, and it drifts silently in the direction of
   * "you are out of seats".
   */
  async mine(): Promise<{
    subscription: Subscription | null;
    usage: PlanUsage;
  }> {
    return this.db.tx(async (tx) => {
      // `subscriptions_member` scopes this to the caller's own organisation.
      const res = await tx.query<{
        organisation_id: string;
        plan_code: string;
        status: string;
        seats: number;
        period_start: Date;
        period_end: Date;
        id: string;
      }>(
        `SELECT organisation_id, organisation_id AS id, plan_code, status, seats,
                period_start, period_end
         FROM billing_subscriptions LIMIT 1`,
      );
      const row = res.rows[0];

      const seats = await tx.query<{ count: string }>(
        'SELECT count(*) AS count FROM identity_memberships',
      );

      const usage: PlanUsage = {
        seatsUsed: Number(seats.rows[0]?.count ?? 0),
        // The case layer has no API yet (see docs/frontend-brief-audit.md), so
        // there is nothing to count. Reported as 0 rather than omitted: the
        // meter renders, and it will start moving the day cases are real.
        casesThisPeriod: 0,
      };

      if (row === undefined) return { subscription: null, usage };

      const code = planCodeSchema.safeParse(row.plan_code);
      if (!code.success) return { subscription: null, usage };

      return {
        subscription: {
          id: row.id,
          organisationId: row.organisation_id,
          planCode: code.data,
          status: row.status as Subscription['status'],
          seats: row.seats,
          periodStart: row.period_start.toISOString(),
          periodEnd: row.period_end.toISOString(),
        },
        usage,
      };
    });
  }

  /**
   * Record an intent to be on a tier.
   *
   * NOT A PURCHASE. No rail is wired (L7), so this writes a row and takes
   * nothing. The screen says so; this comment exists so a future reader does
   * not assume the charge is happening somewhere they have not looked.
   *
   * Writes are refused by `subscriptions_owner_*` unless the caller owns the
   * organisation, so ownership is not re-checked here.
   */
  async changePlan(planCode: PlanCode): Promise<void> {
    const ctx = requireContext();
    await this.db.tx(async (tx) => {
      const org = await tx.query<{ organisation_id: string }>(
        'SELECT organisation_id FROM identity_memberships WHERE user_id = $1 LIMIT 1',
        [ctx.userId],
      );
      const organisationId = org.rows[0]?.organisation_id;
      if (organisationId === undefined) throw new NotFoundException('organisation_not_found');

      await tx.query(
        `INSERT INTO billing_subscriptions
           (organisation_id, plan_code, status, seats, period_start, period_end)
         VALUES ($1, $2, 'trialing', 1, now(), now() + interval '1 month')
         ON CONFLICT (organisation_id) DO UPDATE
         SET plan_code = EXCLUDED.plan_code, updated_at = now()`,
        [organisationId, planCode],
      );
    });
  }
}
