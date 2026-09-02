-- Reverse of 0016_recurring_availability.up.sql.
--
-- Windows generated from a rule are withdrawn rather than deleted: the
-- application has no DELETE grant, and a window that was advertised should stay
-- on the record even once the rule that produced it is gone.

BEGIN;

UPDATE scheduling_availability SET withdrawn_at = now()
WHERE rule_id IS NOT NULL AND withdrawn_at IS NULL;

DROP FUNCTION IF EXISTS scheduling_materialise_rule(uuid, date);

DROP POLICY IF EXISTS availability_rules_assistant ON scheduling_availability_rules;
DROP POLICY IF EXISTS availability_rules_owner ON scheduling_availability_rules;

DROP INDEX IF EXISTS scheduling_availability_rule_instance_idx;
ALTER TABLE scheduling_availability DROP COLUMN rule_id;

DROP TABLE IF EXISTS scheduling_availability_rules;

ALTER TABLE scheduling_availability DROP COLUMN withdrawn_at;

COMMIT;
