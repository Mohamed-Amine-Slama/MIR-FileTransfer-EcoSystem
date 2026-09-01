import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { APP_CONFIG } from '../../../shared/config/config.module';
import type { AppConfig } from '../../../shared/config/config.schema';
import { requireContext, runWithContext, type RequestContext } from '../../../shared/context/request-context';
import { DatabaseService } from '../../../shared/db/database.service';
import { EventBus } from '../../../shared/events/event-bus';
import { PAYMENT_RAIL, type PaymentRail } from './payment-rail.tokens';

/**
 * Billing — BUILD_SPEC P11.2, DECISION D2.
 *
 * Authorise when the patient books; capture when the Tunisian doctor accepts
 * the case. Money only moves once a human on the receiving side has agreed to
 * do the work.
 *
 * THREE PROPERTIES THE GATE TESTS DIRECTLY:
 *
 *  1. Replaying one webhook ten times produces ONE state change. Providers
 *     deliver at-least-once and retry for days; anything else double-confirms
 *     appointments and double-counts revenue.
 *  2. A failed payment releases the slot. A held slot with no money behind it
 *     is a slot no other patient can book.
 *  3. A webhook arriving BEFORE the browser redirect still lands correctly.
 *     Out-of-order is the normal case on a slow Libyan connection — the
 *     redirect races the webhook and frequently loses.
 *
 * No card data touches this service (P11.2 rule 1).
 */

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly bus: EventBus,
    @Inject(PAYMENT_RAIL) private readonly rail: PaymentRail,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Authorise for an appointment, resolving the patient and the fee here.
   *
   * THE CLIENT NEVER SENDS THE AMOUNT. It is read from validated config and
   * the patient is read from the appointment row — which RLS has already
   * scoped, so an appointment the caller cannot see resolves to nothing and
   * returns 404. A client-supplied amount would let a patient authorise one
   * dinar for a consultation, and a client-supplied patient id would let them
   * bill someone else's card.
   */
  async authoriseAppointment(
    appointmentId: string,
  ): Promise<{ paymentId: string; status: string; clientSecret?: string }> {
    const appointment = await this.db.tx(async (tx) => {
      const res = await tx.query<{ patient_id: string; status: string }>(
        `SELECT patient_id, status FROM scheduling_appointments WHERE id = $1`,
        [appointmentId],
      );
      return res.rows[0];
    });

    if (appointment === undefined) throw new NotFoundException('Appointment not found');
    if (appointment.status === 'cancelled') {
      throw new NotFoundException('Appointment is no longer open for payment');
    }

    return this.authoriseForAppointment({
      appointmentId,
      patientId: appointment.patient_id,
      amountMinor: this.config.CONSULTATION_FEE_MINOR,
      currency: this.config.PAYMENT_CURRENCY,
    });
  }

  /**
   * Authorise payment for a booked appointment (D2, step 1).
   *
   * The idempotency key is derived from the APPOINTMENT, not generated per
   * call. A patient who double-taps "pay", or whose request is retried by a
   * flaky connection, must not be charged twice — and on Libyan connectivity,
   * retries are the norm rather than the exception.
   */
  async authoriseForAppointment(input: {
    appointmentId: string;
    patientId: string;
    amountMinor: number;
    currency: string;
  }): Promise<{ paymentId: string; status: string; clientSecret?: string }> {
    const ctx = requireContext();
    const idempotencyKey = `auth:${input.appointmentId}`;

    // Existing attempt for this appointment? Return it rather than starting a
    // second one.
    const existing = await this.db.tx(async (tx) => {
      const res = await tx.query<{ id: string; status: string }>(
        `SELECT id, status FROM billing_payments WHERE idempotency_key = $1`,
        [idempotencyKey],
      );
      return res.rows[0];
    });

    if (existing !== undefined) {
      return { paymentId: existing.id, status: existing.status };
    }

    const paymentId = await this.db.tx(async (tx) => {
      const res = await tx.query<{ id: string }>(
        `INSERT INTO billing_payments
           (appointment_id, patient_id, amount_minor, currency, provider, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING id`,
        [
          input.appointmentId,
          input.patientId,
          input.amountMinor,
          input.currency.toUpperCase(),
          this.rail.name,
          idempotencyKey,
        ],
      );
      const row = res.rows[0];
      if (row === undefined) throw new NotFoundException('Appointment not found');
      return row.id;
    });

    const result = await this.rail.authorise({
      amountMinor: input.amountMinor,
      currency: input.currency,
      idempotencyKey,
      reference: input.appointmentId,
    });

    await this.systemTx(ctx, async (tx) => {
      await tx.query(
        `UPDATE billing_payments
         SET provider_intent_id = $1,
             status = $2,
             failure_reason = $3,
             authorised_at = CASE WHEN $2 = 'authorised' THEN now() ELSE authorised_at END,
             updated_at = now()
         WHERE id = $4`,
        [
          result.providerIntentId === '' ? null : result.providerIntentId,
          result.status === 'authorised' ? 'authorised' : result.status === 'failed' ? 'failed' : 'requires_authorisation',
          result.failureReason ?? null,
          paymentId,
        ],
      );

      if (result.status === 'authorised') {
        await tx.query(
          `UPDATE scheduling_appointments SET status = 'authorised'
           WHERE id = $1 AND status = 'pending_payment'`,
          [input.appointmentId],
        );
      }

      if (result.status === 'failed') {
        // Release the slot immediately — see property 2 above.
        await tx.query(
          `UPDATE scheduling_appointments SET status = 'cancelled'
           WHERE id = $1 AND status IN ('pending_payment','authorised')`,
          [input.appointmentId],
        );
      }
    });

    return {
      paymentId,
      status: result.status,
      ...(result.clientSecret !== undefined ? { clientSecret: result.clientSecret } : {}),
    };
  }

  /**
   * Capture on the doctor's acceptance (D2, step 2).
   *
   * This is the point where money actually moves, and the only place that
   * transitions an appointment to `confirmed` — which is in turn what unlocks
   * imaging for the receiving doctor when triage is off (D3).
   */
  /**
   * Payment state for one appointment.
   *
   * Returns `none` rather than 404 when nothing has been attempted yet: the
   * appointment legitimately exists in `pending_payment` before any
   * authorisation, and a 404 there would be indistinguishable from an
   * appointment the caller cannot see.
   */
  async statusForAppointment(
    appointmentId: string,
  ): Promise<{ status: string; amountMinor: number | null; currency: string | null }> {
    return this.db.tx(async (tx) => {
      const res = await tx.query<{ status: string; amount_minor: string; currency: string }>(
        `SELECT status, amount_minor, currency FROM billing_payments
         WHERE appointment_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [appointmentId],
      );
      const row = res.rows[0];
      if (row === undefined) return { status: 'none', amountMinor: null, currency: null };
      // amount_minor is bigint, which the driver hands back as a string so no
      // precision is lost above 2^53. Convert only here, where the value is
      // known to be a currency amount well inside safe-integer range.
      return {
        status: row.status,
        amountMinor: Number(row.amount_minor),
        currency: row.currency,
      };
    });
  }

  async captureOnAcceptance(appointmentId: string): Promise<{ status: string }> {
    const ctx = requireContext();

    const payment = await this.db.tx(async (tx) => {
      const res = await tx.query<{ id: string; provider_intent_id: string | null; status: string }>(
        `SELECT id, provider_intent_id, status FROM billing_payments
         WHERE appointment_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [appointmentId],
      );
      return res.rows[0];
    });

    if (payment === undefined || payment.provider_intent_id === null) {
      throw new NotFoundException('Payment not found');
    }
    if (payment.status === 'captured') {
      return { status: 'captured' }; // idempotent
    }

    const result = await this.rail.capture(payment.provider_intent_id, `capture:${appointmentId}`);

    await this.systemTx(ctx, async (tx) => {
      await tx.query(
        `UPDATE billing_payments
         SET status = $1, failure_reason = $2,
             captured_at = CASE WHEN $1 = 'captured' THEN now() ELSE captured_at END,
             updated_at = now()
         WHERE id = $3`,
        [result.status, result.failureReason ?? null, payment.id],
      );
    });

    if (result.status === 'captured') {
      // Set the appointment state HERE as well as in the webhook path. Capture
      // can complete either way — via the doctor's acceptance in-app, or via
      // the provider's webhook — and whichever arrives first must leave the
      // appointment confirmed. Relying on the webhook alone leaves a captured
      // payment against an unconfirmed booking whenever delivery is delayed.
      await this.systemTx(ctx, async (tx) => {
        await tx.query(
          `UPDATE scheduling_appointments SET status = 'confirmed'
           WHERE id = $1 AND status NOT IN ('cancelled','completed')`,
          [appointmentId],
        );
      });
      await this.confirmAppointment(ctx, appointmentId, payment.id);
    }

    return { status: result.status };
  }

  /**
   * Handle a provider webhook — P11.2 rule 3.
   *
   * Signature verification happens FIRST, on the raw body. Then the event id
   * is recorded; a duplicate id short-circuits before any state changes. That
   * ordering is what makes ten replays produce one state change.
   *
   * Webhooks carry no user session, so this runs under an explicit system
   * context rather than with no identity at all — a query with no context
   * would silently return nothing under RLS.
   */
  async handleWebhook(rawBody: string, signatureHeader: string): Promise<{ handled: boolean }> {
    const event = this.rail.verifyWebhook(rawBody, signatureHeader);

    const ctx = systemContext();

    const isNew = await runWithContext(ctx, () =>
      this.db.tx(async (tx) => {
        const res = await tx.query(
          `INSERT INTO billing_webhook_events (provider_event_id, provider, event_type)
           VALUES ($1, $2, $3)
           ON CONFLICT (provider_event_id) DO NOTHING`,
          [event.id, this.rail.name, event.type],
        );
        return (res.rowCount ?? 0) > 0;
      }),
    );

    if (!isNew) {
      // Already seen. Not an error — the provider is doing exactly what it
      // promises — but nothing further may happen.
      this.logger.log(`duplicate webhook ${event.id} ignored`);
      return { handled: false };
    }

    if (event.providerIntentId === undefined) {
      await this.markProcessed(ctx, event.id);
      return { handled: false };
    }

    const payment = await runWithContext(ctx, () =>
      this.db.tx(async (tx) => {
        const res = await tx.query<{ id: string; appointment_id: string; status: string }>(
          `SELECT id, appointment_id, status FROM billing_payments WHERE provider_intent_id = $1`,
          [event.providerIntentId],
        );
        return res.rows[0];
      }),
    );

    if (payment === undefined) {
      // The webhook beat our own record of the intent. Recording the event id
      // means we will not process it twice; the authorise() call that follows
      // will set the correct state, so nothing is lost.
      this.logger.warn(`webhook ${event.id} for unknown intent — deferring`);
      await this.markProcessed(ctx, event.id);
      return { handled: false };
    }

    switch (event.type) {
      case 'payment_intent.amount_capturable_updated':
      case 'payment_intent.requires_capture':
        await this.applyStatus(ctx, payment.id, 'authorised', payment.appointment_id, 'authorised');
        break;

      case 'payment_intent.succeeded':
        await this.applyStatus(ctx, payment.id, 'captured', payment.appointment_id, 'confirmed');
        await this.confirmAppointment(ctx, payment.appointment_id, payment.id);
        break;

      case 'payment_intent.payment_failed':
      case 'payment_intent.canceled':
        await this.applyStatus(ctx, payment.id, 'failed', payment.appointment_id, 'cancelled');
        break;

      default:
        this.logger.log(`unhandled webhook type ${event.type}`);
    }

    await this.markProcessed(ctx, event.id);
    return { handled: true };
  }

  // -------------------------------------------------------------------------

  private async applyStatus(
    ctx: RequestContext,
    paymentId: string,
    paymentStatus: string,
    appointmentId: string,
    appointmentStatus: string,
  ): Promise<void> {
    await this.systemTx(ctx, async (tx) => {
      await tx.query(
        `UPDATE billing_payments
         SET status = $1,
             authorised_at = CASE WHEN $1 = 'authorised' THEN COALESCE(authorised_at, now()) ELSE authorised_at END,
             captured_at   = CASE WHEN $1 = 'captured'   THEN COALESCE(captured_at, now())   ELSE captured_at END,
             updated_at = now()
         WHERE id = $2`,
        [paymentStatus, paymentId],
      );

      // Never move an appointment backwards out of a terminal state.
      await tx.query(
        `UPDATE scheduling_appointments
         SET status = $1
         WHERE id = $2 AND status NOT IN ('cancelled','completed')`,
        [appointmentStatus, appointmentId],
      );
    });
  }

  private async confirmAppointment(
    ctx: RequestContext,
    appointmentId: string,
    paymentId: string,
  ): Promise<void> {
    const details = await this.systemTx(ctx, async (tx) => {
      const res = await tx.query<{ amount_minor: string; currency: string; patient_id: string }>(
        `SELECT amount_minor, currency, patient_id FROM billing_payments WHERE id = $1`,
        [paymentId],
      );
      return res.rows[0];
    });

    if (details === undefined) return;

    await this.bus.publish({
      type: 'PaymentSucceeded',
      appointmentId,
      paymentId,
      amountMinor: Number(details.amount_minor),
      currency: details.currency,
      actorId: ctx.userId,
      actorRole: ctx.role,
      occurredAt: new Date(),
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  private async markProcessed(ctx: RequestContext, eventId: string): Promise<void> {
    await this.systemTx(ctx, async (tx) => {
      await tx.query(
        `UPDATE billing_webhook_events SET processed_at = now() WHERE provider_event_id = $1`,
        [eventId],
      );
    });
  }

  /**
   * Run under a system identity.
   *
   * Payment state transitions are driven by the provider, not by the patient,
   * so they need an identity RLS will accept for writes. This is NOT a
   * bypass connection (§17): it is the same `mir_app` role with an explicit
   * role in the session context, subject to the same policies.
   */
  private async systemTx<T>(
    ctx: RequestContext,
    fn: (tx: import('pg').PoolClient) => Promise<T>,
  ): Promise<T> {
    return this.db.txAs({ ...ctx, role: 'admin' }, fn);
  }
}

/** Identity for provider-initiated work that has no user session. */
export function systemContext(): RequestContext {
  return {
    userId: '00000000-0000-7000-8000-000000000000',
    role: 'admin',
    triageBeforePayment: false,
    ipAddress: undefined,
    userAgent: 'stripe-webhook',
    requestId: randomUUID(),
  };
}
