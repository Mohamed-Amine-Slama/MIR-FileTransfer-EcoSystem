import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { RequiresRole } from '../../../shared/authz/access-metadata';
import { BillingService } from './billing.service';

/**
 * Billing HTTP layer — BUILD_SPEC P11, DECISION D2.
 *
 * ACCEPTANCE LIVES HERE, NOT IN SCHEDULING, because accepting a referral is
 * the act that captures the money. Putting it next to the code that moves
 * funds keeps the two from drifting apart, and it avoids a module cycle:
 * billing already reaches the appointment row, scheduling knows nothing about
 * payments.
 *
 * No amount is accepted from the client anywhere in this controller. The fee
 * comes from validated config and the patient from the appointment row.
 */
@Controller()
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  /**
   * Authorise (hold) the consultation fee. Does NOT capture.
   *
   * `clientSecret` is what the browser hands to Stripe.js to complete the
   * card step. It is scoped to this one payment intent and is not a
   * credential for anything else, which is why it may cross to the client at
   * all — unlike the secret key, which the bundle check would fail on.
   */
  @RequiresRole('patient')
  @Post('appointments/:id/payment')
  @HttpCode(200)
  async authorise(
    @Param('id', ParseUUIDPipe) appointmentId: string,
  ): Promise<{ status: string; clientSecret?: string }> {
    const result = await this.billing.authoriseAppointment(appointmentId);
    return { status: result.status, clientSecret: result.clientSecret };
  }

  @RequiresRole('patient', 'libya_doctor', 'tunisia_doctor')
  @Get('appointments/:id/payment')
  async status(@Param('id', ParseUUIDPipe) appointmentId: string): Promise<{
    status: string;
    amountMinor: number | null;
    currency: string | null;
  }> {
    return this.billing.statusForAppointment(appointmentId);
  }

  /**
   * The receiving doctor accepts — and this is where the patient is charged.
   *
   * Idempotent: a second call on an already-captured payment returns the same
   * state rather than charging again. A doctor double-tapping on a slow
   * connection must not bill the patient twice.
   */
  @RequiresRole('tunisia_doctor')
  @Post('appointments/:id/accept')
  @HttpCode(200)
  async accept(
    @Param('id', ParseUUIDPipe) appointmentId: string,
  ): Promise<{ status: string }> {
    return this.billing.captureOnAcceptance(appointmentId);
  }
}
