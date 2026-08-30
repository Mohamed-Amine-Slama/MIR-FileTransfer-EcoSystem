-- Reverse of 0011_plans.up.sql.

BEGIN;

DROP POLICY IF EXISTS subscriptions_owner_update ON billing_subscriptions;
DROP POLICY IF EXISTS subscriptions_owner_insert ON billing_subscriptions;
DROP POLICY IF EXISTS subscriptions_ops ON billing_subscriptions;
DROP POLICY IF EXISTS subscriptions_member ON billing_subscriptions;
DROP POLICY IF EXISTS plans_readable ON billing_plans;

REVOKE ALL ON billing_subscriptions, billing_plans FROM mir_app;

DROP FUNCTION IF EXISTS billing_public_plans();
DROP TABLE IF EXISTS billing_subscriptions;
DROP TABLE IF EXISTS billing_plans;

COMMIT;
