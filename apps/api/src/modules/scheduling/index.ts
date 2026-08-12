/**
 * Public API of the `scheduling` module (BUILD_SPEC §5.1).
 *
 * `billing` consumes this to confirm an appointment on PaymentSucceeded
 * (§5.2). Note that double-booking protection is NOT part of this API — it
 * lives in the database's exclusion constraint, where concurrency cannot
 * defeat it, and no caller can opt out of it.
 */
export { SchedulingService, SlotUnavailableError } from './internal/scheduling.service';
export type {
  Appointment,
  AppointmentSummary,
  AvailabilityWindow,
  BookingInput,
  DoctorSummary,
} from './internal/scheduling.service';
export { SchedulingModule } from './scheduling.module';
