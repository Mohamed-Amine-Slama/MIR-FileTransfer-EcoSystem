/**
 * Public API of the `billing` module (BUILD_SPEC §5.1).
 *
 * The payment rail itself is NOT exported: provider credentials and the HTTP
 * calls that use them stay inside this module. Other modules react to the
 * `PaymentSucceeded` domain event (§5.2) rather than asking billing anything.
 */
export { BillingService } from './internal/billing.service';
export { BillingModule } from './billing.module';
