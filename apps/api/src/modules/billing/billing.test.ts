import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppConfig } from '../../shared/config/config.schema';
import { runWithContext, type RequestContext } from '../../shared/context/request-context';
import { DatabaseService } from '../../shared/db/database.service';
import {
  appUrl,
  createPatient,
  createUser,
  setupTestDatabase,
  truncateAll,
  type Harness,
} from '../../shared/db/testing/rls-harness';
import { EventBus } from '../../shared/events/event-bus';
import { SchedulingService } from '../scheduling';
import { BillingService } from './internal/billing.service';
import {
  StripePaymentRail,
  WebhookVerificationError,
  type AuthorisationRequest,
  type AuthorisationResult,
  type CaptureResult,
  type PaymentRail,
  type WebhookEvent,
} from './internal/payment-rail';

/**
 * BUILD_SPEC P11.2 gate:
 *   - "Replay the same webhook 10 times -> one state change."
 *   - "Simulate payment failure -> slot released, patient notified."
 *   - "Simulate webhook arriving before the client redirect -> state still correct."
 */

const WEBHOOK_SECRET = 'whsec_test_secret_value_for_signing';

/** Controllable rail so provider behaviour is scripted, not mocked away. */
class FakeRail implements PaymentRail {
  readonly name = 'stripe';
  authoriseResult: AuthorisationResult = {
    providerIntentId: 'pi_test_1',
    status: 'authorised',
  };
  captureResult: CaptureResult = { status: 'captured' };
  authoriseCalls: AuthorisationRequest[] = [];
  captureCalls: string[] = [];

  async authorise(request: AuthorisationRequest): Promise<AuthorisationResult> {
    this.authoriseCalls.push(request);
    return this.authoriseResult;
  }

  async capture(intentId: string): Promise<CaptureResult> {
    this.captureCalls.push(intentId);
    return this.captureResult;
  }

  async cancel(): Promise<void> {}

  verifyWebhook(rawBody: string, signatureHeader: string): WebhookEvent {
    // Delegate to the real implementation so signature handling is genuinely
    // exercised rather than stubbed.
    return new StripePaymentRail('sk_test', WEBHOOK_SECRET).verifyWebhook(rawBody, signatureHeader);
  }
}

let h: Harness;
let db: DatabaseService;
let bus: EventBus;
let rail: FakeRail;
let billing: BillingService;
let scheduling: SchedulingService;

const config = {
  PAYMENT_AUTHORIZATION_WINDOW_HOURS: 72,
  PAYMENT_CURRENCY: 'TND',
} as AppConfig;

const ctx = (userId: string, role: RequestContext['role']): RequestContext => ({
  userId,
  role,
  triageBeforePayment: false,
  ipAddress: '41.208.1.5',
  userAgent: 'vitest',
  requestId: 'p11-test',
});

/** Build a correctly signed Stripe webhook. */
function signedWebhook(
  body: object,
  opts: { secret?: string; timestamp?: number } = {},
): { raw: string; header: string } {
  const raw = JSON.stringify(body);
  const t = opts.timestamp ?? Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', opts.secret ?? WEBHOOK_SECRET)
    .update(`${t}.${raw}`, 'utf8')
    .digest('hex');
  return { raw, header: `t=${t},v1=${signature}` };
}

const SLOT_START = new Date(Date.UTC(2026, 7, 20, 9, 0, 0));
const SLOT_END = new Date(Date.UTC(2026, 7, 20, 9, 30, 0));

beforeAll(async () => {
  h = await setupTestDatabase();
  db = new DatabaseService({ DATABASE_URL: appUrl(), DATABASE_POOL_MAX: 4 } as AppConfig);
  bus = new EventBus();
  rail = new FakeRail();
  billing = new BillingService(db, bus, rail, config);
  scheduling = new SchedulingService(db, bus, config);
}, 120_000);

afterAll(async () => {
  await db?.onModuleDestroy();
  await h?.close();
});

beforeEach(async () => {
  await truncateAll(h.owner);
  await h.owner.query('DELETE FROM billing_webhook_events');
  await h.owner.query('DELETE FROM billing_payments');
  rail.authoriseResult = { providerIntentId: 'pi_test_1', status: 'authorised' };
  rail.captureResult = { status: 'captured' };
  rail.authoriseCalls = [];
  rail.captureCalls = [];
});

