-- The practice calendar — a doctor's own diary, alongside the referral flow.
--
-- THE BUG THIS FIXES, and it is the same shape as the one 0008 fixed.
--
-- `POST /appointments` and `DELETE /appointments/:id` have named the referring
-- side in their `@RequiresRole` decorators since P10 was written, but
-- `scheduling_appointments` carried no INSERT or UPDATE policy for that role —
-- only `appointments_referring_doctor`, which is FOR SELECT. So the insert
-- failed with 42501, which scheduling.service.ts maps to "Patient not found":
-- a message that sends you to look at the patient record, and the patient
-- record is fine. `availability_bookable` had the matching problem, admitting
-- only 'patient', so the referring doctor's slot picker was always empty and
-- reported a fully-booked specialist as having published nothing.
--
-- A route whose decorator and whose policy disagree is worse than one that is
-- honestly closed, because it reads as supported.
--
-- WHAT CHANGES ABOUT D1. D1 says the Libyan doctor creates the patient record
-- and sees only their own. The SECOND half of that is the access rule and it is
-- untouched: every policy below still turns on app_created_patient(), so a
-- doctor reaches exactly the patients they created and no others. The first
-- half was a statement about the referral flow, not a restriction anyone
-- relied on — and a receiving doctor with no way to create a patient record has
-- no way to write down the walk-in standing at their desk, who is not part of a
-- referral at all.
--
-- NOTHING HERE TOUCHES IMAGING. There is no new policy on imaging_studies,
-- imaging_instances or consent_records, so the consent-plus-payment gate that
-- decides who sees a scan is exactly where it was. The P3.2 suite asserts this.

BEGIN;

-- ---------------------------------------------------------------------------
-- patients_patients — a doctor owns the records they create, whichever side
-- of the corridor they are on.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS patients_creator ON patients_patients;
DROP POLICY IF EXISTS patients_creator_insert ON patients_patients;
DROP POLICY IF EXISTS patients_creator_update ON patients_patients;

CREATE POLICY patients_creator ON patients_patients FOR SELECT
  USING (
    app_current_role() IN ('libya_doctor','tunisia_doctor')
    AND created_by_doctor = app_current_user_id()
  );

CREATE POLICY patients_creator_insert ON patients_patients FOR INSERT
  WITH CHECK (
    app_current_role() IN ('libya_doctor','tunisia_doctor')
    AND created_by_doctor = app_current_user_id()
  );

CREATE POLICY patients_creator_update ON patients_patients FOR UPDATE
  USING (
    app_current_role() IN ('libya_doctor','tunisia_doctor')
    AND created_by_doctor = app_current_user_id()
  )
  WITH CHECK (created_by_doctor = app_current_user_id());

-- ---------------------------------------------------------------------------
-- scheduling_availability — both sides keep a diary; whoever books needs to
-- read it.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS availability_owner ON scheduling_availability;
DROP POLICY IF EXISTS availability_bookable ON scheduling_availability;

CREATE POLICY availability_owner ON scheduling_availability FOR ALL
  USING (
    app_current_role() IN ('libya_doctor','tunisia_doctor')
    AND doctor_id = app_current_user_id()
  )
  WITH CHECK (
    app_current_role() IN ('libya_doctor','tunisia_doctor')
    AND doctor_id = app_current_user_id()
  );

-- Whoever may book must be able to see what is bookable. Published availability
-- is not patient data — it is a doctor's opening hours — so this reveals
-- nothing about anyone's care.
CREATE POLICY availability_bookable ON scheduling_availability FOR SELECT
  USING (app_current_role() IN ('patient','libya_doctor'));

-- ---------------------------------------------------------------------------
-- scheduling_appointments — the write half of what the routes already claim.
--
-- Both policies turn on app_created_patient(), which is role-agnostic: it asks
-- only whether THIS caller created the patient. That single condition covers
-- the referring doctor booking a referral for their patient and the receiving
-- doctor booking a walk-in they have just registered, without either being able
-- to reach a patient belonging to anyone else.
-- ---------------------------------------------------------------------------
CREATE POLICY appointments_doctor_insert ON scheduling_appointments FOR INSERT
  WITH CHECK (
    app_current_role() IN ('libya_doctor','tunisia_doctor')
    AND app_created_patient(patient_id)
  );

CREATE POLICY appointments_referring_update ON scheduling_appointments FOR UPDATE
  USING (app_current_role() = 'libya_doctor' AND app_created_patient(patient_id))
  WITH CHECK (app_created_patient(patient_id));

-- ---------------------------------------------------------------------------
-- What an appointment needs to be a diary entry rather than a referral stub.
--
-- `no_show` joins the status set. It is deliberately NOT a kind of cancellation:
-- the slot was consumed, the doctor waited, and a practice that cannot tell the
-- two apart cannot see which patients repeatedly fail to arrive. It stays
-- inside the exclusion constraint's WHERE (status <> 'cancelled') for the same
-- reason — the slot was used and must not be handed to someone else after the
-- fact.
--
-- `notes` is for scheduling only ("brings her daughter to translate"), never
-- clinical findings. Nothing in this schema is a medical record: §1.3 keeps the
-- platform a transfer and scheduling service, and a free-text clinical field is
-- how that line gets crossed by accident.
-- ---------------------------------------------------------------------------
ALTER TABLE scheduling_appointments
  ADD COLUMN reason      text,
  ADD COLUMN notes       text,
  ADD COLUMN kind        text NOT NULL DEFAULT 'consultation'
                CHECK (kind IN ('consultation','follow_up','imaging','other')),
  ADD COLUMN cancel_reason text,
  ADD COLUMN created_by  uuid REFERENCES identity_users(id);

ALTER TABLE scheduling_appointments DROP CONSTRAINT scheduling_appointments_status_check;
ALTER TABLE scheduling_appointments ADD CONSTRAINT scheduling_appointments_status_check
  CHECK (status IN ('pending_payment','authorised','confirmed','cancelled','completed','no_show'));

-- The agenda reads "this doctor, this day" on every page load.
CREATE INDEX scheduling_appointments_doctor_day_idx
  ON scheduling_appointments (doctor_id, starts_at)
  WHERE status <> 'cancelled';

COMMIT;
