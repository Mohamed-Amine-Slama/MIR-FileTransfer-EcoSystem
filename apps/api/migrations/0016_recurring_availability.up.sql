-- Recurring availability, and a way to take a window back down.
--
-- P10.1 asks for "recurring and one-off" availability; only one-off existed, so
-- a doctor with ordinary opening hours had to re-enter every week by hand.
--
-- WHY RULES MATERIALISE ROWS INSTEAD OF BEING EXPANDED AT QUERY TIME.
-- Expanding a rule inside listOpenSlots would give the system two
-- representations of "when is this doctor free" — concrete windows and rules —
-- and every consumer would have to consult both. The gist exclusion constraint
-- on scheduling_appointments works against concrete instants, and a doctor
-- needs to be able to close ONE Tuesday without abolishing every Tuesday. So a
-- rule generates rows, and the rows remain the single source of truth.
--
-- WHY THERE IS NO DELETE. 0002 grants the application SELECT, INSERT and UPDATE
-- and no DELETE on anything, deliberately. An availability window is not
-- patient data, so an exception could be argued — but "the application cannot
-- delete" is a property worth more than the convenience, and withdrawing a
-- window is better modelled as an event than an erasure anyway: if a patient
-- says the clinic advertised a Thursday slot, the answer should be in the
-- table. Withdrawal is therefore an UPDATE, and every read filters on it.

BEGIN;

-- ---------------------------------------------------------------------------
-- Withdrawal, for one-off windows and generated ones alike.
-- ---------------------------------------------------------------------------
ALTER TABLE scheduling_availability
  ADD COLUMN withdrawn_at timestamptz;

CREATE TABLE scheduling_availability_rules (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  doctor_id    uuid NOT NULL REFERENCES identity_users(id),

  -- ISO-8601 numbering: 1 = Monday .. 7 = Sunday, matching PostgreSQL's
  -- `isodow`. Deliberately not `dow` (0 = Sunday), whose Sunday-first week
  -- disagrees with both the ISO standard and every calendar this UI will draw.
  weekday      smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),

  -- LOCAL WALL-CLOCK PLUS A ZONE, never a timestamptz. "Every Tuesday at 09:00"
  -- is a statement about the clinic's clock: it must stay 09:00 in Tunis even
  -- if the offset ever changes. Storing the instant would freeze today's offset
  -- into next year's appointments.
  start_time   time NOT NULL,
  end_time     time NOT NULL,
  timezone     text NOT NULL,

  slot_minutes int  NOT NULL DEFAULT 30 CHECK (slot_minutes BETWEEN 5 AND 240),
  valid_from   date NOT NULL,
  valid_until  date,
  withdrawn_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),

  CHECK (end_time > start_time),
  CHECK (valid_until IS NULL OR valid_until >= valid_from)
);

CREATE INDEX scheduling_availability_rules_doctor_idx
  ON scheduling_availability_rules (doctor_id) WHERE withdrawn_at IS NULL;

-- Which rule produced a window, so regeneration is idempotent and withdrawing a
-- rule can withdraw its future windows in one statement.
ALTER TABLE scheduling_availability
  ADD COLUMN rule_id uuid REFERENCES scheduling_availability_rules(id);

CREATE UNIQUE INDEX scheduling_availability_rule_instance_idx
  ON scheduling_availability (rule_id, starts_at) WHERE rule_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Materialising a rule over a horizon.
--
-- SECURITY INVOKER — no DEFINER here on purpose. The INSERT runs as the caller
-- and is therefore subject to `availability_owner` and `availability_assistant`
-- exactly like a hand-entered window, so this function grants nobody the
-- ability to write into a calendar they could not already write into.
--
-- ON CONFLICT DO NOTHING against the (rule_id, starts_at) index makes repeated
-- runs free, which is what lets a nightly job simply re-run over the horizon
-- rather than track what it generated last time.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION scheduling_materialise_rule(p_rule uuid, p_until date)
RETURNS integer
LANGUAGE plpgsql VOLATILE SET search_path = public, pg_temp
AS $$
DECLARE
  r        scheduling_availability_rules%ROWTYPE;
  v_count  integer := 0;
  v_horizon date;
BEGIN
  SELECT * INTO r FROM scheduling_availability_rules
  WHERE id = p_rule AND withdrawn_at IS NULL;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  v_horizon := LEAST(p_until, COALESCE(r.valid_until, p_until));

  --
  -- `d::date` IS LOAD-BEARING, not tidiness. generate_series over two dates
  -- resolves to the timestamptz overload, so `d` arrives as an instant — and
  -- `timestamptz AT TIME ZONE zone` is the OPPOSITE operation to the one wanted
  -- here: it renders an instant as local wall-clock, which then gets cast back
  -- to timestamptz using the server's zone. The offset is applied twice, in
  -- opposite directions, and 09:00 in Tunis is stored as 10:00 UTC instead of
  -- 08:00. Casting back to `date` first makes `date + time` a plain timestamp,
  -- which is what `AT TIME ZONE` interprets as local and converts to an instant.
  INSERT INTO scheduling_availability (doctor_id, starts_at, ends_at, slot_minutes, rule_id)
  SELECT r.doctor_id,
         (d::date + r.start_time) AT TIME ZONE r.timezone,
         (d::date + r.end_time)   AT TIME ZONE r.timezone,
         r.slot_minutes,
         r.id
  FROM generate_series(GREATEST(r.valid_from, CURRENT_DATE), v_horizon, interval '1 day') AS d
  WHERE EXTRACT(isodow FROM d::date) = r.weekday
  ON CONFLICT (rule_id, starts_at) WHERE rule_id IS NOT NULL DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- Access. Identical in shape to the windows the rules generate: the doctor owns
-- theirs, their assistant may operate it, nobody else sees it. Rules are not
-- bookable by patients — what a patient books is a generated WINDOW.
-- ---------------------------------------------------------------------------
ALTER TABLE scheduling_availability_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduling_availability_rules FORCE  ROW LEVEL SECURITY;

CREATE POLICY availability_rules_owner ON scheduling_availability_rules FOR ALL
  USING (
    app_current_role() IN ('libya_doctor','tunisia_doctor')
    AND doctor_id = app_current_user_id()
  )
  WITH CHECK (
    app_current_role() IN ('libya_doctor','tunisia_doctor')
    AND doctor_id = app_current_user_id()
  );

CREATE POLICY availability_rules_assistant ON scheduling_availability_rules FOR ALL
  USING (app_current_role() = 'assistant' AND app_assists_doctor(doctor_id))
  WITH CHECK (app_current_role() = 'assistant' AND app_assists_doctor(doctor_id));

GRANT SELECT, INSERT, UPDATE ON scheduling_availability_rules TO mir_app;
GRANT EXECUTE ON FUNCTION scheduling_materialise_rule(uuid, date) TO mir_app;

COMMIT;