async function bookedAppointment() {
  const libyaDoctor = await createUser(h.owner, 'libya_doctor');
  const tunisDoctor = await createUser(h.owner, 'tunisia_doctor');
  const user = await createUser(h.owner, 'patient');
  const patient = await createPatient(h.owner, libyaDoctor, user);

  const appt = await runWithContext(ctx(user, 'patient'), () =>
    scheduling.book({
      patientId: patient,
      doctorId: tunisDoctor,
      startsAt: SLOT_START,
      endsAt: SLOT_END,
    }),
  );
  return { user, patient, appointmentId: appt.id, tunisDoctor };
}

const apptStatus = async (id: string): Promise<string> => {
  const r = await h.owner.query<{ status: string }>(
    'SELECT status FROM scheduling_appointments WHERE id = $1',
    [id],
  );
  return r.rows[0]?.status ?? 'missing';
};

describe('P11.2 authorise then capture (DECISION D2)', () => {
  it('authorises at booking and moves the appointment to authorised', async () => {
    const { user, patient, appointmentId } = await bookedAppointment();

    const result = await runWithContext(ctx(user, 'patient'), () =>
      billing.authoriseForAppointment({
        appointmentId,
        patientId: patient,
        amountMinor: 15000,
        currency: 'TND',
      }),
    );

    expect(result.status).toBe('authorised');
    expect(await apptStatus(appointmentId)).toBe('authorised');

    // Money is HELD, not taken — capture has not been called.
    expect(rail.captureCalls).toHaveLength(0);
  });

  it('captures only on the doctor acceptance, and confirms the appointment', async () => {
    const { user, patient, appointmentId } = await bookedAppointment();
    await runWithContext(ctx(user, 'patient'), () =>
      billing.authoriseForAppointment({ appointmentId, patientId: patient, amountMinor: 15000, currency: 'TND' }),
    );

    const captured = await runWithContext(ctx(user, 'patient'), () =>
      billing.captureOnAcceptance(appointmentId),
    );

    expect(captured.status).toBe('captured');
    expect(rail.captureCalls).toEqual(['pi_test_1']);
    expect(await apptStatus(appointmentId)).toBe('confirmed');
  });

  it('is idempotent: authorising twice does not charge twice', async () => {
    // A double-tapped pay button, or a retry on a flaky Libyan connection.
    const { user, patient, appointmentId } = await bookedAppointment();

    const first = await runWithContext(ctx(user, 'patient'), () =>
      billing.authoriseForAppointment({ appointmentId, patientId: patient, amountMinor: 15000, currency: 'TND' }),
    );
    const second = await runWithContext(ctx(user, 'patient'), () =>
      billing.authoriseForAppointment({ appointmentId, patientId: patient, amountMinor: 15000, currency: 'TND' }),
    );

    expect(second.paymentId).toBe(first.paymentId);
    expect(rail.authoriseCalls).toHaveLength(1);

    const rows = await h.owner.query('SELECT id FROM billing_payments');
    expect(rows.rowCount).toBe(1);
  });

  it('uses a stable idempotency key derived from the appointment', async () => {
    const { user, patient, appointmentId } = await bookedAppointment();
    await runWithContext(ctx(user, 'patient'), () =>
      billing.authoriseForAppointment({ appointmentId, patientId: patient, amountMinor: 15000, currency: 'TND' }),
    );
    // Not a random per-call key — a random key defeats provider-side dedupe.
    expect(rail.authoriseCalls[0]?.idempotencyKey).toBe(`auth:${appointmentId}`);
  });

  it('capturing twice is a no-op, not a second charge', async () => {
    const { user, patient, appointmentId } = await bookedAppointment();
    await runWithContext(ctx(user, 'patient'), () =>
      billing.authoriseForAppointment({ appointmentId, patientId: patient, amountMinor: 15000, currency: 'TND' }),
    );

    await runWithContext(ctx(user, 'patient'), () => billing.captureOnAcceptance(appointmentId));
    await runWithContext(ctx(user, 'patient'), () => billing.captureOnAcceptance(appointmentId));

    expect(rail.captureCalls).toHaveLength(1);
  });

  it('stores no card data anywhere (P11.2 rule 1)', async () => {
    const { user, patient, appointmentId } = await bookedAppointment();
    await runWithContext(ctx(user, 'patient'), () =>
      billing.authoriseForAppointment({ appointmentId, patientId: patient, amountMinor: 15000, currency: 'TND' }),
    );

    const columns = await h.owner.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'billing_payments'`,
    );
    const names = columns.rows.map((r) => r.column_name).join(' ');
    // The platform must stay out of PCI scope.
    expect(names).not.toMatch(/card|pan|cvv|cvc|expiry|exp_month|exp_year/i);
  });
});

describe('P11.2 payment failure releases the slot (the gate)', () => {
  it('cancels the appointment when authorisation fails', async () => {
    rail.authoriseResult = {
      providerIntentId: '',
      status: 'failed',
      failureReason: 'card_declined',
    };

    const { user, patient, appointmentId } = await bookedAppointment();
    await runWithContext(ctx(user, 'patient'), () =>
      billing.authoriseForAppointment({ appointmentId, patientId: patient, amountMinor: 15000, currency: 'TND' }),
    );

    // A held slot with no money behind it blocks every other patient.
    expect(await apptStatus(appointmentId)).toBe('cancelled');
  });

  it('frees the slot for another patient after a failed payment', async () => {
    rail.authoriseResult = { providerIntentId: '', status: 'failed', failureReason: 'card_declined' };
    const first = await bookedAppointment();
    await runWithContext(ctx(first.user, 'patient'), () =>
      billing.authoriseForAppointment({
        appointmentId: first.appointmentId,
        patientId: first.patient,
        amountMinor: 15000,
        currency: 'TND',
      }),
    );

    // A second patient can now take the slot.
    const libyaDoctor = await createUser(h.owner, 'libya_doctor');
    const user2 = await createUser(h.owner, 'patient');
    const patient2 = await createPatient(h.owner, libyaDoctor, user2);

    const second = await runWithContext(ctx(user2, 'patient'), () =>
      scheduling.book({
        patientId: patient2,
        doctorId: first.tunisDoctor,
        startsAt: SLOT_START,
        endsAt: SLOT_END,
      }),
    );
    expect(second.id).not.toBe(first.appointmentId);
  });
});

describe('P11.2 webhook idempotency (the gate)', () => {
  it('replaying the same webhook 10 times produces ONE state change', async () => {
    const { user, patient, appointmentId } = await bookedAppointment();
    await runWithContext(ctx(user, 'patient'), () =>
      billing.authoriseForAppointment({ appointmentId, patientId: patient, amountMinor: 15000, currency: 'TND' }),
    );

    const succeeded: string[] = [];
    bus.subscribe('PaymentSucceeded', (e) => {
      succeeded.push(e.paymentId);
    });

    const { raw, header } = signedWebhook({
      id: 'evt_replay_1',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_test_1' } },
    });

    const results = [];
    for (let i = 0; i < 10; i++) {
      results.push(await billing.handleWebhook(raw, header));
    }

    // Exactly one delivery did anything.
    expect(results.filter((r) => r.handled)).toHaveLength(1);
    expect(succeeded).toHaveLength(1);

    const payments = await h.owner.query<{ status: string; captured_at: Date | null }>(
      'SELECT status, captured_at FROM billing_payments',
    );
    expect(payments.rowCount).toBe(1);
    expect(payments.rows[0]?.status).toBe('captured');
    expect(await apptStatus(appointmentId)).toBe('confirmed');

    // And only one event row was recorded.
    const events = await h.owner.query('SELECT provider_event_id FROM billing_webhook_events');
    expect(events.rowCount).toBe(1);
  });

  it('handles concurrent duplicate deliveries', async () => {
    // Providers retry in parallel; the dedupe must be atomic, not read-then-write.
    const { user, patient, appointmentId } = await bookedAppointment();
    await runWithContext(ctx(user, 'patient'), () =>
      billing.authoriseForAppointment({ appointmentId, patientId: patient, amountMinor: 15000, currency: 'TND' }),
    );

    const { raw, header } = signedWebhook({
      id: 'evt_concurrent_1',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_test_1' } },
    });

    const results = await Promise.all(
      Array.from({ length: 8 }, () => billing.handleWebhook(raw, header)),
    );
    expect(results.filter((r) => r.handled)).toHaveLength(1);
  });

  it('a webhook arriving BEFORE the client redirect still leaves correct state', async () => {
    // On a slow connection the redirect routinely loses the race. The webhook
    // must be able to complete the flow entirely on its own.
    const { user, patient, appointmentId } = await bookedAppointment();
    await runWithContext(ctx(user, 'patient'), () =>
      billing.authoriseForAppointment({ appointmentId, patientId: patient, amountMinor: 15000, currency: 'TND' }),
    );

    const { raw, header } = signedWebhook({
      id: 'evt_early_1',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_test_1' } },
    });
    await billing.handleWebhook(raw, header);

    expect(await apptStatus(appointmentId)).toBe('confirmed');

    // The redirect-triggered capture then arrives late and must be harmless.
    const late = await runWithContext(ctx(user, 'patient'), () =>
      billing.captureOnAcceptance(appointmentId),
    );
    expect(late.status).toBe('captured');
    expect(await apptStatus(appointmentId)).toBe('confirmed');
  });

  it('a failure webhook cancels the appointment', async () => {
    const { user, patient, appointmentId } = await bookedAppointment();
    await runWithContext(ctx(user, 'patient'), () =>
      billing.authoriseForAppointment({ appointmentId, patientId: patient, amountMinor: 15000, currency: 'TND' }),
    );

    const { raw, header } = signedWebhook({
      id: 'evt_fail_1',
      type: 'payment_intent.payment_failed',
      data: { object: { id: 'pi_test_1' } },
    });
    await billing.handleWebhook(raw, header);

    expect(await apptStatus(appointmentId)).toBe('cancelled');
  });

  it('never moves a cancelled appointment back to confirmed', async () => {
    const { user, patient, appointmentId } = await bookedAppointment();
    await runWithContext(ctx(user, 'patient'), () =>
      billing.authoriseForAppointment({ appointmentId, patientId: patient, amountMinor: 15000, currency: 'TND' }),
    );
    await runWithContext(ctx(user, 'patient'), () => scheduling.cancel(appointmentId));

    const { raw, header } = signedWebhook({
      id: 'evt_late_success',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_test_1' } },
    });
    await billing.handleWebhook(raw, header);

    // A late success must not resurrect a cancelled appointment — the slot may
    // already have been given to someone else.
    expect(await apptStatus(appointmentId)).toBe('cancelled');
  });
});

describe('P11.2 webhook signature verification', () => {
  const verifier = (nowMs?: number): StripePaymentRail =>
    new StripePaymentRail('sk_test', WEBHOOK_SECRET, 'https://api.stripe.com/v1', () => nowMs ?? Date.now());

  it('accepts a correctly signed payload', () => {
    const { raw, header } = signedWebhook({ id: 'evt_1', type: 'payment_intent.succeeded', data: { object: { id: 'pi_1' } } });
    const event = verifier().verifyWebhook(raw, header);
    expect(event.id).toBe('evt_1');
    expect(event.providerIntentId).toBe('pi_1');
  });

  it('rejects a payload signed with the wrong secret', () => {
    const { raw, header } = signedWebhook({ id: 'evt_1', type: 'x' }, { secret: 'whsec_attacker' });
    expect(() => verifier().verifyWebhook(raw, header)).toThrow(WebhookVerificationError);
  });

  it('rejects a tampered body under a valid signature', () => {
    const { header } = signedWebhook({ id: 'evt_1', type: 'payment_intent.succeeded', data: { object: { id: 'pi_1' } } });
    const tampered = JSON.stringify({
      id: 'evt_1',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_ATTACKER' } },
    });
    expect(() => verifier().verifyWebhook(tampered, header)).toThrow(/signature mismatch/);
  });

  it('rejects an old signature (replay of a captured request)', () => {
    const old = Math.floor(Date.now() / 1000) - 3600;
    const { raw, header } = signedWebhook({ id: 'evt_1', type: 'x' }, { timestamp: old });
    expect(() => verifier().verifyWebhook(raw, header)).toThrow(/outside tolerance/);
  });

  it('rejects a far-future timestamp', () => {
    // The attacker controls this value; without a bound they could mint a
    // signature valid for years.
    const future = Math.floor(Date.now() / 1000) + 86_400;
    const { raw, header } = signedWebhook({ id: 'evt_1', type: 'x' }, { timestamp: future });
    expect(() => verifier().verifyWebhook(raw, header)).toThrow(/outside tolerance/);
  });

  it('rejects a malformed signature header', () => {
    expect(() => verifier().verifyWebhook('{}', 'garbage')).toThrow(/malformed/);
  });

  it('does not process an unsigned webhook at all', async () => {
    await expect(billing.handleWebhook('{"id":"evt_x","type":"y"}', '')).rejects.toThrow(
      WebhookVerificationError,
    );
    const events = await h.owner.query('SELECT provider_event_id FROM billing_webhook_events');
    expect(events.rowCount).toBe(0);
  });
});
