-- BUILD_SPEC P11 — billing.
--
-- DECISION D2 / D2a: Stripe, authorise at booking, capture when the Tunisian
-- doctor accepts the case.
--
-- NO CARD DATA IS STORED, EVER (P11.2 rule 1). Only Stripe's opaque
-- identifiers. Storing a PAN, a CVC, or even a BIN range would put this
-- platform in PCI scope, which is a compliance programme, not a column.
--
-- BLOCKING L7 REMAINS OPEN: whether a Libyan payer can lawfully and
-- practically pay a Tunisian-facing platform, and in which jurisdiction the
-- receiving entity must be incorporated for Stripe to serve it. This schema
-- does not assume an answer.

BEGIN;

CREATE TABLE billing_payments (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  appointment_id      uuid NOT NULL REFERENCES scheduling_appointments(id),
  patient_id          uuid NOT NULL REFERENCES patients_patients(id),

  -- Minor units (millimes/cents). NEVER a float: 0.1 + 0.2 is not 0.3, and
  -- money that does not add up is a dispute nobody can settle.
  amount_minor        bigint NOT NULL CHECK (amount_minor > 0),
  currency            text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),

  -- Stripe's opaque ids. No card data.
  provider            text NOT NULL DEFAULT 'stripe',
  provider_intent_id  text UNIQUE,

  status              text NOT NULL DEFAULT 'requires_authorisation'
                        CHECK (status IN ('requires_authorisation','authorised','captured',
                                          'failed','cancelled','refunded')),
  failure_reason      text,

  -- P11.2 rule 2: idempotency on every payment operation. Unique, so a retried
  -- request cannot create a second charge.
  idempotency_key     text NOT NULL UNIQUE,

  authorised_at       timestamptz,
  captured_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX billing_payments_appointment_idx ON billing_payments (appointment_id);
CREATE INDEX billing_payments_patient_idx ON billing_payments (patient_id);

-- ---------------------------------------------------------------------------
-- Webhook replay protection (P11.2 rule 3).
--
-- Stripe delivers at-least-once and retries for days. The SAME event will
-- arrive more than once, and events routinely arrive OUT OF ORDER relative to
-- the browser redirect. Recording every event id and refusing duplicates is
-- what makes "replay the same webhook 10 times -> one state change" true.
-- ---------------------------------------------------------------------------
CREATE TABLE billing_webhook_events (
  provider_event_id  text PRIMARY KEY,
  provider           text NOT NULL DEFAULT 'stripe',
  event_type         text NOT NULL,
  payment_id         uuid REFERENCES billing_payments(id),
  received_at        timestamptz NOT NULL DEFAULT now(),
  processed_at       timestamptz
);

CREATE INDEX billing_webhook_events_received_idx ON billing_webhook_events (received_at);

-- ---------------------------------------------------------------------------
-- Access control.
--
-- A patient sees their own payments. Doctors see none: whether a patient paid
-- is not clinical information, and the receiving doctor's access to imaging is
-- decided by appointment status, not by reading the payment row.
-- ---------------------------------------------------------------------------
ALTER TABLE billing_payments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_payments       FORCE  ROW LEVEL SECURITY;
ALTER TABLE billing_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_webhook_events FORCE  ROW LEVEL SECURITY;

CREATE POLICY payments_patient ON billing_payments FOR SELECT
  USING (app_current_role() = 'patient' AND app_claimed_patient(patient_id));

CREATE POLICY payments_patient_insert ON billing_payments FOR INSERT
  WITH CHECK (app_current_role() = 'patient' AND app_claimed_patient(patient_id));

CREATE POLICY payments_admin ON billing_payments FOR SELECT
  USING (app_current_role() = 'admin');

-- Webhooks arrive from Stripe with no user session. They are processed by a
-- system context (see BillingService.handleWebhook), which supplies an
-- explicit 'admin' role rather than querying with no identity at all.
CREATE POLICY webhook_events_system ON billing_webhook_events FOR ALL
  USING (app_current_role() = 'admin')
  WITH CHECK (app_current_role() = 'admin');

CREATE POLICY payments_system_update ON billing_payments FOR UPDATE
  USING (app_current_role() = 'admin')
  WITH CHECK (app_current_role() = 'admin');

GRANT SELECT, INSERT, UPDATE ON billing_payments, billing_webhook_events TO mir_app;

COMMIT;
