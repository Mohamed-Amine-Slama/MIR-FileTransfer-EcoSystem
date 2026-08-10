import { Module } from '@nestjs/common';
import { APP_CONFIG } from '../../shared/config/config.module';
import type { AppConfig } from '../../shared/config/config.schema';
import { DatabaseModule } from '../../shared/db/database.module';
import { EventsModule } from '../../shared/events/events.module';
import { BillingService } from './internal/billing.service';
import { PAYMENT_RAIL } from './internal/payment-rail.tokens';
import { StripePaymentRail, type PaymentRail } from './internal/payment-rail';

/**
 * DECISION D2a: Stripe.
 *
 * When the keys are absent (local development without a Stripe account) the
 * rail refuses every operation rather than being silently absent. Failing at
 * the point of use, loudly, beats a patient reaching the payment step and
 * getting an unexplained error.
 */
class UnconfiguredRail implements PaymentRail {
  readonly name = 'unconfigured';
  private fail(): never {
    throw new Error(
      'No payment rail is configured. Set STRIPE_SECRET_KEY and ' +
        'STRIPE_WEBHOOK_SECRET (BUILD_SPEC P11.1 / DECISION D2a).',
    );
  }
  async authorise(): Promise<never> { this.fail(); }
  async capture(): Promise<never> { this.fail(); }
  async cancel(): Promise<never> { this.fail(); }
  verifyWebhook(): never { this.fail(); }
}

@Module({
  imports: [DatabaseModule, EventsModule],
  providers: [
    BillingService,
    {
      provide: PAYMENT_RAIL,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): PaymentRail => {
        const key = config.STRIPE_SECRET_KEY;
        const webhookSecret = config.STRIPE_WEBHOOK_SECRET;
        if (key === undefined || webhookSecret === undefined) return new UnconfiguredRail();
        return new StripePaymentRail(key, webhookSecret);
      },
    },
  ],
  exports: [BillingService],
})
export class BillingModule {}
