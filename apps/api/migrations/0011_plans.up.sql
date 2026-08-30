-- Brief §2 and §5.7 — subscription tiers.
--
-- ⚠ EVERY SEEDED PRICE AND LIMIT BELOW IS A PLACEHOLDER. They mirror
-- PLACEHOLDER_CATALOGUE in packages/contracts/src/plan.ts and exist so the
-- pricing page and the entitlement plumbing can be built and reviewed. Replace
-- them with real commercial terms before anyone is shown them as an offer.
--
-- TWO CONSTRAINTS THIS SCHEMA IS BUILT AROUND.
--
-- 1. **It takes no money.** BLOCKING ITEM L7 is unresolved: whether a Libyan
--    payer can lawfully and practically pay a Tunisian-facing platform, and in
--    which jurisdiction the receiving entity must be incorporated. Migration
--    0007 says the payments schema "does not assume an answer", and neither
--    does this one. Changing a plan records INTENT; there is no rail, no
--    provider id, and no card. `past_due` is modelled so that wiring one later
--    is a service change rather than a migration against live subscriptions.
--
-- 2. **It cannot produce an "amount owed".** §5.7 P0 forbids merging
--    coordination fees with subscription charges into one ambiguous total, and
--    `LedgerEntry` enforces that with a union that has no common amount field.
--    A subscription here carries what a TIER COSTS. It has no balance column,
--    no link to a ledger entry, and nothing that invites summing the two.

BEGIN;

-- ---------------------------------------------------------------------------
-- The catalogue.
--
-- A table rather than a constant, because ops changes prices and a price change
-- must not be a deploy. `code` is the primary key so a subscription references
-- a stable identifier rather than a row that could be re-created.
-- ---------------------------------------------------------------------------
CREATE TABLE billing_plans (
  code                text PRIMARY KEY CHECK (code IN ('solo','clinic','network')),
  active              boolean NOT NULL DEFAULT true,

  -- NULL means "priced on application" — a real tier state, not a missing
  -- value. The pricing page renders a contact action instead of a number.
  -- Minor units, as everywhere: money is never a float (§6), and the exponent
  -- is per-currency (TND and LYD are 3, not 2 — see CURRENCY_MINOR_UNITS).
  price_minor         bigint CHECK (price_minor IS NULL OR price_minor >= 0),
  currency            text CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),

  -- NULL means unlimited. Encoding that as a very large number would make every
  -- comparison silently work and every display read "9999 seats".
  seat_limit          integer CHECK (seat_limit IS NULL OR seat_limit > 0),
  monthly_case_limit  integer CHECK (monthly_case_limit IS NULL OR monthly_case_limit > 0),

  -- Entitlement keys, validated against the contract's closed enum in the
  -- application. Stored as an array so adding one is a data change.
  entitlements        text[] NOT NULL DEFAULT '{}',

  sort                integer NOT NULL DEFAULT 0,
  updated_at          timestamptz NOT NULL DEFAULT now(),

  -- A price is an amount AND a currency or neither. One without the other is
  -- a number nobody can render.
  CONSTRAINT plans_price_is_complete
    CHECK ((price_minor IS NULL) = (currency IS NULL))
);

INSERT INTO billing_plans (code, price_minor, currency, seat_limit, monthly_case_limit, entitlements, sort)
VALUES
  ('solo',      4900, 'USD',    1,   10, ARRAY['csvExport'], 0),
  ('clinic',   19900, 'USD',   10,  100, ARRAY['csvExport','prioritySupport','auditTrailRetention'], 1),
  ('network',   NULL,  NULL, NULL, NULL,
     ARRAY['csvExport','prioritySupport','auditTrailRetention','multiCorridor','dedicatedOnboarding'], 2);

-- ---------------------------------------------------------------------------
-- Subscriptions.
--
-- One per organisation, enforced by the primary key rather than by convention:
-- two active subscriptions for one clinic is a billing dispute nobody can
-- settle from the data.
-- ---------------------------------------------------------------------------
CREATE TABLE billing_subscriptions (
  organisation_id  uuid PRIMARY KEY REFERENCES identity_organisations(id),
  plan_code        text NOT NULL REFERENCES billing_plans(code),

  status           text NOT NULL DEFAULT 'trialing'
                     CHECK (status IN ('trialing','active','past_due','cancelled')),

  -- Seats PAID FOR, which is not the same as seats filled. The filled count is
  -- derived from identity_memberships; storing it here would create a second
  -- source of truth that drifts the first time someone is removed.
  seats            integer NOT NULL DEFAULT 1 CHECK (seats >= 1),

  period_start     timestamptz NOT NULL DEFAULT now(),
  period_end       timestamptz NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT subscriptions_period_ordered CHECK (period_end > period_start)
);

-- ---------------------------------------------------------------------------
-- Access control.
--
-- The CATALOGUE IS WORLD-READABLE to any authenticated caller, and the pricing
-- page is public — so the endpoint that serves it is marked @PublicEndpoint and
-- reads through a definer function rather than this policy. A price list is
-- marketing material; there is nothing to protect in it.
--
-- A SUBSCRIPTION is the organisation's. Ops reads all of them (§5.8 ledger
-- oversight). Only an owner changes one, because changing a plan is a
-- commitment on behalf of the practice.
-- ---------------------------------------------------------------------------
ALTER TABLE billing_plans         ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_plans         FORCE  ROW LEVEL SECURITY;
ALTER TABLE billing_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_subscriptions FORCE  ROW LEVEL SECURITY;

CREATE POLICY plans_readable ON billing_plans FOR SELECT
  USING (app_current_role() IS NOT NULL);

CREATE POLICY subscriptions_member ON billing_subscriptions FOR SELECT
  USING (app_member_of(organisation_id));

CREATE POLICY subscriptions_ops ON billing_subscriptions FOR SELECT
  USING (app_current_role() = 'admin');

CREATE POLICY subscriptions_owner_insert ON billing_subscriptions FOR INSERT
  WITH CHECK (app_owns_org(organisation_id));

CREATE POLICY subscriptions_owner_update ON billing_subscriptions FOR UPDATE
  USING (app_owns_org(organisation_id))
  WITH CHECK (app_owns_org(organisation_id));

-- ---------------------------------------------------------------------------
-- The public catalogue read.
--
-- `/pricing` is served to visitors who have no session at all, so there is no
-- RLS context for the policy above to evaluate. This function returns the
-- catalogue and nothing else — no subscription, no organisation, no count of
-- who is on which tier.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION billing_public_plans()
RETURNS TABLE (
  code text,
  price_minor bigint,
  currency text,
  seat_limit integer,
  monthly_case_limit integer,
  entitlements text[],
  sort integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT p.code, p.price_minor, p.currency, p.seat_limit, p.monthly_case_limit,
         p.entitlements, p.sort
  FROM billing_plans p
  WHERE p.active
  ORDER BY p.sort;
$$;

GRANT SELECT ON billing_plans TO mir_app;
GRANT SELECT, INSERT, UPDATE ON billing_subscriptions TO mir_app;
GRANT EXECUTE ON FUNCTION billing_public_plans() TO mir_app;

COMMIT;
